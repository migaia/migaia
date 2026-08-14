/** Shared binary wire helpers used by persistence and SSR codecs. */

// A byte-per-iteration `binary += String.fromCharCode(bytes[i])` loop, plus a
// single whole-input `btoa()` call, means a 71MB payload briefly holds the
// original Uint8Array, a 71M-character binary string, and the full base64
// output simultaneously — several times the input size in peak memory, on
// the main thread, for a codec whose whole point is handling large payloads.
//
// Chunking bounds the binary-string and per-chunk btoa() work to one chunk at
// a time; only the final concatenated base64 string is still held in full
// (persist.ts/ssr.ts want one string back, not a stream — see
// streamBase64Chunks below for a caller that wants to avoid even that).
//
// The chunk size must be a multiple of 3: base64 encodes 3 bytes into 4
// characters, so a chunk boundary that isn't 3-aligned makes btoa() insert
// `=` padding mid-stream, corrupting every chunk after the first non-aligned
// one. `String.fromCharCode(...chunk)` also has to stay well under engines'
// max-arguments-per-call limit (~65536 in most).
const CHUNK_BYTES = 0x7ffd - (0x7ffd % 3); // 32763, a multiple of 3

export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length <= CHUNK_BYTES) {
    return btoa(bytesChunkToBinary(bytes));
  }
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    result += btoa(bytesChunkToBinary(bytes.subarray(offset, offset + CHUNK_BYTES)));
  }
  return result;
}

function bytesChunkToBinary(chunk: Uint8Array): string {
  // One call per (small, bounded) chunk instead of one call per byte.
  return String.fromCharCode(...chunk);
}

/**
 * Same chunking as `bytesToBase64`, but yields each chunk instead of concatenating them — for a
 * caller writing into a sink (a `WritableStream`, a chunked upload) that never needs the complete
 * base64 string materialized at once. `bytesToBase64` stays the right choice for a caller that
 * ultimately wants one string back (e.g. a JSON/localStorage field): joining these chunks yourself
 * would just rebuild that same string with extra steps.
 */
export function* streamBase64Chunks(bytes: Uint8Array): Generator<string, void, void> {
  if (bytes.length <= CHUNK_BYTES) {
    if (bytes.length > 0) yield btoa(bytesChunkToBinary(bytes));
    return;
  }
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    yield btoa(bytesChunkToBinary(bytes.subarray(offset, offset + CHUNK_BYTES)));
  }
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
