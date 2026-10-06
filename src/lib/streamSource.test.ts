import { describe, expect, it } from 'vitest';
import { createSourcePicker, STREAM_URLS } from './streamSource';

describe('stream source picker', () => {
  it('plays the direct HTTPS stream first, with the site relay as the fallback', () => {
    expect(STREAM_URLS).toEqual(['https://stream.wpnx.org/stream', '/api/stream']);
    expect(createSourcePicker(STREAM_URLS).current()).toBe('https://stream.wpnx.org/stream');
  });

  it('switches to the next source after a failure, and back again after another', () => {
    const p = createSourcePicker(['a', 'b']);
    p.failed();
    expect(p.current()).toBe('b');
    p.failed();
    expect(p.current()).toBe('a');
  });

  it('starts from the first source again each time the listener presses play', () => {
    const p = createSourcePicker(['a', 'b']);
    p.failed();
    p.reset();
    expect(p.current()).toBe('a');
  });
});
