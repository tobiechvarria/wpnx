// Static-asset Worker with a couple of live routes bolted on. Everything
// else falls through to the static build in ./dist untouched (see
// wrangler.jsonc run_worker_first).

import { connect } from 'cloudflare:sockets';

const LIVE_GRACE_MS = 5 * 60 * 1000; // spin logging can lag the actual airing

// Icecast source is plain HTTP (no TLS on that port) and wpnx.org is HTTPS,
// so a browser <audio src> pointed straight at it is mixed content and gets
// silently blocked/upgraded-and-failed. /api/stream proxies it server-side
// (no mixed-content rule applies to a Worker's own connection) and pipes the
// response straight through — see chat for how this was diagnosed.
//
// This can't be a plain fetch(): Workers deployed to production silently
// rewrite a non-standard port in a fetch() URL to the scheme's default port
// (80 for http://), even with the allow_custom_ports compatibility flag set
// (a known workerd gap — github.com/cloudflare/workerd/issues/2955). That
// was confirmed here directly: fetching this exact URL landed on a totally
// unrelated Cloudflare-fronted site sharing that IP on port 80 (its 403
// response came back with real `server: cloudflare` / `cf-ray` headers).
// A raw TCP socket via cloudflare:sockets connects to the exact port we ask
// for, so this hand-rolls the HTTP/1.0 request over that socket instead.
const ICECAST_HOST = '158.101.102.214';
const ICECAST_PORT = 8000;
const ICECAST_PATH = '/stream';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/now-playing') {
      return handleNowPlaying(env, url.searchParams.has('debug'));
    }
    if (url.pathname === '/api/stream') {
      return handleStream(request);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleStream(request) {
  const url = new URL(request.url);
  const debug = url.searchParams.has('debug');
  const headers = {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  };

  // A live stream body never ends, so returning it for a HEAD (or anything
  // but GET) hangs the runtime trying to close out that body. Answer those
  // with headers only, without ever opening the upstream connection.
  if (request.method !== 'GET') {
    return new Response(null, { status: 200, headers });
  }

  let socket;
  try {
    socket = connect({ hostname: ICECAST_HOST, port: ICECAST_PORT });
    const writer = socket.writable.getWriter();
    const req =
      `GET ${ICECAST_PATH} HTTP/1.0\r\n` +
      `Host: ${ICECAST_HOST}:${ICECAST_PORT}\r\n` +
      `Icy-MetaData: 0\r\n` + // keep the body pure audio, no inline metadata frames
      `Connection: close\r\n\r\n`;
    await writer.write(new TextEncoder().encode(req));
    writer.releaseLock();
  } catch (e) {
    return debug
      ? json({ error: 'connect-threw', detail: String(e) })
      : new Response('Stream unavailable', { status: 502 });
  }

  const reader = socket.readable.getReader();
  const CRLFCRLF = [0x0d, 0x0a, 0x0d, 0x0a];
  let buffered = new Uint8Array(0);
  let headerEnd = -1;

  // Icecast's greeting (status line + headers, ending \r\n\r\n) always
  // arrives well before it starts streaming megabytes of audio, so reading
  // a handful of small chunks to find that boundary is cheap and bounded —
  // unlike trying to buffer the (unbounded) body that follows it.
  try {
    while (headerEnd === -1) {
      const { value, done } = await reader.read();
      if (done) throw new Error('socket closed before headers completed');
      const combined = new Uint8Array(buffered.length + value.length);
      combined.set(buffered, 0);
      combined.set(value, buffered.length);
      buffered = combined;
      headerEnd = findSubsequence(buffered, CRLFCRLF);
      if (buffered.length > 16384 && headerEnd === -1) {
        throw new Error('response headers exceeded 16KB without terminating');
      }
    }
  } catch (e) {
    reader.cancel().catch(() => {});
    return debug
      ? json({ error: 'header-read-failed', detail: String(e) })
      : new Response('Stream unavailable', { status: 502 });
  }

  const headerText = new TextDecoder().decode(buffered.slice(0, headerEnd));
  const leadingBody = buffered.slice(headerEnd + CRLFCRLF.length);
  const statusLine = headerText.split('\r\n')[0] || '';
  const statusMatch = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/);
  const upstreamStatus = statusMatch ? parseInt(statusMatch[1], 10) : null;

  if (upstreamStatus !== 200) {
    reader.cancel().catch(() => {});
    return debug
      ? json({ error: 'bad-upstream-status', statusLine, headerText })
      : new Response('Stream unavailable', { status: 502 });
  }

  const contentTypeMatch = headerText.match(/^Content-Type:\s*(.+)$/im);
  if (contentTypeMatch) headers['Content-Type'] = contentTypeMatch[1].trim();

  const body = new ReadableStream({
    start(controller) {
      if (leadingBody.length > 0) controller.enqueue(leadingBody);
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel().catch(() => {});
      socket.close().catch(() => {});
    },
  });

  return new Response(body, { status: 200, headers });
}

function findSubsequence(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

async function handleNowPlaying(env, debug) {
  const apiKey = env.SPINITRON_API_KEY;
  if (!apiKey) return offAir(debug, 'no-key');

  let res;
  try {
    res = await fetch('https://spinitron.com/api/spins?count=1', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    return offAir(debug, 'fetch-error', String(e));
  }
  if (!res.ok) {
    return offAir(debug, 'bad-status', `${res.status} ${await res.text().catch(() => '')}`);
  }

  const data = await res.json().catch(() => null);
  if (!data) return offAir(debug, 'bad-json');
  const spin = data.items?.[0];
  if (!spin?.start) return offAir(debug, 'no-spin', debug ? JSON.stringify(data) : undefined);

  const start = Date.parse(spin.start);
  const durationMs = (spin.duration || 0) * 1000;
  const end = start + durationMs;
  const live = Date.now() <= end + LIVE_GRACE_MS;

  if (!live) return offAir(debug, 'spin-expired');

  return json({
    live: true,
    artist: spin.artist || null,
    song: spin.song || null,
    release: spin.release || null,
    _rawSpin: debug ? spin : undefined,
  });
}

function offAir(debug, reason, detail) {
  return json(debug ? { live: false, reason, detail } : { live: false });
}

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
