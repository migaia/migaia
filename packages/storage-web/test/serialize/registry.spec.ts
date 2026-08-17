import { describe, expect, it } from 'vitest';
import { selectCodec, jsonCodec, structuredCodec, binaryCodec } from '../../src/serialize';
import { assertCodec } from '../../src/serialize/registry';
import type { IStorageCapabilities } from '../../src/types';

const textOnlyCapabilities: IStorageCapabilities = {
  syncRead: true,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  maxValueBytes: 5 * 1024 * 1024,
  opaqueEntries: false
};

const structuredCapabilities: IStorageCapabilities = {
  ...textOnlyCapabilities,
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  maxValueBytes: undefined
};

describe('selectCodec 选路规则', () => {
  it('assertCodec 复用 descriptor 快照校验', () => {
    expect(() => assertCodec(jsonCodec)).not.toThrow();
  });
  it('构造期拒绝畸形 codec、capabilities 与 diagnostic', () => {
    for (const codec of [null, [], {}, { name: 'codec' }, { name: 'codec', output: 'unknown' }])
      expect(() => selectCodec(codec as never, textOnlyCapabilities)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      );
    for (const capabilities of [null, [], {}, { ...textOnlyCapabilities, binary: 'yes' }])
      expect(() => selectCodec(jsonCodec, capabilities as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      );
    expect(() =>
      selectCodec(binaryCodec, textOnlyCapabilities, 'diagnostic' as never)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });
  it('内建 codec runtime descriptor 不可变', () => {
    expect(() => {
      (jsonCodec as unknown as { name: string }).name = 'changed';
    }).toThrow(TypeError);
    expect(() => {
      (structuredCodec as unknown as { name: string }).name = 'changed';
    }).toThrow(TypeError);
    expect(() => {
      (binaryCodec as unknown as { name: string }).name = 'changed';
    }).toThrow(TypeError);
    expect(jsonCodec.name).toBe('json');
    expect(structuredCodec.name).toBe('structured');
    expect(binaryCodec.name).toBe('binary');
  });

  it('规则 1：output 与后端能力匹配时直连', () => {
    const selected = selectCodec(jsonCodec, textOnlyCapabilities);
    expect(selected.encode).toBe(jsonCodec.encode);
    expect(selected.decode).toBe(jsonCodec.decode);
  });

  it('codec descriptor 每个字段只读取一次并返回稳定方法快照', async () => {
    let reads = 0;
    const codec = {
      get name() {
        reads += 1;
        return 'getter-codec';
      },
      get output() {
        reads += 1;
        return 'text' as const;
      },
      get encode() {
        reads += 1;
        return async (value: unknown) => JSON.stringify(value);
      },
      get decode() {
        reads += 1;
        return async (value: string) => JSON.parse(value) as unknown;
      }
    };
    const selected = selectCodec(codec, textOnlyCapabilities);
    await expect(selected.encode({ stable: true })).resolves.toBe('{"stable":true}');
    expect(reads).toBe(4);
  });

  it('规则 2：binary codec 遇 text-only 后端自动 base64 降级', async () => {
    let diagnosed = '';
    const selected = selectCodec(binaryCodec, textOnlyCapabilities, (message) => {
      diagnosed = message;
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const encoded = await selected.encode(bytes);
    expect(typeof encoded).toBe('string');
    await expect(selected.decode(encoded)).resolves.toEqual(bytes);
    expect(diagnosed).toContain('base64');
  });

  it('规则 2：binary codec 遇支持二进制的后端直连，不降级', () => {
    const selected = selectCodec(binaryCodec, structuredCapabilities);
    expect(selected.encode).toBe(binaryCodec.encode);
    expect(selected.decode).toBe(binaryCodec.decode);
  });

  it('binary fallback 在 encode/decode 边界拒绝错误运行时类型', async () => {
    const malformed = {
      name: 'malformed-binary',
      output: 'binary' as const,
      encode: async () => 'not-bytes',
      decode: async (value: unknown) => value
    };
    const selected = selectCodec(malformed, textOnlyCapabilities);
    await expect(selected.encode('value')).rejects.toMatchObject({
      code: 'SERIALIZE_FAILED'
    });
    await expect(selected.decode(new Uint8Array([1]))).rejects.toMatchObject({
      code: 'DESERIALIZE_FAILED'
    });
    await expect(selected.decode('%not-base64%')).rejects.toMatchObject({
      code: 'DESERIALIZE_FAILED'
    });
  });

  it('diagnostic sink 抛错不阻断 binary fallback', async () => {
    const selected = selectCodec(binaryCodec, textOnlyCapabilities, () => {
      throw new Error('diagnostic sink failure');
    });
    await expect(selected.encode(new Uint8Array([7]))).resolves.toBe('Bw==');
  });

  it('规则 3：structured codec 遇 text-only 后端拒绝降级', () => {
    expect(() => selectCodec(structuredCodec, textOnlyCapabilities)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    );
  });

  it('规则 3：structured codec 遇结构化后端直连', () => {
    const selected = selectCodec(structuredCodec, structuredCapabilities);
    expect(selected.encode).toBe(structuredCodec.encode);
    expect(selected.decode).toBe(structuredCodec.decode);
  });
});
