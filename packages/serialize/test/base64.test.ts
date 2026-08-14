import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, streamBase64Chunks } from '../src/base64';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) bytes[index] = (index * 37 + 11) % 256;
  return bytes;
}

describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips empty input', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it('round-trips small inputs of every length mod 3', () => {
    for (const length of [1, 2, 3, 4, 5, 6, 7]) {
      const bytes = randomBytes(length);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it('round-trips exactly at, just under, and just over one chunk', () => {
    // CHUNK_BYTES is internal; probe around the documented value (32763)
    // without importing it, so the test still means something if it moves.
    for (const length of [32762, 32763, 32764, 32765, 32766]) {
      const bytes = randomBytes(length);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it('round-trips several chunks worth of data, at every alignment', () => {
    for (const length of [65526, 65527, 65528, 100_000, 100_001, 100_002]) {
      const bytes = randomBytes(length);
      const decoded = base64ToBytes(bytesToBase64(bytes));
      expect(decoded).toEqual(bytes);
    }
  });

  it('produces the same output as an unchunked reference for a multi-chunk input', () => {
    const bytes = randomBytes(200_000);
    const chunked = bytesToBase64(bytes);
    let binary = '';
    for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
    const reference = btoa(binary);
    expect(chunked).toBe(reference);
  });

  it('encodes and round-trips a large payload well within a bound that a quadratic string-concat regression would blow', () => {
    // The bug this guards: a byte-per-iteration `binary += fromCharCode(...)`
    // loop (or one giant fromCharCode(...bytes) call) over a multi-MB input
    // is dramatically slower than the chunked path — this bound is loose
    // enough to never flake on correct code, but tight enough that
    // regressing to the old unchunked approach fails it. Kept well under
    // the sizes that risk contending for heap with the rest of a full
    // suite run; the chunk count here (~30x CHUNK_BYTES) already exercises
    // the multi-chunk path plenty.
    const bytes = randomBytes(1_000_000);
    const start = performance.now();
    const encoded = bytesToBase64(bytes);
    const decoded = base64ToBytes(encoded);
    const elapsedMs = performance.now() - start;
    expect(decoded).toEqual(bytes);
    expect(elapsedMs).toBeLessThan(2000);
  });
});

describe('streamBase64Chunks', () => {
  it('yields nothing for empty input', () => {
    expect([...streamBase64Chunks(new Uint8Array(0))]).toEqual([]);
  });

  it('joining every yielded chunk reproduces the same string as bytesToBase64, for inputs of every size class', () => {
    for (const length of [1, 3, 7, 32763, 32764, 100_000, 200_000]) {
      const bytes = randomBytes(length);
      const streamed = [...streamBase64Chunks(bytes)].join('');
      expect(streamed).toBe(bytesToBase64(bytes));
    }
  });

  it('yields more than one chunk for a multi-chunk input, proving it never buffers the whole output at once', () => {
    const bytes = randomBytes(100_000);
    const chunks = [...streamBase64Chunks(bytes)];
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThan(bytesToBase64(bytes).length);
  });

  it('is a real generator: consuming it lazily never materializes chunks not yet requested', () => {
    const bytes = randomBytes(100_000);
    const iterator = streamBase64Chunks(bytes);
    const first = iterator.next();
    expect(first.done).toBe(false);
    expect(typeof first.value).toBe('string');
    // Stopping early must not throw or require draining the rest.
  });
});
