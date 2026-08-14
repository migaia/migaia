import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../../src/utils/base64';

describe('base64 往返', () => {
  it('空数组往返', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array()))).toEqual(new Uint8Array());
  });
  it('任意字节值往返（含 0 与 255）', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
  it('较长随机数据往返', () => {
    const bytes = new Uint8Array(1000).map((_, index) => index % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
