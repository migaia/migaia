/**
 * Shared binary wire helpers used by persistence and SSR codecs. Pure algorithm, no host
 * `btoa`/`atob`.
 */

// base64 把 3 字节编成 4 字符；片大小必须是 3 的倍数，否则非对齐的片边界会让 `=` 填充
// 插进流中间，污染后面每一片。
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CHUNK_BYTES = 0x7ffd - (0x7ffd % 3); // 32763，3 的倍数

/** 编码一个 3 对齐的字节块（无填充）。调用方保证 `chunk.length` 是 3 的倍数。 */
function encodeTripleAligned(chunk: Uint8Array): string {
  let result = '';
  for (let i = 0; i < chunk.length; i += 3) {
    const n = (chunk[i] << 16) | (chunk[i + 1] << 8) | chunk[i + 2];
    result +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      ALPHABET[(n >> 6) & 63] +
      ALPHABET[n & 63];
  }
  return result;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length <= CHUNK_BYTES) {
    return encodeWithPadding(bytes);
  }
  const parts: string[] = [];
  const aligned = bytes.length - (bytes.length % 3);
  for (let offset = 0; offset < aligned; offset += CHUNK_BYTES) {
    parts.push(
      encodeTripleAligned(bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, aligned)))
    );
  }
  if (aligned < bytes.length) {
    parts.push(encodeWithPadding(bytes.subarray(aligned)));
  }
  return parts.join('');
}

/** 完整编码，含末尾 `=` 填充（仅最后一个非 3 对齐的块需要）。 */
function encodeWithPadding(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    result += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    result += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    result += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return result;
}

/**
 * 逐片产出 base64 文本，供写入 sink（`WritableStream`、分块上传）的调用方——它永远不需要整份 base64 字符串一次成型。`bytesToBase64`
 * 仍是「最终只要一个字符串」时的正确选择。
 */
export function* streamBase64Chunks(bytes: Uint8Array): Generator<string, void, void> {
  if (bytes.length === 0) return;
  if (bytes.length <= CHUNK_BYTES) {
    yield encodeWithPadding(bytes);
    return;
  }
  const aligned = bytes.length - (bytes.length % 3);
  for (let offset = 0; offset < aligned; offset += CHUNK_BYTES) {
    yield encodeTripleAligned(bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, aligned)));
  }
  if (aligned < bytes.length) {
    yield encodeWithPadding(bytes.subarray(aligned));
  }
}

const DECODE_TABLE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DECODE_TABLE[ALPHABET.charCodeAt(i)] = i;

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const output = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? DECODE_TABLE[code] : -1;
    if (value < 0) throw new TypeError('invalid base64 input');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[outIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return output;
}
