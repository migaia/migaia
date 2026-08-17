import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAbortController, createManualScheduler } from '@migaia/lifecycle';
import {
  SerializeCodecError,
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

describe('T-21 构造 fail-fast + close/dispose', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('scheduler 结构非法 → TypeError + INVALID_OPTION（参数错误，非 SerializeCodecError）', () => {
    try {
      createSerializeRegistry([plugin('a')], { scheduler: {} as never });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toMatchObject({ code: 'INVALID_OPTION', source: '@migaia/serialize' });
    }
  });

  it('encoder 缺失 → ENV_UNSUPPORTED（能力缺失，非 TypeError）', () => {
    vi.stubGlobal('TextEncoder', undefined);
    try {
      createSerializeRegistry([plugin('a')]);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toMatchObject({ code: 'ENV_UNSUPPORTED', source: '@migaia/serialize' });
    }
  });

  it('注入 encoder/decoder 时不依赖宿主 Encoding API', () => {
    vi.stubGlobal('TextEncoder', undefined);
    vi.stubGlobal('TextDecoder', undefined);
    const registry = createSerializeRegistry([plugin('a')], {
      encoder: { encode: () => new Uint8Array() },
      decoder: { decode: () => '' }
    });
    expect(registry.has('a')).toBe(true);
  });

  it('close() 幂等且拒绝新请求，不释放 parser', () => {
    let disposed = false;
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (v) => ['text', String(v)],
        decode: (c) => c,
        dispose: () => {
          disposed = true;
        }
      })
    ]);
    registry.close();
    registry.close();
    expect(() => registry.encode('x')).rejects.toThrow(/disposed/);
    expect(disposed).toBe(false);
  });
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

  it('重复 type 时在 own 之前就失败，不运行任何 parser disposer（校验先于 own）', () => {
    let firstDisposed = false;
    const registry = () =>
      createSerializeRegistry([
        plugin('a', {
          name: 'a',
          encode: (v) => ['text', String(v)],
          decode: (c) => c,
          dispose: () => {
            firstDisposed = true;
          }
        }),
        plugin('a') // 重复 type：校验先于 own，直接失败，不触碰第 1 个 parser 的 dispose
      ]);
    expect(registry).toThrow(RangeError);
    expect(firstDisposed).toBe(false);
  });

  it('重复 type 直接抛 duplicate 错误，第一个 parser 的 dispose 从未运行（校验先于 own，无回滚路径）', () => {
    let disposerRan = false;
    let caught: unknown;
    try {
      createSerializeRegistry([
        plugin('a', {
          name: 'a',
          encode: (v) => ['text', String(v)],
          decode: (c) => c,
          dispose: () => {
            disposerRan = true;
          }
        }),
        plugin('a') // 重复 type → 构造失败
      ]);
      throw new Error('unreachable');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as Error).message).toContain('duplicate serialize plugin type');
    expect(disposerRan).toBe(false);
  });
});

describe('encode/decode：类型解析与往返', () => {
  it('未指定 type 时使用 primaryType', async () => {
    const registry = createSerializeRegistry([plugin('a'), plugin('b')]);
    const chunk = await registry.encode('hi');
    expect(chunk).toEqual(['text', 'hi']);
  });

  it('未注册的 type 抛 SerializeCodecError，携带 phase/type', async () => {
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
    expect(chunkToBytes(chunk, new TextEncoder())).toEqual(
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

  it('abort 带 reason 时 ABORTED 错误经 cause 保持 `=== reason` 可达（R-1/T-15）', async () => {
    const controller = new AbortController();
    const reason = new Error('user cancelled');
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'a'];
          controller.abort(reason);
          yield ['text', 'b'];
        },
        decode: (c) => c
      })
    ]);
    await expect(registry.encode(null, { signal: controller.signal })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toMatchObject({ code: 'ABORTED' });
        expect((error as { cause?: unknown }).cause).toBe(reason);
        return true;
      }
    );
  });

  it('caller abort 及时结算一个永不 settle 的 parser（R-3 双 Promise / T-2/T-4）', async () => {
    const controller = new AbortController();
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // 永不 settle：旧实现（无 abort race）会永久挂起。
        encode: () => new Promise<ISerializeChunk>(() => {}),
        decode: (c) => c
      })
    ]);
    const pending = registry.encode('x', { type: 'a', signal: controller.signal });
    controller.abort('cancelled by caller');
    await expect(pending).rejects.toMatchObject({
      code: 'ABORTED',
      cause: 'cancelled by caller'
    });
  });
});

describe('chunkToText / chunkToBytes', () => {
  it('value chunk 没有文本/字节形态，两者都拒绝', () => {
    const chunk: ISerializeChunk = ['value', { x: 1 }];
    expect(() => chunkToText(chunk, new TextDecoder())).toThrow(TypeError);
    expect(() => chunkToBytes(chunk, new TextEncoder())).toThrow(TypeError);
  });
});

