import type { IDisposable } from '@migaia/reactive'
import type { IFieldSource } from '@migaia/store-light'
import {
  allocateOwnedSync,
  disposeAllWasm,
  disposeWasmField,
  throwWasmConstructionFailure
} from './arena.ts'
import {
  assertWasmFieldNotAborted,
  createStoreWasmError,
  createStoreWasmRangeError,
  createStoreWasmTypeError,
  identifyStoreWasmFailure,
  StoreWasmErrorCode
} from './errors.ts'
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from './field.ts'
import { StoreFieldMode } from '@migaia/store-light'
import { StoreWasmErrorText } from './error-text.ts'

const DEFAULT_GRANULARITY = 64
const MAX_FLOAT64_LENGTH = Math.floor(0xffff_ffff / Float64Array.BYTES_PER_ELEMENT)

/** Fixed-size owned f64 field with bucket-level dependencies and explicit write methods. */
export type IWasmArrayField = IDisposable & {
  /** Fixed element count; reading length does not subscribe to array values. */
  readonly length: number
  /** Read an in-range safe-integer index and track its bucket; negative indices are not supported. */
  at(index: number): number
  /**
   * Commit a number to one bucket, skipping Object.is-equal writes; invalid index/type is
   * INVALID_OPTION.
   */
  setAt(index: number, value: number): void
  /**
   * Replace [lo,hi) from an exactly matching ArrayLike. Snapshot all input values before native
   * writes, then batch changed buckets. Input failure leaves values unchanged; commit failure
   * attempts byte rollback but cannot undo observer or callback side effects.
   */
  setRange(lo: number, hi: number, values: ArrayLike<number>): void
  /** Return a fresh, writable Float64Array copy without tracking or exposing WASM linear memory. */
  view(): Float64Array
}

/**
 * Describe a zero-initialized fixed f64 array; allocate only when a Store creates the field after
 * ensureWasm. length is required, nonnegative and at most floor(0xffffffff / 8); granularity
 * defaults to 64 and must be a positive safe integer. Invalid arguments throw INVALID_OPTION.
 * Reads/writes lazily create a Source per bucket: different indices in one bucket can notify the
 * same observer. view is an untracked copy; data operations reject FIELD_DISPOSED after disposal.
 */
export function array(
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
    mode: StoreFieldMode.sync,
    create({ signal, createSource, runtime }: IFieldContext): IWasmArrayField {
      const block = allocateOwnedSync(length * 8)
      const { memory, ptr } = block
      const buckets: Array<IFieldSource | undefined> = []
      try {
        assertWasmFieldNotAborted(signal)
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
        /** Keep the field-local view until native growth replaces the underlying buffer. */
        let currentView =
          length === 0 ? new Float64Array(0) : new Float64Array(memory.buffer, ptr, length)
        /** Refresh only the private live view; callers of view() still receive an independent copy. */
        const raw = () => {
          if (length > 0 && currentView.buffer !== memory.buffer)
            currentView = new Float64Array(memory.buffer, ptr, length)
          return currentView
        }
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
              // The Source owner may grow native memory before invoking this write callback.
              raw()[i] = v
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
            /** Materialize every input before native writes; failed getters remain classified. */
            const pendingValues: number[] = []
            try {
              if (values.length !== hi - lo) {
                throw createStoreWasmRangeError(
                  StoreWasmErrorCode.invalidOption,
                  StoreWasmErrorText.rangeValueLength
                )
              }
              for (let i = lo; i < hi; i++) {
                const next = values[i - lo]
                if (typeof next !== 'number')
                  throw createStoreWasmTypeError(
                    StoreWasmErrorCode.invalidOption,
                    StoreWasmErrorText.valueType('array', 'number')
                  )
                pendingValues.push(next)
              }
            } catch (error) {
              throw identifyStoreWasmFailure(
                error,
                StoreWasmErrorCode.invalidOption,
                StoreWasmErrorText.rangeValuesInvalid
              )
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
              // 逆序释放：子资源依赖 block 的 WASM 内存，必须先摘子资源边再 dealloc。
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
