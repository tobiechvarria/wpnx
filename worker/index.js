// Static-asset Worker with one live route bolted on: /api/now-playing proxies
// Spinitron server-side, since Spinitron's API refuses browser-origin calls
// and the key can't sit in client JS. Everything else falls through to the
// static build in ./dist untouched (see wrangler.jsonc run_worker_first).

const LIVE_GRACE_MS = 5 * 60 * 1000; // spin logging can lag the actual airing

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/now-playing') {
      return handleNowPlaying(env, url.searchParams.has('debug'));
    }
    return env.ASSETS.fetch(request);
  },
};

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
