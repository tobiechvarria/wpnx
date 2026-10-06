import { describe, expect, it, vi } from 'vitest';
import { createNowPlayingPoller, fromIcecastStatus, mergeNowPlaying, parseIcecastTitle, SITE_MS, SONG_MS } from './nowPlaying';

describe('parseIcecastTitle', () => {
  it('splits "Artist - Song"', () => {
    expect(parseIcecastTitle('Escape-ism - Number 1 Record')).toEqual({ artist: 'Escape-ism', song: 'Number 1 Record' });
  });
  it('keeps whichever half exists in a messy title', () => {
    expect(parseIcecastTitle(' - The Phread Show- World Indie Show')).toEqual({ artist: null, song: 'The Phread Show- World Indie Show' });
    expect(parseIcecastTitle('Shut Eye -')).toEqual({ artist: 'Shut Eye', song: null });
    expect(parseIcecastTitle('Station ID')).toEqual({ artist: null, song: 'Station ID' });
    expect(parseIcecastTitle('')).toEqual({ artist: null, song: null });
  });
});

describe('fromIcecastStatus', () => {
  it('reads the first source as live', () => {
    const status = { icestats: { source: { title: 'Al Green - Love and Happiness' } } };
    expect(fromIcecastStatus(status)).toEqual({ live: true, artist: 'Al Green', song: 'Love and Happiness' });
  });
  it('handles a list of sources, and no source at all (off air)', () => {
    expect(fromIcecastStatus({ icestats: { source: [{ title: 'A - B' }, { title: 'C - D' }] } })).toEqual({ live: true, artist: 'A', song: 'B' });
    expect(fromIcecastStatus({ icestats: {} })).toEqual({ live: false, artist: null, song: null });
    expect(fromIcecastStatus(null)).toBeNull();
  });
});

describe('mergeNowPlaying', () => {
  const site = { live: true, artist: 'Old', song: 'Track', dj: 'Kreative Kontrol' };
  it("takes the song from Icecast and the DJ from the site", () => {
    expect(mergeNowPlaying({ live: true, artist: 'New', song: 'Song' }, site)).toEqual({ live: true, artist: 'New', song: 'Song', dj: 'Kreative Kontrol' });
  });
  it('falls back to the site for the song when Icecast could not be read', () => {
    expect(mergeNowPlaying(null, site)).toEqual(site);
  });
  it('works before the DJ is known', () => {
    expect(mergeNowPlaying({ live: true, artist: 'A', song: 'B' }, null)).toEqual({ live: true, artist: 'A', song: 'B', dj: null });
  });
  it('is unknown when neither source answered', () => {
    expect(mergeNowPlaying(null, null)).toBeNull();
  });
});

/** A fake clock whose timers advance() fires in order. */
function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => now,
    schedule(fn: () => void, ms: number) {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.live && t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.live = false;
        next.fn();
        await new Promise((r) => setTimeout(r, 0)); // let the fetches settle
      }
      now = until;
      timers = timers.filter((t) => t.live);
    },
  };
}

function setup(opts: { song?: () => Promise<unknown>; site?: () => Promise<unknown>; visible?: () => boolean } = {}) {
  const clock = fakeClock();
  const fetchSong = vi.fn(opts.song ?? (async () => ({ icestats: { source: { title: 'A - B' } } })));
  const fetchSite = vi.fn(opts.site ?? (async () => ({ live: true, artist: 'A', song: 'B', dj: 'DJ' })));
  const onUpdate = vi.fn();
  const poller = createNowPlayingPoller({ fetchSong, fetchSite, onUpdate, schedule: clock.schedule, now: clock.now, visible: opts.visible ?? (() => true) });
  return { clock, fetchSong, fetchSite, onUpdate, poller };
}

describe('now-playing poller', () => {
  it('shows the song and DJ straight away, then checks the song often and the DJ rarely', async () => {
    const { clock, fetchSong, fetchSite, onUpdate, poller } = setup();
    poller.start();
    await clock.advance(0);
    expect(onUpdate).toHaveBeenLastCalledWith({ live: true, artist: 'A', song: 'B', dj: 'DJ' });
    await clock.advance(SITE_MS - 1);
    expect(fetchSong.mock.calls.length).toBe(1 + Math.floor((SITE_MS - 1) / SONG_MS));
    expect(fetchSite).toHaveBeenCalledTimes(1);
    await clock.advance(SONG_MS);
    expect(fetchSite).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('only updates the page when something changed', async () => {
    const { clock, onUpdate, poller } = setup();
    poller.start();
    await clock.advance(SONG_MS * 3);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('gets the song from the site every check while Icecast cannot be read', async () => {
    const { clock, fetchSite, onUpdate, poller } = setup({ song: async () => { throw new Error('blocked'); } });
    poller.start();
    await clock.advance(0);
    expect(onUpdate).toHaveBeenLastCalledWith({ live: true, artist: 'A', song: 'B', dj: 'DJ' });
    await clock.advance(SONG_MS * 2);
    expect(fetchSite).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('does not check while the page is hidden', async () => {
    let visible = true;
    const { clock, fetchSong, poller } = setup({ visible: () => visible });
    poller.start();
    await clock.advance(0);
    visible = false;
    const before = fetchSong.mock.calls.length;
    await clock.advance(SONG_MS * 5);
    expect(fetchSong.mock.calls.length).toBe(before);
    visible = true;
    poller.wake();
    await clock.advance(0);
    expect(fetchSong.mock.calls.length).toBe(before + 1);
    poller.stop();
  });

  it('stops checking when stopped', async () => {
    const { clock, fetchSong, poller } = setup();
    poller.start();
    await clock.advance(0);
    poller.stop();
    await clock.advance(SONG_MS * 5);
    expect(fetchSong).toHaveBeenCalledTimes(1);
  });
});
