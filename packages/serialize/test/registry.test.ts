import { describe, expect, it } from 'vitest';
import {
  SerializeError,
  chunkToBytes,
  chunkToText,
  createSerializeRegistry,
  type ISerializeChunk,
  type ISerializeParser,
  type ISerializePlugin
} from '../src/index';

const textParser = (name = 'text'): ISerializeParser => ({
  name,
  encode: (value): ISerializeChunk => ['text', String(value)],
  decode: (chunk): unknown => (chunk[0] === 'text' ? chunk[1] : chunk)
});

const plugin = (type: string, parser: ISerializeParser = textParser(type)): ISerializePlugin => ({
  type,
  parser
});

describe('createSerializeRegistry：构造校验', () => {
  it('拒绝空插件数组', () => {
    expect(() => createSerializeRegistry([])).toThrow(RangeError);
  });

  it('拒绝重复的 type', () => {
    expect(() => createSerializeRegistry([plugin('a'), plugin('a')])).toThrow(
      /duplicate serialize plugin type/
    );
  });

  it('拒绝不合法的 type 字符集（会写进 HTML 属性/存档头分隔字段）', () => {
    for (const bad of ['', 'A B', 'a|b', 'a"b', 'a>b', '-leading-dash']) {
      expect(() => createSerializeRegistry([plugin(bad)]), bad).toThrow(RangeError);
    }
  });

  it('primaryType 取第一个插件的 type，types 列出全部已注册 type', () => {
    const registry = createSerializeRegistry([plugin('a'), plugin('b')]);
    expect(registry.primaryType).toBe('a');
    expect(registry.types).toEqual(['a', 'b']);
    expect(registry.has('a')).toBe(true);
    expect(registry.has('missing')).toBe(false);
  });
});

describe('encode/decode：类型解析与往返', () => {
  it('未指定 type 时使用 primaryType', async () => {
    const registry = createSerializeRegistry([plugin('a'), plugin('b')]);
    const chunk = await registry.encode('hi');
    expect(chunk).toEqual(['text', 'hi']);
  });

  it('未注册的 type 抛 SerializeError，携带 phase/type', async () => {
    const registry = createSerializeRegistry([plugin('a')]);
    await expect(registry.encode('x', { type: 'missing' })).rejects.toMatchObject({
      type: 'missing',
      phase: 'encode'
    });
    await expect(registry.decode(['text', 'x'], { type: 'missing' })).rejects.toMatchObject({
      type: 'missing',
      phase: 'decode'
    });
  });

  it('encode/decode 往返', async () => {
    const registry = createSerializeRegistry([plugin('a')]);
    const chunk = await registry.encode({ id: 1 }, { type: 'a' });
    const value = await registry.decode(chunk, { type: 'a' });
    expect(value).toBe('[object Object]');
  });
});

describe('decode：输入形状校验（assertChunk）', () => {
  const registry = createSerializeRegistry([plugin('a')]);

  it('拒绝非数组', async () => {
    await expect(registry.decode('nope' as unknown as ISerializeChunk)).rejects.toThrow(
      /must be a \[type, data\] pair/
    );
  });

  it('拒绝长度不为 2 的数组', async () => {
    await expect(registry.decode(['text'] as unknown as ISerializeChunk)).rejects.toThrow(
      /must be a \[type, data\] pair/
    );
  });

  it('text chunk 的 data 必须是 string', async () => {
    await expect(registry.decode(['text', 123] as unknown as ISerializeChunk)).rejects.toThrow(
      /text chunk data must be a string/
    );
  });

  it('bytes chunk 的 data 必须是 Uint8Array', async () => {
    await expect(
      registry.decode(['bytes', 'not-bytes'] as unknown as ISerializeChunk)
    ).rejects.toThrow(/bytes chunk data must be a Uint8Array/);
  });

  it('拒绝未知的 chunk kind', async () => {
    await expect(registry.decode(['weird', 1] as unknown as ISerializeChunk)).rejects.toThrow(
      /unknown serialize chunk type/
    );
  });
});

describe('collectChunks：多段/异步产出的收敛规则', () => {
  it('单个同步 chunk 直接收敛', async () => {
    const registry = createSerializeRegistry([
      plugin('a', { name: 'a', encode: (): ISerializeChunk => ['text', 'sync'], decode: (c) => c })
    ]);
    expect(await registry.encode(null)).toEqual(['text', 'sync']);
  });

  it('parser 返回 Promise<chunk> 时正确收敛', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: async (): Promise<ISerializeChunk> => ['text', 'async'],
        decode: (c) => c
      })
    ]);
    expect(await registry.encode(null)).toEqual(['text', 'async']);
  });

  it('全 text 的多段流直接拼字符串', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // eslint-disable-next-line @typescript-eslint/require-await
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'foo'];
          yield ['text', 'bar'];
        },
        decode: (c) => c
      })
    ]);
    expect(await registry.encode(null)).toEqual(['text', 'foobar']);
  });

  it('混合 text + bytes 的多段流统一拼成字节', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // eslint-disable-next-line @typescript-eslint/require-await
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'ab'];
          yield ['bytes', new Uint8Array([1, 2, 3])];
        },
        decode: (c) => c
      })
    ]);
    const chunk = await registry.encode(null);
    expect(chunk[0]).toBe('bytes');
    expect(chunkToBytes(chunk)).toEqual(
      new Uint8Array([...new TextEncoder().encode('ab'), 1, 2, 3])
    );
  });

  it('value chunk 必须独占一次输出，前面已有其他段时拒绝', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // eslint-disable-next-line @typescript-eslint/require-await
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'a'];
          yield ['value', { boom: true }];
        },
        decode: (c) => c
      })
    ]);
    await expect(registry.encode(null)).rejects.toThrow(
      /value chunk cannot be combined with other chunks/
    );
  });

  it('没有产出任何 chunk 时拒绝', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // eslint-disable-next-line @typescript-eslint/require-await, require-yield
        encode: async function* (): AsyncGenerator<ISerializeChunk> {},
        decode: (c) => c
      })
    ]);
    await expect(registry.encode(null)).rejects.toThrow(/serialize produced no chunks/);
  });

  it('流式产出中途已经 aborted 时立即拒绝', async () => {
    const controller = new AbortController();
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'a'];
          controller.abort();
          yield ['text', 'b'];
        },
        decode: (c) => c
      })
    ]);
    await expect(registry.encode(null, { signal: controller.signal })).rejects.toThrow(
      /serialize aborted/
    );
  });
});

