import type { IDisposable } from '@migaia/reactive';
import type { IFieldSource } from '@migaia/store-light';
import { allocateOwnedSync } from './arena';
import type { number as numberBuilder } from './number';
import { FIELD_BUILDER, type FieldBuilder, type FieldContext } from './field';

const DEFAULT_GRANULARITY = 64;
const MAX_FLOAT64_LENGTH = Math.floor(0xffff_ffff / Float64Array.BYTES_PER_ELEMENT);

export type IWasmArrayField = IDisposable & {
  readonly length: number;
  at(index: number): number;
  setAt(index: number, value: number): void;
  setRange(lo: number, hi: number, values: ArrayLike<number>): void;
  // 返回当前内容的拷贝；直接写不会触发响应式通知，适合需要独立快照的调用方。
  view(): Float64Array;
};

// item 目前只支持 number()。granularity：每桶覆盖多少 index 共享一个 Source（默认 64，=1 即逐格追踪）。
export function array(
  _item: ReturnType<typeof numberBuilder>,
  length: number,
  granularity: number = DEFAULT_GRANULARITY
): FieldBuilder<IWasmArrayField> {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FLOAT64_LENGTH) {
    throw new RangeError('wasm.array: length exceeds the Wasm32 allocation limit');
  }
  if (!Number.isSafeInteger(granularity) || granularity <= 0) {
    throw new RangeError('wasm.array: granularity must be a positive safe integer');
  }
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ signal, createSource, runtime }: FieldContext): IWasmArrayField {
      const block = allocateOwnedSync(length * 8);
      const { memory, ptr } = block;
      const buckets: Array<IFieldSource | undefined> = [];
      try {
        if (signal.aborted) throw new Error('[store] field init aborted');
        // Float64Array(buffer, ptr, len) 要求 ptr % 8 === 0，否则抛 RangeError。显式校验，别依赖 allocator 巧合。
        if (length > 0 && ptr % 8 !== 0) {
          throw new Error(`wasm.array: allocation not 8-byte aligned (ptr=${ptr})`);
        }
        // A zero-length view has no elements and must not depend on the
        // allocator's alignment for a zero-byte block. Some Wasm allocators
        // legally return a non-aligned sentinel for such blocks.
        const raw = () =>
          length === 0 ? new Float64Array(0) : new Float64Array(memory.buffer, ptr, length);
        raw(); // 立即构造一次以在 try 内暴露对齐/长度错误，触发 dealloc 而非泄漏
        let disposed = false;
        const checkAlive = () => {
          if (disposed) throw new Error('[store] cannot use a disposed wasm field');
        };

        const bucketOf = (i: number): IFieldSource => {
          const bucketIndex = Math.floor(i / granularity);
          const existing = buckets[bucketIndex];
          if (existing) return existing;
          const created = createSource(`WasmArray[${bucketIndex}]`);
          buckets[bucketIndex] = created;
          return created;
        };
        const checkIndex = (i: number) => {
          if (!Number.isSafeInteger(i) || i < 0 || i >= length) {
            throw new RangeError(`wasm.array: index out of bounds (${i})`);
          }
        };

        const field: IWasmArrayField = {
          length,
          at(i) {
            checkAlive();
            checkIndex(i);
            bucketOf(i).track();
            return raw()[i];
          },
          setAt(i, v) {
            checkAlive();
            checkIndex(i);
            const memoryView = raw();
            if (Object.is(memoryView[i], v)) return;
            bucketOf(i).commit(() => {
              memoryView[i] = v;
            });
          },
          setRange(lo, hi, values) {
            checkAlive();
            if (
              !Number.isSafeInteger(lo) ||
              !Number.isSafeInteger(hi) ||
              lo < 0 ||
              hi < lo ||
              hi > length
            ) {
              throw new RangeError(`wasm.array: invalid range [${lo}, ${hi})`);
            }
            if (values.length !== hi - lo) {
              throw new RangeError('wasm.array: values length must match the target range');
            }
            const memoryView = raw();
            const touched = new Map<IFieldSource, Array<[number, number]>>();
            for (let i = lo; i < hi; i++) {
              const next = values[i - lo];
              if (Object.is(memoryView[i], next)) continue;
              const bucket = bucketOf(i);
              const writes = touched.get(bucket) ?? [];
              writes.push([i, next]);
              touched.set(bucket, writes);
            }
            runtime.batch(() => {
              for (const [bucket, writes] of touched) {
                bucket.commit(() => {
                  for (const [index, next] of writes) memoryView[index] = next;
                });
              }
            });
          },
          view() {
            checkAlive();
            // Never expose the Wasm linear-memory buffer: callers could construct
            // a view over unrelated fields. Return an isolated writable snapshot.
            return new Float64Array(raw());
          },
          get disposed() {
            return disposed;
          },
          dispose() {
            if (disposed) return;
            disposed = true;
            block.unregister(field);
            block.dispose();
            for (const bucket of buckets) bucket?.dispose();
          }
        };
        block.register(field);
        return field;
      } catch (error) {
        for (const bucket of buckets) bucket?.dispose();
        block.dispose();
        throw error;
      }
    }
  };
}
