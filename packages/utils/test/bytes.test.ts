import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decodeUtf8,
  encodeUtf8,
  splitUtf8,
  streamBase64Chunks
} from '../src/bytes.js';

describe('byte primitives', () => {
  it('round trips canonical base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect([...streamBase64Chunks(bytes, 3)].join('')).toBe(bytesToBase64(bytes));
  });

  it('rejects noncanonical input', () => {
    expect(() => base64ToBytes(' AA==')).toThrow();
  });

  it('keeps UTF-8 behavior host-independent and never splits a code point', () => {
    const value = 'a😀b\ud800';
    expect(decodeUtf8(encodeUtf8(value))).toBe('a😀b�');
    expect(splitUtf8(value, 4)).toEqual(['a', '😀', 'b�']);
    expect(() => decodeUtf8(new Uint8Array([0xc0]), { fatal: true })).toThrow();
  });
});
