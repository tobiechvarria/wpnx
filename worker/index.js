// Static-asset Worker with a couple of live routes bolted on. Everything
// else falls through to the static build in ./dist untouched (see
// wrangler.jsonc run_worker_first).

const LIVE_GRACE_MS = 5 * 60 * 1000; // spin logging can lag the actual airing

// Icecast source is plain HTTP (no TLS on that port) and wpnx.org is HTTPS,
// so a browser <audio src> pointed straight at it is mixed content and gets
// silently blocked/upgraded-and-failed. /api/stream fetches it server-side
// (no mixed-content rule applies to a Worker's own fetch) and pipes the
// response straight through — see chat for how this was diagnosed.
const ICECAST_STREAM_URL = 'http://158.101.102.214:8000/stream';

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

  let upstream;
  try {
    upstream = await fetch(ICECAST_STREAM_URL, {
      method: 'GET',
      headers: { 'Icy-MetaData': '0' }, // keep the body pure audio, no inline metadata frames
      cf: { cacheTtl: 0 },
    });
  } catch (e) {
    return debug
      ? json({ error: 'fetch-threw', detail: String(e), stack: e && e.stack })
      : new Response('Stream unavailable', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return debug
      ? json({ error: 'bad-upstream', status: upstream.status, statusText: upstream.statusText, headers: [...upstream.headers.entries()] })
      : new Response('Stream unavailable', { status: 502 });
  }

  headers['Content-Type'] = upstream.headers.get('Content-Type') || 'audio/mpeg';
  return new Response(upstream.body, { status: 200, headers });
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
