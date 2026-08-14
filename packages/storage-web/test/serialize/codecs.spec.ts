import { describe, expect, it } from 'vitest';
import { jsonCodec, structuredCodec, binaryCodec } from '../../src/serialize';

describe('jsonCodec', () => {
  it('对象往返', async () => {
    const value = { a: 1, b: [1, 2, 3], c: 'text' };
    const encoded = await jsonCodec.encode(value);
    expect(typeof encoded).toBe('string');
    await expect(jsonCodec.decode(encoded)).resolves.toEqual(value);
  });

  it('undefined 编码为 "null" 字符串', async () => {
    await expect(jsonCodec.encode(undefined)).resolves.toBe('null');
  });

  it('不可序列化的值（BigInt）编码抛 SERIALIZE_FAILED', async () => {
    await expect(jsonCodec.encode({ n: 1n })).rejects.toMatchObject({
      code: 'SERIALIZE_FAILED'
    });
  });

  it('非法 JSON 解码抛 DESERIALIZE_FAILED', async () => {
    await expect(jsonCodec.decode('{not json')).rejects.toMatchObject({
      code: 'DESERIALIZE_FAILED'
    });
  });

  it('output 声明为 text', () => {
    expect(jsonCodec.output).toBe('text');
  });
});

describe('structuredCodec', () => {
  it('恒等编解码，保留对象引用', async () => {
    const value = { nested: new Map([['a', 1]]) };
    const encoded = await structuredCodec.encode(value);
    expect(encoded).toBe(value);
    await expect(structuredCodec.decode(encoded)).resolves.toBe(value);
  });

  it('output 声明为 structured', () => {
    expect(structuredCodec.output).toBe('structured');
  });
});

describe('binaryCodec', () => {
  it('Uint8Array 往返', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const encoded = await binaryCodec.encode(bytes);
    await expect(binaryCodec.decode(encoded)).resolves.toEqual(bytes);
  });

  it('接受来自另一个 realm 的 Uint8Array', async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const ForeignUint8Array = (
      iframe.contentWindow as Window & { readonly Uint8Array: typeof Uint8Array }
    ).Uint8Array;
    const bytes = new ForeignUint8Array([4, 5, 6]);
    await expect(binaryCodec.encode(bytes)).resolves.toBe(bytes);
    await expect(binaryCodec.decode(bytes)).resolves.toBe(bytes);
    iframe.remove();
  });

  it('encode 拒绝非 Uint8Array', async () => {
    await expect(binaryCodec.encode('not bytes' as never)).rejects.toMatchObject({
      code: 'SERIALIZE_FAILED'
    });
  });

  it('decode 拒绝非 Uint8Array', async () => {
    await expect(binaryCodec.decode('not bytes' as never)).rejects.toMatchObject({
      code: 'DESERIALIZE_FAILED'
    });
  });

  it('output 声明为 binary', () => {
    expect(binaryCodec.output).toBe('binary');
  });
});
