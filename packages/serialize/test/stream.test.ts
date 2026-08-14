import { describe, expect, it, vi } from 'vitest';
import {
  SerializeError,
  chunkToText,
  collectStream,
  createSerializeRegistry,
  decodeStream,
  encodeStream,
  jsonPlugin,
  sliceByFrameBudget,
  type ISerializeChunk,
  type ISerializePlugin
} from '../src/index';

const rows = (count: number) => Array.from({ length: count }, (_, id) => ({ id }));

/** 立即让出，测试里不必真的等 setTimeout。 */
const immediateYield = () => Promise.resolve();

/** 局部类型化访问 node 的 process：应用工程刻意不引 @types/node， 不该为了一个测试把它拉进整个 src 的类型环境。 */
type IRejectionHost = {
  on(event: 'unhandledRejection', listener: () => void): void;
  off(event: 'unhandledRejection', listener: () => void): void;
};
const rejectionHost = (globalThis as { process?: IRejectionHost }).process;

describe('sliceByFrameBudget：按实测耗时定片大小', () => {
  it('covers every item exactly once and in order', async () => {
    const items = rows(1000);
    const seen: number[] = [];
    for await (const slice of sliceByFrameBudget(items, {
      initialItems: 128,
      yieldTo: immediateYield
    })) {
      for (const row of slice) seen.push(row.id);
    }
    expect(seen).toEqual(items.map((row) => row.id));
  });

  it('shrinks the slice when the consumer overruns the budget', async () => {
    const sizes: number[] = [];
    let now = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);

    for await (const slice of sliceByFrameBudget(rows(20_000), {
      targetMs: 8,
      initialItems: 8_192,
      yieldTo: immediateYield
    })) {
      sizes.push(slice.length);
      // 每片都假装花了 64ms，是预算的 8 倍 → 片大小必须一路缩小
      now += 64;
    }

    spy.mockRestore();
    expect(sizes[0]).toBe(8_192);
    expect(sizes[1]).toBeLessThan(sizes[0]);
    expect(sizes[sizes.length - 1]).toBeLessThan(sizes[0]);
  });

  it('grows the slice when the consumer finishes well under budget', async () => {
    const sizes: number[] = [];
    let now = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);

    for await (const slice of sliceByFrameBudget(rows(200_000), {
      targetMs: 8,
      initialItems: 1_000,
      yieldTo: immediateYield
    })) {
      sizes.push(slice.length);
      now += 0.5; // 远低于预算 → 应当放大
    }

    spy.mockRestore();
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
  });

  it('never leaves the configured bounds', async () => {
    const sizes: number[] = [];
    let now = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);

    for await (const slice of sliceByFrameBudget(rows(5_000), {
      targetMs: 8,
      minItems: 100,
      maxItems: 500,
      initialItems: 500,
      yieldTo: immediateYield
    })) {
      sizes.push(slice.length);
      now += sizes.length % 2 === 0 ? 0.01 : 500; // 剧烈抖动
    }

    spy.mockRestore();
    // 末片可能不足 minItems（数据就剩那么多），其余都必须落在界内
    for (const size of sizes.slice(0, -1)) {
      expect(size).toBeGreaterThanOrEqual(100);
      expect(size).toBeLessThanOrEqual(500);
    }
  });

  it('stops as soon as the caller aborts', async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    const run = async () => {
      // 钳住 maxItems，否则片大小会指数放大、三片就吃完数据，取消根本没机会发生
      for await (const slice of sliceByFrameBudget(rows(10_000), {
        initialItems: 100,
        maxItems: 100,
        yieldTo: immediateYield,
        signal: controller.signal
      })) {
        seen.push(slice.length);
        if (seen.length === 3) controller.abort();
      }
    };
    await expect(run()).rejects.toThrow();
    expect(seen).toHaveLength(3);
  });

  it('rejects a nonsensical budget up front', async () => {
    await expect(sliceByFrameBudget(rows(1), { targetMs: 0 }).next()).rejects.toThrow(
      'targetMs must be a finite positive number'
    );
    await expect(sliceByFrameBudget(rows(1), { minItems: 10, maxItems: 5 }).next()).rejects.toThrow(
      'maxItems must be at least minItems'
    );
  });

  it('rejects NaN before it can spin forever', async () => {
    // NaN <= 0 是 false，能穿过朴素的范围检查；随后 slice(0, NaN) 得到空数组、
    // index 不前进，while 永不结束。这一格就是守着那个死循环。
    for (const bad of [
      { initialItems: Number.NaN },
      { minItems: Number.NaN },
      { maxItems: Number.NaN },
      { targetMs: Number.NaN },
      { targetMs: Number.POSITIVE_INFINITY },
      { initialItems: 1.5 },
      { initialItems: 0 }
    ]) {
      await expect(sliceByFrameBudget(rows(10), bad).next()).rejects.toThrow(RangeError);
    }
  });

  it('handles an empty input without yielding anything', async () => {
    const slices: unknown[] = [];
    for await (const slice of sliceByFrameBudget([], {
      yieldTo: immediateYield
    })) {
      slices.push(slice);
    }
    expect(slices).toEqual([]);
  });
});

