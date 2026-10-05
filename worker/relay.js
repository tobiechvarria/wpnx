// Streams the Icecast socket to the listener without touching each chunk in
// JavaScript. A JS pull() loop costs CPU on every chunk, and the Workers free
// plan allows 10 ms of CPU per request, so a live stream was being killed
// ("Worker exceeded CPU time limit") a few seconds in. pipeTo() between the
// socket and an IdentityTransformStream is handled natively by the runtime.
//
// `leading` is the audio that arrived in the same reads as the HTTP headers.
// `onDone` runs once the relay stops for any reason (listener left, upstream
// ended or failed), so the caller can close the socket.
export function relayBody(leading, upstream, { Identity = globalThis.IdentityTransformStream, onDone = () => {} } = {}) {
  const { readable, writable } = new Identity();
  (async () => {
    if (leading.length > 0) {
      const writer = writable.getWriter();
      await writer.write(leading);
      writer.releaseLock();
    }
    await upstream.pipeTo(writable);
  })()
    .catch(() => {
      // Listener disconnects and upstream resets both land here; pipeTo has
      // already cancelled or errored the other side.
      upstream.cancel().catch(() => {});
    })
    .finally(onDone);
  return readable;
}
