import type { IDisposable } from '@migaia/reactive'
import type { IFieldSource } from '@migaia/store-light'
import {
  allocateOwnedSync,
  disposeAllWasm,
  disposeWasmField,
  throwWasmConstructionFailure
} from './arena.js'
import {
  createStoreWasmError,
  createStoreWasmRangeError,
  createStoreWasmTypeError,
  StoreWasmErrorCode
} from './errors.js'
import type { number as numberBuilder } from './number.js'
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.js'
import { WasmFieldMode } from './field-constants.js'
import { StoreWasmErrorText } from './error-text.js'

const DEFAULT_GRANULARITY = 64
const MAX_FLOAT64_LENGTH = Math.floor(0xffff_ffff / Float64Array.BYTES_PER_ELEMENT)

export type IWasmArrayField = IDisposable & {
  readonly length: number
  at(index: number): number
  setAt(index: number, value: number): void
  setRange(lo: number, hi: number, values: ArrayLike<number>): void
  // 返回当前内容的拷贝；直接写不会触发响应式通知，适合需要独立快照的调用方。
  view(): Float64Array
}

// item 目前只支持 number()。granularity：每桶覆盖多少 index 共享一个 Source（默认 64，=1 即逐格追踪）。
export function array(
  _item: ReturnType<typeof numberBuilder>,
  length: number,
  granularity: number = DEFAULT_GRANULARITY
): IFieldBuilder<IWasmArrayField> {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FLOAT64_LENGTH) {
    throw createStoreWasmRangeError(
      StoreWasmErrorCode.invalidOption,
      StoreWasmErrorText.arrayLengthLimit
    )
  }
  if (!Number.isSafeInteger(granularity) || granularity <= 0) {
    throw createStoreWasmRangeError(
      StoreWasmErrorCode.invalidOption,
      StoreWasmErrorText.granularityInvalid
    )
  }
  return {
    [FIELD_BUILDER]: true,
    mode: WasmFieldMode.sync,
    create({ signal, createSource, runtime }: IFieldContext): IWasmArrayField {
      const block = allocateOwnedSync(length * 8)
      const { memory, ptr } = block
      const buckets: Array<IFieldSource | undefined> = []
      try {
        if (signal.aborted)
          throw createStoreWasmError(StoreWasmErrorCode.initAborted, StoreWasmErrorText.initAborted)
        // Float64Array(buffer, ptr, len) 要求 ptr % 8 === 0，否则抛 RangeError。显式校验，别依赖 allocator 巧合。
        if (length > 0 && ptr % 8 !== 0) {
          throw createStoreWasmError(
            StoreWasmErrorCode.allocationFailed,
            StoreWasmErrorText.allocationAlignment(ptr)
          )
        }
        // A zero-length view has no elements and must not depend on the
        // allocator's alignment for a zero-byte block. Some Wasm allocators
        // legally return a non-aligned sentinel for such blocks.
        const raw = () =>
          length === 0 ? new Float64Array(0) : new Float64Array(memory.buffer, ptr, length)
        raw() // 立即构造一次以在 try 内暴露对齐/长度错误，触发 dealloc 而非泄漏
        let disposed = false
        let disposing = false
        const checkAlive = () => {
          if (disposed)
            throw createStoreWasmError(
              StoreWasmErrorCode.fieldDisposed,
              StoreWasmErrorText.fieldDisposed
            )
        }

        const bucketOf = (i: number): IFieldSource => {
          const bucketIndex = Math.floor(i / granularity)
          const existing = buckets[bucketIndex]
          if (existing) return existing
          const created = createSource(`WasmArray[${bucketIndex}]`)
          buckets[bucketIndex] = created
          return created
        }
        const checkIndex = (i: number) => {
          if (!Number.isSafeInteger(i) || i < 0 || i >= length) {
            throw createStoreWasmRangeError(
              StoreWasmErrorCode.invalidOption,
              StoreWasmErrorText.invalidIndex(i)
            )
          }
        }

        const field: IWasmArrayField = {
          length,
          at(i) {
            checkAlive()
            checkIndex(i)
            bucketOf(i).track()
            return raw()[i]
          },
          setAt(i, v) {
            checkAlive()
            checkIndex(i)
            if (typeof v !== 'number')
              throw createStoreWasmTypeError(
                StoreWasmErrorCode.invalidOption,
                StoreWasmErrorText.valueType('array', 'number')
              )
            const memoryView = raw()
            if (Object.is(memoryView[i], v)) return
            bucketOf(i).commit(() => {
              memoryView[i] = v
            })
          },
          setRange(lo, hi, values) {
            checkAlive()
            if (
              !Number.isSafeInteger(lo) ||
              !Number.isSafeInteger(hi) ||
              lo < 0 ||
              hi < lo ||
              hi > length
            ) {
              throw createStoreWasmRangeError(
                StoreWasmErrorCode.invalidOption,
                StoreWasmErrorText.invalidRange(lo, hi)
              )
            }
            if ((typeof values !== 'object' && typeof values !== 'function') || values === null) {
              throw createStoreWasmTypeError(
                StoreWasmErrorCode.invalidOption,
                StoreWasmErrorText.rangeValuesInvalid
              )
            }
            if (values.length !== hi - lo) {
              throw createStoreWasmRangeError(
                StoreWasmErrorCode.invalidOption,
                StoreWasmErrorText.rangeValueLength
              )
            }
            const pendingValues: number[] = []
            for (let i = lo; i < hi; i++) {
              const next = values[i - lo]
              if (typeof next !== 'number')
                throw createStoreWasmTypeError(
                  StoreWasmErrorCode.invalidOption,
                  StoreWasmErrorText.valueType('array', 'number')
                )
              pendingValues.push(next)
            }
            const memoryView = raw()
            const touched = new Map<IFieldSource, Array<[number, number, number]>>()
            for (let i = lo; i < hi; i++) {
              const next = pendingValues[i - lo]
              if (Object.is(memoryView[i], next)) continue
              const bucket = bucketOf(i)
              const writes = touched.get(bucket) ?? []
              writes.push([i, next, memoryView[i]])
              touched.set(bucket, writes)
            }
            try {
              runtime.batch(() => {
                for (const [bucket, writes] of touched) {
                  bucket.commit(() => {
                    // A re-entrant commit may grow memory and replace the backing
                    // ArrayBuffer. Resolve the view after entering each commit.
                    const currentView = raw()
                    for (const [index, next] of writes) currentView[index] = next
                  })
                }
              })
            } catch (primary) {
              try {
                const currentView = raw()
                for (const writes of Array.from(touched.values()).reverse()) {
                  for (const [index, , previous] of [...writes].reverse()) {
                    currentView[index] = previous
                  }
                }
              } catch (cleanup) {
                throwWasmConstructionFailure(primary, cleanup)
              }
              throw primary
            }
          },
          view() {
            checkAlive()
            // Never expose the Wasm linear-memory buffer: callers could construct
            // a view over unrelated fields. Return an isolated writable snapshot.
            return new Float64Array(raw())
          },
          get disposed() {
            return disposed
          },
          dispose() {
            if (disposed || disposing) return
            disposing = true
            disposed = true
            try {
              // 逆序释放（migration.sdd.md §5.7）：子资源依赖 block 的 WASM 内存，必须先摘子资源边再 dealloc。
              disposeWasmField(
                block,
                field,
                buckets.filter((bucket): bucket is IFieldSource => bucket !== undefined)
              )
            } finally {
              disposing = false
            }
          }
        }
        block.register(field)
        return field
      } catch (error) {
        try {
          disposeAllWasm([
            ...buckets
              .filter((bucket): bucket is IFieldSource => bucket !== undefined)
              .map((bucket) => () => bucket.dispose()),
            () => block.dispose()
          ])
        } catch (cleanupError) {
          throwWasmConstructionFailure(error, cleanupError)
        }
        throw error
      }
    }
  }
}
