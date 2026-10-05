// Keeps the live stream playing for as long as the listener wants it: when the
// connection drops (an error, the stream ending, or audio silently stopping),
// it reconnects after a short, growing wait, and gives up after a few tries.

/** Wait before each reconnect attempt; one attempt per entry. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
/** No new audio for this long while playing counts as a drop. */
export const STALL_MS = 15000;

export interface KeeperDeps {
  /** Rejoin the live stream (set src and play). */
  reconnect(): void;
  /** Every attempt failed; show the listener it stopped. */
  giveUp(): void;
  /** A reconnect is about to happen; `attempt` starts at 1. */
  reconnecting(attempt: number): void;
  /** setTimeout that returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
}

export interface StreamKeeper {
  readonly wanted: boolean;
  /** The listener pressed play. */
  start(): void;
  /** The listener paused, or something else took over playback. */
  stop(): void;
  /** Audio started playing. */
  playing(): void;
  /** Audio is still arriving (timeupdate). */
  progress(): void;
  /** The stream errored or ended. */
  dropped(): void;
}

export function createStreamKeeper(deps: KeeperDeps): StreamKeeper {
  let wanted = false;
  let attempts = 0;
  let cancelRetry: (() => void) | null = null;
  let cancelStall: (() => void) | null = null;

  const clearStall = () => {
    cancelStall?.();
    cancelStall = null;
  };
  const armStall = () => {
    clearStall();
    cancelStall = deps.schedule(() => {
      cancelStall = null;
      keeper.dropped();
    }, STALL_MS);
  };
  const clearRetry = () => {
    cancelRetry?.();
    cancelRetry = null;
  };

  const keeper: StreamKeeper = {
    get wanted() {
      return wanted;
    },
    start() {
      wanted = true;
      attempts = 0;
      clearRetry();
      armStall();
    },
    stop() {
      wanted = false;
      clearRetry();
      clearStall();
    },
    playing() {
      if (!wanted) return;
      attempts = 0;
      armStall();
    },
    progress() {
      if (wanted && !cancelRetry) armStall();
    },
    dropped() {
      if (!wanted || cancelRetry) return;
      clearStall();
      if (attempts >= RETRY_DELAYS_MS.length) {
        wanted = false;
        deps.giveUp();
        return;
      }
      const delay = RETRY_DELAYS_MS[attempts]!;
      attempts += 1;
      deps.reconnecting(attempts);
      cancelRetry = deps.schedule(() => {
        cancelRetry = null;
        armStall();
        deps.reconnect();
      }, delay);
    },
  };
  return keeper;
}