describe('dispose：释放语义', () => {
  it('重复 dispose 是幂等的', async () => {
    const registry = createSerializeRegistry([plugin('a')]);
    await registry.dispose();
    await expect(registry.dispose()).resolves.toBeUndefined();
  });

  it('deadlineAt 为 NaN/Infinity 时拒绝（MEDIUM-2 输入门禁）', async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const registry = createSerializeRegistry([plugin('a')]);
      await expect(registry.dispose({ deadlineAt: bad })).rejects.toMatchObject({
        code: 'INVALID_OPTION',
        source: '@migaia/serialize'
      });
    }
  });

  it('dispose 后 encode/decode 拒绝，且不再是可重试的瞬时错误', async () => {
    const registry = createSerializeRegistry([plugin('a')]);
    await registry.dispose();
    await expect(registry.encode('x')).rejects.toThrow(/serialize registry is disposed/);
    await expect(registry.decode(['text', 'x'])).rejects.toThrow(/serialize registry is disposed/);
  });

  it('单个 parser dispose 失败时直接透传该错误', async () => {
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
    await expect(registry.dispose()).rejects.toBe(boom);
  });

  it('多个 parser dispose 失败时聚合成 AggregateError，且每个 parser 都被尝试释放', async () => {
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
    await expect(registry.dispose()).rejects.toSatisfy((error: unknown) => {
      expect(secondCalled).toBe(true);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toHaveLength(2);
      return true;
    });
  });
});

describe('SR-2：encode() 里同步抛错的 parser 必须走 SerializeCodecError 包装，不能是裸错误', () => {
  it('parser.encode 同步抛错时，registry.encode 拒绝的是 SerializeCodecError（而不是原始错误类型）', async () => {
    // 复现：encode() 里 `parser.encode(value, context)` 是作为 collectChunks 的实参被求值的——
    // 同步抛错发生在这次求值上，早于 collectChunks 内部任何 try/catch，此前会把裸错误原样
    // 抛给调用方，和其余所有失败路径（parser 返回 rejected Promise、chunk 形状非法等）都会
    // 被包装成 SerializeCodecError 的既定行为不一致。
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
    await expect(rejection).rejects.toBeInstanceOf(SerializeCodecError);
    await expect(rejection).rejects.toMatchObject({ type: 'a', phase: 'encode' });
    // 原始错误必须仍可追溯，不能在包装时丢掉根因
    await expect(rejection).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Do not know how to serialize a BigInt' })
    });
  });
});

describe('R-3c：dispose 等待在途 encode/decode 结算后才释放 parser', () => {
  it('dispose() 等待在途 encode 完成后才释放 parser（不再并发释放正在用的资源）', async () => {
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
    const disposePromise = registry.dispose();
    // dispose 已进入 drain 阶段，但 parser 尚未释放（在途 encode 未结算）
    expect(disposeCalled).toBe(false);

    releaseInFlight?.();
    await disposePromise;
    // 在途 encode 结算（被 closing 信号 abort 后 reject）后，parser 才被释放
    expect(disposeCalled).toBe(true);
    await expect(pending).rejects.toThrow(/aborted/);
  });
});

describe('T-14/T-22 cleanup 判别联合 + detached sink', () => {
  it('cleanup report 策略：dispose 最终 resolve，reporter 收到 cleanup error', async () => {
    const boom = new Error('boom');
    const reported: unknown[] = [];
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: (v) => ['text', String(v)],
          decode: (c) => c,
          dispose: () => {
            throw boom;
          }
        })
      ],
      { cleanup: { policy: 'report', report: (d) => reported.push(d) } }
    );
    await expect(registry.dispose()).resolves.toBeUndefined();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ kind: 'cleanup-error', error: boom });
  });

  it('onDrainTimeout 抛错不阻断 cleanup', async () => {
    const manual = createManualScheduler();
    let disposed = false;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: async (): Promise<ISerializeChunk> => {
            await gate;
            return ['text', 'x'];
          },
          decode: (c) => c,
          dispose: () => {
            disposed = true;
          }
        })
      ],
      {
        scheduler: manual,
        onDrainTimeout: () => {
          throw new Error('timeout boom');
        }
      }
    );
    const pending = registry.encode('x', { type: 'a' }).catch(() => undefined);
    const disposePromise = registry.dispose({ deadlineAt: 100 });
    manual.advance(101);
    await disposePromise;
    expect(disposed).toBe(true);
    release?.();
    await pending;
  });
});

describe('T-17 iterator.return 错误专项', () => {
  it('return() 抛错只 report，不覆盖 primary abort', async () => {
    const reported: unknown[] = [];
    const controller = createAbortController();
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: () => {
            let first = true;
            return {
              [Symbol.asyncIterator]() {
                return {
                  async next() {
                    if (first) {
                      first = false;
                      controller.abort('stop');
                      return { done: false, value: ['text', 'x'] as ISerializeChunk };
                    }
                    return { done: true, value: undefined };
                  },
                  async return() {
                    throw new Error('return boom');
                  }
                };
              }
            };
          },
          decode: (c) => c
        })
      ],
      { report: (e) => reported.push(e) }
    );
    await expect(registry.encode('x', { type: 'a', signal: controller.signal })).rejects.toThrow(
      /aborted/
    );
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toBe('return boom');
  });
});