describe('encodeStream：不拼装地吐流', () => {
  it('emits one chunk per slice instead of one blob', async () => {
    const registry = createSerializeRegistry([jsonPlugin()]);
    const chunks: ISerializeChunk[] = [];
    for await (const chunk of encodeStream(registry, rows(1_000), {
      initialItems: 250,
      yieldTo: immediateYield
    })) {
      chunks.push(chunk);
    }

    // 分了多片就该有多段，而不是被合并成一整块
    expect(chunks.length).toBeGreaterThan(1);
    const decoded = chunks.flatMap((chunk) => JSON.parse(chunkToText(chunk)) as { id: number }[]);
    expect(decoded).toHaveLength(1_000);
    expect(decoded[0].id).toBe(0);
    expect(decoded[999].id).toBe(999);
    registry.dispose();
  });

  it('keeps only maxInFlight requests outstanding', async () => {
    let live = 0;
    let peak = 0;
    const slow: ISerializePlugin = {
      type: 'slow',
      parser: {
        name: 'slow',
        encode: async (value) => {
          live++;
          peak = Math.max(peak, live);
          await Promise.resolve();
          live--;
          return ['text', JSON.stringify(value)] as ISerializeChunk;
        },
        decode: (chunk) => JSON.parse(String(chunk[1]))
      }
    };
    const registry = createSerializeRegistry([slow]);

    for await (const _chunk of encodeStream(registry, rows(2_000), {
      initialItems: 200,
      maxInFlight: 2,
      yieldTo: immediateYield
    })) {
      void _chunk;
    }
    // 背压生效：在途永远不超过配置上限
    expect(peak).toBeLessThanOrEqual(2);
    registry.dispose();
  });

  it('rejects an invalid in-flight limit', async () => {
    const registry = createSerializeRegistry([jsonPlugin()]);
    for (const bad of [0, -1, Number.NaN, 1.5]) {
      await expect(encodeStream(registry, rows(1), { maxInFlight: bad }).next()).rejects.toThrow(
        'maxInFlight must be a positive integer'
      );
    }
    registry.dispose();
  });

  it('reports which slice failed', async () => {
    let calls = 0;
    const flaky: ISerializePlugin = {
      type: 'flaky',
      parser: {
        name: 'flaky',
        encode: (value) => {
          if (++calls === 3) throw new Error('disk full');
          return ['text', JSON.stringify(value)] as ISerializeChunk;
        },
        decode: (chunk) => JSON.parse(String(chunk[1]))
      }
    };
    const registry = createSerializeRegistry([flaky]);

    const run = async () => {
      for await (const _chunk of encodeStream(registry, rows(1_000), {
        initialItems: 100,
        maxItems: 100,
        yieldTo: immediateYield
      })) {
        void _chunk;
      }
    };
    const error = await run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SerializeError);
    expect(String(error)).toContain('disk full');
    registry.dispose();
  });

  it('does not leave an unhandled rejection when the consumer bails early', async () => {
    const failing: ISerializePlugin = {
      type: 'failing',
      parser: {
        name: 'failing',
        encode: async () => {
          await Promise.resolve();
          throw new Error('later failure');
        },
        decode: () => undefined
      }
    };
    const registry = createSerializeRegistry([failing]);
    const unhandled = vi.fn();
    rejectionHost?.on('unhandledRejection', unhandled);

    const stream = encodeStream(registry, rows(1_000), {
      initialItems: 100,
      maxInFlight: 4,
      yieldTo: immediateYield
    });
    // 只取一次就走人，剩下的在途请求必须被静默接住
    await stream.next().catch(() => undefined);
    await stream.return(undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));

    rejectionHost?.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    registry.dispose();
  });
});

describe('decodeStream 与 collectStream', () => {
  it('round-trips a stream slice by slice', async () => {
    const registry = createSerializeRegistry([jsonPlugin()]);
    const chunks: ISerializeChunk[] = [];
    for await (const chunk of encodeStream(registry, rows(500), {
      initialItems: 100,
      yieldTo: immediateYield
    })) {
      chunks.push(chunk);
    }

    const restored: { id: number }[] = [];
    for await (const slice of decodeStream(registry, chunks)) {
      restored.push(...(slice as { id: number }[]));
    }
    expect(restored).toHaveLength(500);
    expect(restored[499].id).toBe(499);
    registry.dispose();
  });

  it('reports which chunk failed to decode', async () => {
    const registry = createSerializeRegistry([jsonPlugin()]);
    const chunks: ISerializeChunk[] = [
      ['text', '[{"id":1}]'],
      ['text', '{ broken']
    ];
    const run = async () => {
      for await (const _value of decodeStream(registry, chunks)) {
        void _value;
      }
    };
    const error = await run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SerializeError);
    expect((error as SerializeError).chunkIndex).toBe(1);
    registry.dispose();
  });

  it('merges a stream back into one chunk when a full blob is required', async () => {
    const encoder = new TextEncoder();
    async function* mixed(): AsyncGenerator<ISerializeChunk> {
      yield ['text', 'AB'];
      yield ['bytes', encoder.encode('CD')];
      yield ['text', 'EF'];
    }
    expect(chunkToText(await collectStream(mixed()))).toBe('ABCDEF');

    async function* textOnly(): AsyncGenerator<ISerializeChunk> {
      yield ['text', 'a'];
      yield ['text', 'b'];
    }
    expect(await collectStream(textOnly())).toEqual(['text', 'ab']);

    async function* empty(): AsyncGenerator<ISerializeChunk> {}
    expect(await collectStream(empty())).toEqual(['text', '']);
  });

  it('refuses to merge a value chunk into a wire stream', async () => {
    async function* withValue(): AsyncGenerator<ISerializeChunk> {
      yield ['value', { a: 1 }];
    }
    await expect(collectStream(withValue())).rejects.toThrow('cannot collect a value chunk');
  });
});
