// Only one audio source may play at a time: the live stream and each episode
// card claim playback here, and whoever was playing before is stopped. Two at
// once sounds like an echo (the stream trails the episode by seconds).

export interface PlaybackRegistry {
  /** `owner` starts playing; `stop` pauses it and resets its UI. Stops the previous owner. */
  claim(owner: string, stop: () => void): void;
  /** `owner` stopped on its own (paused or ended). */
  release(owner: string): void;
}

function createRegistry(): PlaybackRegistry {
  let current: { owner: string; stop: () => void } | null = null;
  return {
    claim(owner, stop) {
      if (current && current.owner !== owner) current.stop();
      current = { owner, stop };
    },
    release(owner) {
      if (current?.owner === owner) current = null;
    },
  };
}

/** One registry per window, shared by the layout's script and the Shows page's script (they bundle separately). */
export function getPlaybackRegistry(win: Record<string, unknown>): PlaybackRegistry {
  return ((win.__dlPlayback as PlaybackRegistry | undefined) ??= createRegistry());
}