describe('T-19 abort → return() 悬挂 → deadline 竞态', () => {
  it('deadline 到达后 dispose 不等 return()；迟到 return rejection 被观测，cleanup 已执行', async () => {
    const manual = createManualScheduler();
    const controller = createAbortController();
    const reported: unknown[] = [];
    let rejectReturn: ((error: unknown) => void) | undefined;
    // return() 挂起（永不 settle，直到测试显式 reject）。
    const returnPending = new Promise<IteratorResult<ISerializeChunk>>((_, reject) => {
      rejectReturn = reject;
    });
    let disposed = false;

    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: () => {
            let first = true;
            return {
              [Symbol.asyncIterator]() {
                return {
                  async next() {
                    if (first) {
                      first = false;
                      controller.abort('stop');
                      return { done: false, value: ['text', 'x'] as ISerializeChunk };
                    }
                    return { done: true, value: undefined };
                  },
                  return(): Promise<IteratorResult<ISerializeChunk>> {
                    return returnPending;
                  }
                };
              }
            };
          },
          decode: (c) => c,
          dispose: () => {
            disposed = true;
          }
        })
      ],
      { scheduler: manual, report: (e) => reported.push(e) }
    );

    // encode 卡在 await iterator.return()（悬挂），registry 持有 1 个 in-flight lease。
    const encodePromise = registry.encode('x', { type: 'a', signal: controller.signal });
    const disposePromise = registry.dispose({ deadlineAt: 100 });
    manual.advance(100);
    await disposePromise;

    // deadline 赢：cleanup 不等 return()，parser 已被同步释放（terminal）。
    expect(disposed).toBe(true);

    // 迟到 return() rejection：在 drain 阶段（task settle 之前）就被 report 观测。
    rejectReturn?.(new Error('late return rejection'));

    // encode task 以 aborted 拒绝；await 它既观测该 rejection（不 unhandled），
    // 也确立「return() 的 report 已执行」的时序。track 的 then 先于本断言注册，
    // 故其 report(aborted) 也已入队；再补一个微任务 tick 兜底，不依赖真实定时器。
    await expect(encodePromise).rejects.toThrow(/aborted/);
    await Promise.resolve();
    expect(reported.some((e) => (e as Error).message === 'late return rejection')).toBe(true);
    // detached task 的 aborted rejection 同样进入 report，与 registry 生命周期解耦、不改变 terminal。
    expect(reported.some((e) => (e as Error).message.includes('aborted'))).toBe(true);
  });
});

describe('T-22 detached 迟到错误经 report 通道', () => {
  it('report 自身抛错被 containment：迟到 rejection 不 unhandled、不改变 terminal', async () => {
    const manual = createManualScheduler();
    let rejectGate: ((reason: unknown) => void) | undefined;
    const gate = new Promise<unknown>((_, reject) => {
      rejectGate = reject;
    });
    let reportCalls = 0;
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: async (): Promise<ISerializeChunk> => {
            await gate;
            return ['text', 'x'];
          },
          decode: (c) => c
        })
      ],
      {
        scheduler: manual,
        report: () => {
          reportCalls++;
          throw new Error('report boom');
        }
      }
    );
    const pending = registry.encode('x', { type: 'a' });
    const disposePromise = registry.dispose({ deadlineAt: 100 });
    manual.advance(100);
    await disposePromise;

    // 迟到 rejection：report 抛错被 containment，不影响 rejection observation。
    rejectGate?.(new Error('late encode boom'));
    // R-3 双 Promise：public promise 在 dispose（closing abort）时已以 aborted 结算；迟到的 parser
    // rejection 走 report 通道（report 自身抛错被 containment，仍计一次调用）。
    await expect(pending).rejects.toThrow(/aborted/);
    await Promise.resolve();
    expect(reportCalls).toBe(1);
  });

  it('无 report 时走 no-op fallback：迟到 rejection 被 catch 观测、不 unhandled', async () => {
    const manual = createManualScheduler();
    let rejectGate: ((reason: unknown) => void) | undefined;
    const gate = new Promise<unknown>((_, reject) => {
      rejectGate = reject;
    });
    const registry = createSerializeRegistry(
      [
        plugin('a', {
          name: 'a',
          encode: async (): Promise<ISerializeChunk> => {
            await gate;
            return ['text', 'x'];
          },
          decode: (c) => c
        })
      ],
      { scheduler: manual } // 无 report
    );
    const pending = registry.encode('x', { type: 'a' });
    const disposePromise = registry.dispose({ deadlineAt: 100 });
    manual.advance(100);
    await disposePromise;

    // 无 report：迟到 rejection 仍被 track 的 rejection handler 观测（不 unhandled）。
    rejectGate?.(new Error('late encode boom'));
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
