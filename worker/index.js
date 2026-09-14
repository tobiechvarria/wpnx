// Static-asset Worker with a couple of live routes bolted on. Everything
// else falls through to the static build in ./dist untouched (see
// wrangler.jsonc run_worker_first).

import { connect } from 'cloudflare:sockets';

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

// Playlist -> DJ name barely ever changes (a playlist runs a full hour) while
// /api/now-playing gets polled every 45s per listener, so this holds the one
// most-recently-resolved playlist_id -> persona name for the Worker
// isolate's lifetime rather than re-fetching playlist+persona on every poll.
// Isolates recycle on their own schedule, which just means an occasional
// cache miss — never staleness, since it's still keyed by playlist_id.
let djCache = { playlistId: null, name: null };

async function resolveDj(env, playlistId) {
  if (!playlistId) return null;
  if (djCache.playlistId === playlistId) return djCache.name;

  const apiKey = env.SPINITRON_API_KEY;
  try {
    const pRes = await fetch(`https://spinitron.com/api/playlists/${playlistId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const playlist = await pRes.json().catch(() => null);
    if (!playlist?.persona_id) {
      djCache = { playlistId, name: null };
      return null;
    }
    const personaRes = await fetch(`https://spinitron.com/api/personas/${playlist.persona_id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const persona = await personaRes.json().catch(() => null);
    const name = persona?.name || null;
    djCache = { playlistId, name };
    return name;
  } catch {
    return null;
  }
}

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

// Small, finite Icecast responses (unlike the unbounded /stream body) — reads
// the raw socket to completion (Connection: close) and returns the decoded
// body. Same raw-TCP approach as handleStream and for the same reason: a
// plain fetch() to this non-standard port gets silently rewritten to port 80
// once deployed.
async function fetchIcecastPath(path) {
  const socket = connect({ hostname: ICECAST_HOST, port: ICECAST_PORT });
  const writer = socket.writable.getWriter();
  const req =
    `GET ${path} HTTP/1.0\r\n` +
    `Host: ${ICECAST_HOST}:${ICECAST_PORT}\r\n` +
    `Connection: close\r\n\r\n`;
  await writer.write(new TextEncoder().encode(req));
  writer.releaseLock();

  const reader = socket.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(combined);
  const headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('Icecast response had no header terminator');
  const statusLine = text.slice(0, text.indexOf('\r\n'));
  if (!/^HTTP\/1\.[01]\s+200\b/.test(statusLine)) {
    throw new Error(`Icecast returned ${statusLine}`);
  }
  return text.slice(headerEnd + 4);
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

// Artist/song come straight from Icecast's own live status, not Spinitron:
// Spinitron's spin log is auto-detected from the stream and can lag the
// actual audio by minutes (confirmed directly — Icecast's status-json.xsl
// had already moved to the next track while /api/spins still reported the
// previous one). Icecast's title updates the instant the source changes, so
// it's the only genuinely real-time source for what's playing right now.
// DJ name has no Icecast equivalent, so that part alone still comes from
// Spinitron's spin -> playlist -> persona chain, resolved independently
// and best-effort: a Spinitron hiccup shouldn't take down artist/song too.
async function handleNowPlaying(env, debug) {
  let body;
  try {
    body = await fetchIcecastPath('/status-json.xsl');
  } catch (e) {
    return offAir(debug, 'icecast-fetch-failed', String(e));
  }

  let status;
  try {
    status = JSON.parse(body);
  } catch (e) {
    return offAir(debug, 'bad-icecast-json', String(e));
  }

  const rawSource = status.icestats?.source;
  const source = Array.isArray(rawSource) ? rawSource[0] : rawSource;
  if (!source) return offAir(debug, 'no-source');

  const title = (source.title || '').trim();
  const sepIndex = title.indexOf(' - ');
  const artist = sepIndex === -1 ? null : title.slice(0, sepIndex).trim() || null;
  const song = sepIndex === -1 ? null : title.slice(sepIndex + 3).trim() || null;

  let dj = null;
  try {
    const apiKey = env.SPINITRON_API_KEY;
    if (apiKey) {
      const res = await fetch('https://spinitron.com/api/spins?count=1', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const spinData = await res.json().catch(() => null);
        const playlistId = spinData?.items?.[0]?.playlist_id;
        if (playlistId) dj = await resolveDj(env, playlistId);
      }
    }
  } catch {
    // DJ name is best-effort — a Spinitron problem shouldn't hide the
    // artist/song data we already have straight from Icecast.
  }

  return json({ live: true, artist, song, dj });
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
