import { describe, expect, it, vi } from 'vitest';
import { relayBody } from './relay.js';

const bytes = (...xs) => new Uint8Array(xs);

function upstreamOf(chunks, { onCancel, fail } = {}) {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      if (fail) c.error(new Error('socket reset'));
      else c.close();
    },
    cancel: onCancel,
  });
}

async function readAll(stream) {
  const out = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(...value);
  }
  return out;
}

// Node has no IdentityTransformStream (a Workers built-in); a plain TransformStream behaves the same.
const opts = { Identity: TransformStream };

describe('relayBody', () => {
  it('sends the bytes read with the headers first, then the rest of the stream, unchanged', async () => {
    const body = relayBody(bytes(1, 2), upstreamOf([bytes(3, 4), bytes(5)]), opts);
    expect(await readAll(body)).toEqual([1, 2, 3, 4, 5]);
  });

  it('works when no audio arrived with the headers', async () => {
    const body = relayBody(new Uint8Array(0), upstreamOf([bytes(9)]), opts);
    expect(await readAll(body)).toEqual([9]);
  });

  it('cancels the upstream and closes the socket when the listener goes away', async () => {
    const onCancel = vi.fn();
    const onDone = vi.fn();
    const upstream = new ReadableStream({ pull() {}, cancel: onCancel }); // never ends, like a live stream
    const body = relayBody(bytes(1), upstream, { ...opts, onDone });
    const reader = body.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('ends the listener stream (instead of hanging) when the upstream fails', async () => {
    const onDone = vi.fn();
    const body = relayBody(bytes(1), upstreamOf([bytes(2)], { fail: true }), { ...opts, onDone });
    await expect(readAll(body)).rejects.toThrow();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
