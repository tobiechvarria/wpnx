// Where the player gets the live stream. Icecast now serves HTTPS directly
// (stream.wpnx.org), so listeners connect straight to it: no Cloudflare
// Worker in the audio path, so no Worker limits. The Worker relay
// (/api/stream) stays as the fallback if the direct stream ever fails.

export const STREAM_URLS = ['https://stream.wpnx.org/stream', '/api/stream'];

export interface SourcePicker {
  /** The stream URL to play now. */
  current(): string;
  /** The current source failed; use the next one. */
  failed(): void;
  /** The listener pressed play: start from the first (preferred) source. */
  reset(): void;
}

export function createSourcePicker(urls: string[]): SourcePicker {
  let index = 0;
  return {
    current: () => urls[index]!,
    failed() {
      index = (index + 1) % urls.length;
    },
    reset() {
      index = 0;
    },
  };
}
