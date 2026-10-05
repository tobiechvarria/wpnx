import { describe, expect, it, vi } from 'vitest';
import { createStreamKeeper, RETRY_DELAYS_MS, STALL_MS } from './streamKeeper';

/** A fake clock: schedule() queues timers that advance() fires in order. */
function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    schedule(fn: () => void, ms: number) {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.live && t.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.live = false;
        next.fn();
      }
      now = until;
      timers = timers.filter((t) => t.live);
    },
  };
}

function setup() {
  const clock = fakeClock();
  const deps = { reconnect: vi.fn(), giveUp: vi.fn(), reconnecting: vi.fn(), schedule: clock.schedule };
  return { clock, deps, keeper: createStreamKeeper(deps) };
}

describe('stream keeper', () => {
  it('reconnects after a short wait when the stream drops while the listener wants it', () => {
    const { clock, deps, keeper } = setup();
    keeper.start();
    keeper.playing();
    keeper.dropped();
    expect(deps.reconnecting).toHaveBeenCalledWith(1);
    expect(deps.reconnect).not.toHaveBeenCalled();
    clock.advance(RETRY_DELAYS_MS[0]!);
    expect(deps.reconnect).toHaveBeenCalledOnce();
  });

  it('does nothing when the listener paused it themselves', () => {
    const { clock, deps, keeper } = setup();
    keeper.start();
    keeper.playing();
    keeper.stop();
    keeper.dropped();
    clock.advance(60_000);
    expect(deps.reconnect).not.toHaveBeenCalled();
    expect(deps.giveUp).not.toHaveBeenCalled();
  });

  it('cancels a pending reconnect when the listener pauses', () => {
    const { clock, deps, keeper } = setup();
    keeper.start();
    keeper.dropped();
    keeper.stop();
    clock.advance(60_000);
    expect(deps.reconnect).not.toHaveBeenCalled();
  });

  it('waits longer after each failed attempt, then gives up', () => {
    const { clock, deps, keeper } = setup();
    keeper.start();
    for (const delay of RETRY_DELAYS_MS) {
      keeper.dropped();
      clock.advance(delay - 1);
      const before = deps.reconnect.mock.calls.length;
      clock.advance(1);
      expect(deps.reconnect.mock.calls.length).toBe(before + 1);
    }
    keeper.dropped();
    expect(deps.giveUp).toHaveBeenCalledOnce();
    expect(keeper.wanted).toBe(false);
  });

  it('starts counting attempts again once audio flows', () => {
    const { clock, deps, keeper } = setup();
    keeper.start();
    keeper.dropped();
    clock.advance(RETRY_DELAYS_MS[0]!);
    keeper.playing();
    keeper.dropped();
    expect(deps.reconnecting).toHaveBeenLastCalledWith(1);
  });

  it('treats one drop reported twice (error then ended) as a single reconnect', () => {
    const { clock, deps, keeper } = setup();
    keeper.start();
    keeper.dropped();
    keeper.dropped();
    clock.advance(RETRY_DELAYS_MS[0]!);
    expect(deps.reconnect).toHaveBeenCalledOnce();
  });

  it('reconnects when audio silently stops arriving', () => {
    const { clock, deps, keeper } = setup();
    keeper.start();
    keeper.playing();
    clock.advance(STALL_MS - 1);
    keeper.progress();
    clock.advance(STALL_MS - 1);
    expect(deps.reconnecting).not.toHaveBeenCalled();
    clock.advance(1);
    expect(deps.reconnecting).toHaveBeenCalledWith(1);
  });

  it('counts a reconnect that never produces audio as another drop', () => {
    const { clock, deps, keeper } = setup();
    keeper.start();
    keeper.dropped();
    clock.advance(RETRY_DELAYS_MS[0]!);
    clock.advance(STALL_MS);
    expect(deps.reconnecting).toHaveBeenLastCalledWith(2);
  });
});
