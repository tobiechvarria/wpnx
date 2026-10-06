// What's playing, for the nav badge and the player. The song comes straight
// from Icecast's own status (it changes the moment the track does), read by
// the browser over HTTPS from stream.wpnx.org: no Worker involved. The DJ
// name needs the Spinitron key, so it comes from the site's /api/now-playing,
// which is asked rarely and also stands in for the song if Icecast can't be read.

export interface Song {
  live: boolean;
  artist: string | null;
  song: string | null;
}

export interface NowPlaying extends Song {
  dj: string | null;
}

/** How often the song is checked, and how often the DJ is. */
export const SONG_MS = 10_000;
export const SITE_MS = 60_000;

export const ICECAST_STATUS_URL = 'https://stream.wpnx.org/status-json.xsl';

// Icecast titles are "Artist - Song" in the clean case, but real station
// content includes messier ones: a themed show block with no per-track
// artist (" - The Phread Show- World Indie Show") or a track missing its song
// tag ("Shut Eye -"). Searching the *untrimmed* title matters: trimming first
// shifts a leading " - " away from index 0 and the split silently fails. Whichever
// half comes back empty after its own trim is null.
export function parseIcecastTitle(rawTitle: string): { artist: string | null; song: string | null } {
  const strictIndex = rawTitle.indexOf(' - ');
  if (strictIndex !== -1) {
    return {
      artist: rawTitle.slice(0, strictIndex).trim() || null,
      song: rawTitle.slice(strictIndex + 3).trim() || null,
    };
  }
  // No "space-dash-space" anywhere: fall back to a bare dash for a title
  // like "Shut Eye -" where only one side of the separator has a space.
  const looseIndex = rawTitle.indexOf('-');
  if (looseIndex !== -1) {
    return {
      artist: rawTitle.slice(0, looseIndex).trim() || null,
      song: rawTitle.slice(looseIndex + 1).trim() || null,
    };
  }
  return { artist: null, song: rawTitle.trim() || null };
}

/** Icecast's status-json.xsl, read as the current song. No source means off air; unreadable is null. */
export function fromIcecastStatus(status: unknown): Song | null {
  if (typeof status !== 'object' || status === null) return null;
  const raw = (status as { icestats?: { source?: unknown } }).icestats?.source;
  const source = (Array.isArray(raw) ? raw[0] : raw) as { title?: string } | undefined;
  if (!source) return { live: false, artist: null, song: null };
  return { live: true, ...parseIcecastTitle(source.title || '') };
}

/** The song from Icecast with the DJ from the site; the site's song stands in when Icecast can't be read. */
export function mergeNowPlaying(song: Song | null, site: NowPlaying | null): NowPlaying | null {
  if (!song) return site;
  return { ...song, dj: site?.dj ?? null };
}

export interface PollerDeps {
  fetchSong(): Promise<unknown>;
  fetchSite(): Promise<NowPlaying>;
  onUpdate(data: NowPlaying): void;
  /** setTimeout that returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
  now(): number;
  /** False while the page is hidden: nothing is checked then. */
  visible(): boolean;
}

export function createNowPlayingPoller(deps: PollerDeps) {
  let song: Song | null = null;
  let site: NowPlaying | null = null;
  let lastSite = -Infinity;
  let lastKey: string | null = null;
  let running = false;
  let cancel: (() => void) | null = null;

  const tick = async () => {
    cancel = null;
    if (!running) return;
    if (deps.visible()) {
      try {
        song = fromIcecastStatus(await deps.fetchSong());
      } catch {
        song = null;
      }
      if (!song || deps.now() - lastSite >= SITE_MS) {
        try {
          site = await deps.fetchSite();
          lastSite = deps.now();
        } catch {
          // keep the last DJ we had
        }
      }
      const merged = mergeNowPlaying(song, site);
      const key = JSON.stringify(merged);
      if (running && merged && key !== lastKey) {
        lastKey = key;
        deps.onUpdate(merged);
      }
    }
    if (running && !cancel) cancel = deps.schedule(tick, SONG_MS);
  };

  return {
    start() {
      if (running) return;
      running = true;
      cancel = deps.schedule(tick, 0);
    },
    stop() {
      running = false;
      cancel?.();
      cancel = null;
    },
    /** Check now (the page became visible again). */
    wake() {
      if (!running) return;
      cancel?.();
      cancel = deps.schedule(tick, 0);
    },
  };
}