describe('chunkToText / chunkToBytes', () => {
  it('value chunk 没有文本/字节形态，两者都拒绝', () => {
    const chunk: ISerializeChunk = ['value', { x: 1 }];
    expect(() => chunkToText(chunk)).toThrow(TypeError);
    expect(() => chunkToBytes(chunk)).toThrow(TypeError);
  });
});

describe('dispose：释放语义', () => {
  it('重复 dispose 是幂等的', () => {
    const registry = createSerializeRegistry([plugin('a')]);
    registry.dispose();
    expect(() => registry.dispose()).not.toThrow();
  });

  it('dispose 后 encode/decode 拒绝，且不再是可重试的瞬时错误', async () => {
    const registry = createSerializeRegistry([plugin('a')]);
    registry.dispose();
    await expect(registry.encode('x')).rejects.toThrow(/serialize registry is disposed/);
    await expect(registry.decode(['text', 'x'])).rejects.toThrow(/serialize registry is disposed/);
  });

  it('单个 parser dispose 失败时直接透传该错误', () => {
    const boom = new Error('boom');
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (v) => ['text', String(v)],
        decode: (c) => c,
        dispose: () => {
          throw boom;
        }
      })
    ]);
    expect(() => registry.dispose()).toThrow(boom);
  });

  it('多个 parser dispose 失败时聚合成 AggregateError，且每个 parser 都被尝试释放', () => {
    let secondCalled = false;
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (v) => ['text', String(v)],
        decode: (c) => c,
        dispose: () => {
          throw new Error('first');
        }
      }),
      plugin('b', {
        name: 'b',
        encode: (v) => ['text', String(v)],
        decode: (c) => c,
        dispose: () => {
          secondCalled = true;
          throw new Error('second');
        }
      })
    ]);
    let caught: unknown;
    try {
      registry.dispose();
    } catch (error) {
      caught = error;
    }
    expect(secondCalled).toBe(true);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toHaveLength(2);
  });
});

describe('SR-2：encode() 里同步抛错的 parser 必须走 SerializeError 包装，不能是裸错误', () => {
  it('parser.encode 同步抛错时，registry.encode 拒绝的是 SerializeError（而不是原始错误类型）', async () => {
    // 复现：encode() 里 `parser.encode(value, context)` 是作为 collectChunks 的实参被求值的——
    // 同步抛错发生在这次求值上，早于 collectChunks 内部任何 try/catch，此前会把裸错误原样
    // 抛给调用方，和其余所有失败路径（parser 返回 rejected Promise、chunk 形状非法等）都会
    // 被包装成 SerializeError 的既定行为不一致。
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (): ISerializeChunk => {
          throw new TypeError('Do not know how to serialize a BigInt');
        },
        decode: (c) => c
      })
    ]);
    const rejection = registry.encode(1n as unknown as number, { type: 'a' });
    await expect(rejection).rejects.toBeInstanceOf(SerializeError);
    await expect(rejection).rejects.toMatchObject({ type: 'a', phase: 'encode' });
    // 原始错误必须仍可追溯，不能在包装时丢掉根因
    await expect(rejection).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Do not know how to serialize a BigInt' })
    });
  });
});

describe('SR-1（已知设计缺口，记录当前实际行为，未修复）', () => {
  it('dispose() 不等待也不阻止已经在途的 encode/decode，正在使用的 parser 资源可能被并发释放', async () => {
    // 这不是在断言"这是安全的"，而是把当前真实行为钉住：dispose() 的注释写着
    // "先切断新请求，再释放"，只处理了 NEW 请求，完全没有处理已经拿到 parser 引用、
    // 正在执行中的 encode/decode——parser.dispose() 会在它们仍在运行时被调用。
    // 如果 dispose() 内部关闭了一个 worker 端口/wasm 句柄，这个在途调用可能失败得
    // 很难看，也可能读到已经被释放的资源。修复需要给 registry 增加跨调用的
    // in-flight 追踪 + 延迟释放，这是一个会影响 dispose() 语义的设计取舍，
    // 留给用户裁定是否要做，这里只锁定现状不锁定"安全"。
    let releaseInFlight: (() => void) | undefined;
    let disposeCalled = false;
    const inFlight = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: async (): Promise<ISerializeChunk> => {
          await inFlight;
          return ['text', 'done'];
        },
        decode: (c) => c,
        dispose: () => {
          disposeCalled = true;
        }
      })
    ]);

    const pending = registry.encode('x', { type: 'a' });
    // encode 已经启动、还没完成——此时 parser 仍"在用"
    registry.dispose();
    // 当前实现：dispose() 立刻同步跑完，不等待上面这次 encode
    expect(disposeCalled).toBe(true);

    releaseInFlight?.();
    // 在途的 encode 仍然基于已经被 dispose 的 parser 继续跑完并返回结果——
    // 没有任何机制阻止或标记这一点。
    await expect(pending).resolves.toEqual(['text', 'done']);
  });
});
