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
      /** Native block holding `length` f64 values. */
      const block = allocateOwnedSync(length * 8)
      /** Lazily created bucket sources, shared with rollback on construction failure. */
      const buckets: Array<IFieldSource | undefined> = []
      try {
        assertWasmFieldNotAborted(signal)
        // Float64Array(buffer, ptr, len) 要求 ptr % 8 === 0，否则抛 RangeError。显式校验，别依赖 allocator 巧合。
        if (length > 0 && block.ptr % 8 !== 0) {
          throw createStoreWasmError(
            StoreWasmErrorCode.allocationFailed,
            StoreWasmErrorText.allocationAlignment(block.ptr)
          )
        }
        /** Field over the block; registered with it so block disposal reaches the field. */
        const field = new WasmArrayField(block, length, granularity, createSource, runtime, buckets)
        block.register(field)
        return field
      } catch (error) {
        try {
          disposeAllWasm(bucketDisposers(buckets, block))
        } catch (cleanupError) {
          throwWasmConstructionFailure(error, cleanupError)
        }
        throw error
      }
    }
  }
}

/** Disposers of every created bucket source, then the native block, in ownership order. */
function bucketDisposers(
  buckets: ReadonlyArray<IFieldSource | undefined>,
  block: { dispose(): void }
): Array<() => void> {
  /** Ordered disposers. */
  const disposers: Array<() => void> = []
  for (const bucket of buckets) if (bucket !== undefined) disposers.push(() => bucket.dispose())
  disposers.push(() => block.dispose())
  return disposers
}

/**
 * One fixed f64 array field over a native block. Each bucket of `granularity` indices has a lazily
 * created reactive Source. Members are arrow fields so a field stays destructurable.
 */
class WasmArrayField implements IWasmArrayField {
  /** Native block backing the values. */
  readonly #block: ReturnType<typeof allocateOwnedSync>
  /** Indices per reactive bucket. */
  readonly #granularity: number
  /** Creates one reactive Source for a bucket. */
  readonly #createSource: IFieldContext['createSource']
  /** Runtime used to batch multi-bucket writes. */
  readonly #runtime: IFieldContext['runtime']
  /** Lazily created bucket sources, by bucket index. */
  readonly #buckets: Array<IFieldSource | undefined>
  /** Field-local live view; replaced when native growth swaps the underlying buffer. */
  #currentView: Float64Array
  /** True once disposed; every data operation then fails with FIELD_DISPOSED. */
  #disposed = false
  /** True while dispose runs, so reentrant dispose is a no-op. */
  #disposing = false
  /** Number of f64 elements. */
  readonly length: number

  /** Binds the allocated block and its bucket table. */
  constructor(
    block: ReturnType<typeof allocateOwnedSync>,
    length: number,
    granularity: number,
    createSource: IFieldContext['createSource'],
    runtime: IFieldContext['runtime'],
    buckets: Array<IFieldSource | undefined>
  ) {
    this.#block = block
    this.length = length
    this.#granularity = granularity
    this.#createSource = createSource
    this.#runtime = runtime
    this.#buckets = buckets
    // A zero-length view has no elements and must not depend on the allocator's alignment for a
    // zero-byte block; some Wasm allocators legally return a non-aligned sentinel for such blocks.
    this.#currentView =
      length === 0 ? new Float64Array(0) : new Float64Array(block.memory.buffer, block.ptr, length)
  }

  /** Refresh only the private live view; callers of view() still receive an independent copy. */
  #raw(): Float64Array {
    if (this.length > 0 && this.#currentView.buffer !== this.#block.memory.buffer)
      this.#currentView = new Float64Array(this.#block.memory.buffer, this.#block.ptr, this.length)
    return this.#currentView
  }

  /** Throws FIELD_DISPOSED after disposal. */
  #checkAlive(): void {
    if (this.#disposed)
      throw createStoreWasmError(StoreWasmErrorCode.fieldDisposed, StoreWasmErrorText.fieldDisposed)
  }

  /** Bucket Source of index `i`, created on first use. */
  #bucketOf(i: number): IFieldSource {
    /** Bucket index of `i`. */
    const bucketIndex = Math.floor(i / this.#granularity)
    /** Already created Source, if any. */
    const existing = this.#buckets[bucketIndex]
    if (existing) return existing
    /** New Source for this bucket. */
    const created = this.#createSource(`WasmArray[${bucketIndex}]`)
    this.#buckets[bucketIndex] = created
    return created
  }

