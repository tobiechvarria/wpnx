// Static-asset Worker with one live route bolted on: /api/now-playing proxies
// Spinitron server-side, since Spinitron's API refuses browser-origin calls
// and the key can't sit in client JS. Everything else falls through to the
// static build in ./dist untouched (see wrangler.jsonc run_worker_first).

const LIVE_GRACE_MS = 5 * 60 * 1000; // spin logging can lag the actual airing

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/now-playing') {
      return handleNowPlaying(env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleNowPlaying(env) {
  const apiKey = env.SPINITRON_API_KEY;
  if (!apiKey) {
    console.error('now-playing: SPINITRON_API_KEY not set');
    return offAir();
  }

  let res;
  try {
    res = await fetch('https://spinitron.com/api/spins?count=1', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    console.error('now-playing: fetch to Spinitron failed', e);
    return offAir();
  }
  if (!res.ok) {
    console.error('now-playing: Spinitron returned', res.status, await res.text().catch(() => ''));
    return offAir();
  }

  const data = await res.json().catch((e) => {
    console.error('now-playing: could not parse Spinitron response', e);
    return null;
  });
  const spin = data?.items?.[0];
  if (!spin?.start) {
    console.log('now-playing: no current spin from Spinitron (station likely off-air)');
    return offAir();
  }

  const start = Date.parse(spin.start);
  const durationMs = (spin.duration || 0) * 1000;
  const end = start + durationMs;
  const live = Date.now() <= end + LIVE_GRACE_MS;

  if (!live) return offAir();

  return json({
    live: true,
    artist: spin.artist || null,
    song: spin.song || null,
    release: spin.release || null,
  });
}

function offAir() {
  return json({ live: false });
}

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
