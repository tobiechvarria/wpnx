import { describe, expect, it, vi } from 'vitest';
import { getPlaybackRegistry } from './playback';

const fresh = () => getPlaybackRegistry({} as Record<string, unknown>);

describe('playback registry', () => {
  it('stops the live stream when an episode starts', () => {
    const r = fresh();
    const stopLive = vi.fn();
    r.claim('live', stopLive);
    r.claim('episode-1', vi.fn());
    expect(stopLive).toHaveBeenCalledOnce();
  });

  it('stops a playing episode when the live stream starts', () => {
    const r = fresh();
    const stopEpisode = vi.fn();
    r.claim('episode-1', stopEpisode);
    r.claim('live', vi.fn());
    expect(stopEpisode).toHaveBeenCalledOnce();
  });

  it('stops the previous episode when another episode starts', () => {
    const r = fresh();
    const stopFirst = vi.fn();
    r.claim('episode-1', stopFirst);
    r.claim('episode-2', vi.fn());
    expect(stopFirst).toHaveBeenCalledOnce();
  });

  it('does not stop a player that claims again (resume or re-press)', () => {
    const r = fresh();
    const stop = vi.fn();
    r.claim('live', stop);
    r.claim('live', stop);
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not stop anything once the owner has released its claim', () => {
    const r = fresh();
    const stopLive = vi.fn();
    r.claim('live', stopLive);
    r.release('live');
    r.claim('episode-1', vi.fn());
    expect(stopLive).not.toHaveBeenCalled();
  });

  it('ignores a release from a player that is not the current one', () => {
    const r = fresh();
    const stopLive = vi.fn();
    r.claim('live', stopLive);
    r.release('episode-1');
    r.claim('episode-2', vi.fn());
    expect(stopLive).toHaveBeenCalledOnce();
  });

  it('is shared by every script on the same window', () => {
    const win: Record<string, unknown> = {};
    const stopLive = vi.fn();
    getPlaybackRegistry(win).claim('live', stopLive);
    getPlaybackRegistry(win).claim('episode-1', vi.fn());
    expect(stopLive).toHaveBeenCalledOnce();
  });
});