  /** Throws INVALID_OPTION for a non-integer or out-of-range index. */
  #checkIndex(i: number): void {
    if (!Number.isSafeInteger(i) || i < 0 || i >= this.length) {
      throw createStoreWasmRangeError(
        StoreWasmErrorCode.invalidOption,
        StoreWasmErrorText.invalidIndex(i)
      )
    }
  }

  /** Tracked read of one element. */
  readonly at = (i: number): number => {
    this.#checkAlive()
    this.#checkIndex(i)
    this.#bucketOf(i).track()
    return this.#raw()[i]!
  }

  /** Writes one element; an equal (Object.is) value is a no-op. */
  readonly setAt = (i: number, v: number): void => {
    this.#checkAlive()
    this.#checkIndex(i)
    if (typeof v !== 'number')
      throw createStoreWasmTypeError(
        StoreWasmErrorCode.invalidOption,
        StoreWasmErrorText.valueType('array', 'number')
      )
    if (Object.is(this.#raw()[i], v)) return
    // The Source owner may grow native memory before invoking this write callback.
    this.#bucketOf(i).commit(() => this.#writeOne(i, v))
  }

  /** Writes one element through the current view. */
  #writeOne(i: number, v: number): void {
    this.#raw()[i] = v
  }

  /** Writes `values` into `[lo, hi)` in one batch; restores previous values if a commit throws. */
  readonly setRange = (lo: number, hi: number, values: ArrayLike<number>): void => {
    this.#checkAlive()
    if (
      !Number.isSafeInteger(lo) ||
      !Number.isSafeInteger(hi) ||
      lo < 0 ||
      hi < lo ||
      hi > this.length
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
    /** Every input materialized before native writes; failed getters remain classified. */
    const pendingValues = readRangeValues(lo, hi, values)
    /** Current view before any commit. */
    const memoryView = this.#raw()
    /** Changed writes grouped by bucket: [index, next, previous]. */
    const touched = new Map<IFieldSource, Array<[number, number, number]>>()
    for (let i = lo; i < hi; i++) {
      const next = pendingValues[i - lo]!
      if (Object.is(memoryView[i], next)) continue
      const bucket = this.#bucketOf(i)
      const writes = touched.get(bucket) ?? []
      writes.push([i, next, memoryView[i]!])
      touched.set(bucket, writes)
    }
    try {
      this.#runtime.batch(() => this.#commitBuckets(touched))
    } catch (primary) {
      // An observer may have disposed this field during the flush; its block is released, so
      // rollback must not write through a stale pointer.
      if (this.#disposed) throw primary
      try {
        this.#restore(touched)
      } catch (cleanup) {
        throwWasmConstructionFailure(primary, cleanup)
      }
      throw primary
    }
  }

  /** Commits every bucket's writes; each commit resolves the view after entering it. */
  #commitBuckets(touched: ReadonlyMap<IFieldSource, Array<[number, number, number]>>): void {
    for (const [bucket, writes] of touched) bucket.commit(() => this.#writeMany(writes))
  }

  /**
   * Applies one bucket's writes. A re-entrant commit may grow memory and replace the backing
   * ArrayBuffer, so the view is resolved here rather than before the batch.
   */
  #writeMany(writes: ReadonlyArray<readonly [number, number, number]>): void {
    /** View after entering this commit. */
    const currentView = this.#raw()
    for (const [index, next] of writes) currentView[index] = next
  }

  /** Restores previous values in reverse write order after a failed batch. */
  #restore(touched: ReadonlyMap<IFieldSource, Array<[number, number, number]>>): void {
    /** Current view for the rollback writes. */
    const currentView = this.#raw()
    for (const writes of Array.from(touched.values()).reverse()) {
      for (const [index, , previous] of [...writes].reverse()) currentView[index] = previous
    }
  }

  /** Untracked, isolated copy; the Wasm linear-memory buffer is never exposed. */
  readonly view = (): Float64Array => {
    this.#checkAlive()
    return new Float64Array(this.#raw())
  }

  /** Whether the field was disposed. */
  get disposed(): boolean {
    return this.#disposed
  }

  /** Releases bucket Sources, then the native block; idempotent and reentrancy-safe. */
  readonly dispose = (): void => {
    if (this.#disposed || this.#disposing) return
    this.#disposing = true
    this.#disposed = true
    try {
      // 逆序释放：子资源依赖 block 的 WASM 内存，必须先摘子资源边再 dealloc。
      disposeWasmField(
        this.#block,
        this,
        this.#buckets.filter((bucket): bucket is IFieldSource => bucket !== undefined)
      )
    } finally {
      this.#disposing = false
    }
  }
}

/** Reads `values` for `[lo, hi)` once; a length mismatch or non-number value is INVALID_OPTION. */
function readRangeValues(lo: number, hi: number, values: ArrayLike<number>): number[] {
  /** Materialized values. */
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
  return pendingValues
}
