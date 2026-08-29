import {
  ReactiveErrorPhase,
  type IDisposable,
  type IDisposer,
  type IObservable,
  type IObserver,
  type IRuntime
} from '@migaia/reactive/runtime'
import { internalsOf } from '@migaia/reactive/internals'
import { claimOwnership } from '@migaia/reactive/ownership'
import { registerSubs, registerVersion, readVersion } from '@migaia/reactive/node-internals'
import { createStoreSharedError, createStoreSharedRangeError } from './errors.js'
import { StoreSharedErrorCode } from './error-code.js'
import { StoreSharedErrorText } from './error-text.js'
import {
  SHARED_ABI_MAGIC,
  SHARED_ABI_VERSION,
  SharedAbiKind,
  SharedAbiReady
} from './shared-constants.js'

/**
 * SharedArrayBuffer 支撑的跨线程状态。
 *
 * 布局是 **seqlock**：每格两个 slot `[value, seq]`，`seq` 同时充当版本号与写锁—— 奇数表示「有人正在写」，每次完成的写入把它推进 2。
 *
 * 之前是 `[value, version]`，写入为 `Atomics.exchange(value)` 后 `Atomics.add(version)`
 * 两步，中间没有任何互斥。后果是并发写者能让读者观察到「新值配旧版本」：读者据版本 判断自己不脏，于是**漏掉一次通知**，而值已经变了。跨线程共享状态里这种漏通知几乎
 * 无法排查——它不报错，只是有一帧数据没更新。
 *
 * Seqlock 给出的保证：
 *
 * - 读者拿到的 value 与 version 一定来自同一次完成的写入（读前读后 seq 相同， 且为偶数，否则重读）；
 * - 写者之间互斥（偶→奇的 compareExchange 即获锁），所以不会有两个写者交错；
 * - 写者不在持锁期间调用用户代码——`update()` 先一致读、锁外算、再带期望值获锁， 值被别人改了就重来。用户回调抛错不会留下一把奇数的死锁。
 */

const SPIN_LIMIT = 1 << 16

/** Keeps waitAsync callback diagnostics from escaping the cross-thread promise boundary. */
function reportSharedWatchFailure(runtime: IRuntime, error: unknown): void {
  try {
    runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })
    return
  } catch (reporterError) {
    const hostReportError = (globalThis as { reportError?: (error: unknown) => void }).reportError
    try {
      if (hostReportError) hostReportError(reporterError)
      else console.error(reporterError)
    } catch {
      // Diagnostics are best effort; a failing sink must not create another unhandled failure.
    }
  }
}

/**
 * 一致读：value 与 version 同源。
 *
 * 自旋有上限：写者若在持锁期间崩溃（线程被终止、页面被杀），seq 会永远停在奇数， 此时无限自旋会把这条线程也吊死。到限即抛，把「有人写坏了」暴露出来，而不是静默卡住。
 */
function readConsistent(
  valueView: Int32Array,
  versionView: BigInt64Array,
  valueSlot: number,
  versionSlot: number
): { readonly value: number; readonly version: bigint } {
  for (let spins = 0; spins < SPIN_LIMIT; spins++) {
    const before = Atomics.load(versionView, versionSlot)
    if ((before & 1n) !== 0n) continue
    const value = Atomics.load(valueView, valueSlot)
    const after = Atomics.load(versionView, versionSlot)
    if (before === after) return { value, version: before }
  }
  throw createStoreSharedError(
    StoreSharedErrorCode.contentionLimit,
    StoreSharedErrorText.cellUnsettled
  )
}

/** 获锁：把偶数 seq 推成奇数。返回获锁前的偶数 seq。 */
function acquire(versionView: BigInt64Array, versionSlot: number): bigint {
  for (let spins = 0; spins < SPIN_LIMIT; spins++) {
    const seq = Atomics.load(versionView, versionSlot)
    if ((seq & 1n) !== 0n) continue
    if (Atomics.compareExchange(versionView, versionSlot, seq, seq + 1n) === seq) {
      return seq
    }
  }
  throw createStoreSharedError(
    StoreSharedErrorCode.contentionLimit,
    StoreSharedErrorText.lockUnacquired
  )
}

/**
 * 带期望值的写入。
 *
 * `expected` 为 undefined 表示「无条件写」；给了期望值则相当于 CAS：值已经被别人 改掉就释放锁并返回 undefined，由调用方重算（`update` 用这条路）。
 *
 * 返回新的 seq（即新版本），或 undefined 表示未写入。值未变化时也返回 undefined， 并把 seq 原样释放——不变的写入不该推进版本，否则每次 set 相同值都会通知一轮。
 */
function writeLocked(
  valueView: Int32Array,
  versionView: BigInt64Array,
  valueSlot: number,
  versionSlot: number,
  next: number,
  expected?: number
): bigint | undefined {
  const seq = acquire(versionView, versionSlot)
  try {
    const current = Atomics.load(valueView, valueSlot)
    if (expected !== undefined && current !== expected) return undefined
    if (current === next) return undefined
    Atomics.store(valueView, valueSlot, next)
    const committed = seq + 2n
    Atomics.store(versionView, versionSlot, committed)
    return committed
  } finally {
    // 未写入时把锁原样放回；已写入时上面已经推进到 seq+2，这里不能再动
    if (Atomics.load(versionView, versionSlot) === seq + 1n) {
      Atomics.store(versionView, versionSlot, seq)
    }
  }
}

const SIGNAL_MAGIC_SLOT = 0
const SIGNAL_VERSION_SLOT = 1
const SIGNAL_KIND_SLOT = 2
const SIGNAL_READY_SLOT = 3
const SIGNAL_VALUE_SLOT = 4
const SIGNAL_VERSION_OFFSET = 24
const SIGNAL_BYTES = SIGNAL_VERSION_OFFSET + BigInt64Array.BYTES_PER_ELEMENT

/** The largest slot index supported by the ECMAScript typed-array index space. */
const MAX_INT32_ARRAY_SLOTS = 0xffffffff

/** Cross-realm brand check for the one supported shared-memory input type. */
function isSharedBuffer(value: unknown): value is SharedArrayBuffer {
  return Object.prototype.toString.call(value) === '[object SharedArrayBuffer]'
}

/** Reject a buffer whose header belongs to an obsolete or foreign layout. */
function assertAbiHeader(view: Int32Array, kind: number, length?: number): void {
  if (Atomics.load(view, 0) !== SHARED_ABI_MAGIC || Atomics.load(view, 1) !== SHARED_ABI_VERSION) {
    throw createStoreSharedRangeError(
      StoreSharedErrorCode.invalidOption,
      StoreSharedErrorText.bufferType
    )
  }
  if (Atomics.load(view, 2) !== kind || Atomics.load(view, 3) !== SharedAbiReady.ready) {
    throw createStoreSharedRangeError(
      StoreSharedErrorCode.invalidOption,
      StoreSharedErrorText.bufferType
    )
  }
  if (length !== undefined && Atomics.load(view, 4) !== length) {
    throw createStoreSharedRangeError(
      StoreSharedErrorCode.invalidOption,
      StoreSharedErrorText.arrayBufferSmall
    )
  }
}

/**
 * Int32 值域校验。
 *
 * `value | 0` 会**静默**把 2**31 或 1.5 折成别的数字：跨线程共享的那格内存于是 存了一个调用方从未写过的值，而两边都不会报错。共享状态最难查的就是这种 「我明明写了
 * X」——所以宁可在写入点抛。
 */
function asInt32(value: number, what: string): number {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw createStoreSharedRangeError(
      StoreSharedErrorCode.invalidOption,
      StoreSharedErrorText.int32(what, value)
    )
  }
  return value
}

const hasWaitAsync = (): boolean =>
  typeof Atomics !== 'undefined' &&
  typeof (
    Atomics as unknown as {
      waitAsync?: unknown
    }
  ).waitAsync === 'function'

type IWaitAsyncResult = {
  readonly async: boolean
  readonly value: 'ok' | 'not-equal' | 'timed-out' | Promise<'ok' | 'timed-out'>
}

/**
 * 在某个 slot 上起一条 waitAsync 唤醒回路。
 *
 * 没有它的话，远端写入只能靠调用方自己 pump `sync()`——那意味着「共享响应式」在跨 线程方向其实是**拉取式**：本线程不主动问就永远不知道对面改了。
 *
 * `Atomics.wait` 不能用在主线程（会阻塞），所以走 `waitAsync`。环境不支持时抛错而 不是静默降级成拉取——静默降级会让调用方以为自己拿到了推送。
 */
function watchSlot(
  view: BigInt64Array,
  slot: number,
  onWake: () => void,
  onError: (error: unknown) => void
): IDisposer {
  if (!hasWaitAsync()) {
    throw createStoreSharedError(
      StoreSharedErrorCode.envUnsupported,
      StoreSharedErrorText.waitAsyncUnavailable
    )
  }
  const waitAsync = (
    Atomics as unknown as {
      waitAsync: (
        typedArray: Int32Array | BigInt64Array,
        index: number,
        value: number | bigint
      ) => IWaitAsyncResult
    }
  ).waitAsync
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  /** Schedule another wait without retaining a live timer after disposal. */
  const schedule = (): void => {
    if (stopped) return
    try {
      timer = setTimeout(() => {
        timer = undefined
        loop()
      }, 0)
    } catch (error) {
      stopped = true
      onError(error)
    }
  }

  const loop = (): void => {
    if (stopped) return
    let result: IWaitAsyncResult
    try {
      result = waitAsync(view as never, slot, Atomics.load(view, slot))
    } catch (error) {
      onError(error)
      return
    }
    if (!result.async) {
      // 值在挂起前就变了（'not-equal'）：立刻处理并继续，不要错过这一次
      if (!stopped) {
        try {
          onWake()
        } catch (error) {
          onError(error)
          return
        }
        schedule()
      }
      return
    }
    void (result.value as Promise<'ok' | 'timed-out'>).then(
      () => {
        if (stopped) return
        try {
          onWake()
        } catch (error) {
          onError(error)
          return
        }
        schedule()
      },
      (error: unknown) => onError(error)
    )
  }

  loop()
  return () => {
    if (stopped) return
    stopped = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    // Wake a pending waitAsync so its promise/callback can release the
    // captured SharedArrayBuffer view promptly instead of waiting for a
    // future remote write.
    try {
      Atomics.notify(view as never, slot)
    } catch {
      // The loop is already logically stopped; a host teardown may make the
      // view unavailable, so disposal must remain best-effort and idempotent.
    }
  }
}

export class SharedInt32Signal implements IObservable, IDisposable {
  readonly runtime: IRuntime
  readonly buffer: SharedArrayBuffer
  #subs = new Set<IObserver>()
  readonly subs: ReadonlySet<IObserver>
  #initialVersion: number
  get version(): number {
    return readVersion(this, this.#initialVersion)
  }
  #valueView: Int32Array
  #versionView: BigInt64Array
  #observedSharedVersion: bigint
  #disposed = false
  #stopWatching?: IDisposer

  constructor(runtime: IRuntime, initialValue = 0, buffer?: SharedArrayBuffer) {
    if (buffer !== undefined && !isSharedBuffer(buffer)) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.bufferType
      )
    }
    this.runtime = runtime
    this.buffer = buffer ?? new SharedArrayBuffer(SIGNAL_BYTES)
    if (this.buffer.byteLength < SIGNAL_BYTES) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.bufferTooSmall,
        StoreSharedErrorText.signalBufferSmall
      )
    }
    this.#valueView = new Int32Array(this.buffer, 0, SIGNAL_VALUE_SLOT + 1)
    this.#versionView = new BigInt64Array(this.buffer, SIGNAL_VERSION_OFFSET, 1)
    if (!buffer) {
      Atomics.store(this.#valueView, SIGNAL_MAGIC_SLOT, SHARED_ABI_MAGIC)
      Atomics.store(this.#valueView, SIGNAL_VERSION_SLOT, SHARED_ABI_VERSION)
      Atomics.store(this.#valueView, SIGNAL_KIND_SLOT, SharedAbiKind.signal)
      Atomics.store(this.#valueView, SIGNAL_READY_SLOT, SharedAbiReady.initializing)
      Atomics.store(
        this.#valueView,
        SIGNAL_VALUE_SLOT,
        asInt32(initialValue, 'shared signal value')
      )
      Atomics.store(this.#versionView, 0, 0n)
      Atomics.store(this.#valueView, SIGNAL_READY_SLOT, SharedAbiReady.ready)
    } else {
      assertAbiHeader(this.#valueView, SharedAbiKind.signal)
    }
    this.#observedSharedVersion = readConsistent(
      this.#valueView,
      this.#versionView,
      SIGNAL_VALUE_SLOT,
      0
    ).version
    this.#initialVersion = internalsOf(runtime).clock.next()
    this.subs = registerSubs(this, this.#subs)
    registerVersion(this, this.#initialVersion)
    claimOwnership(this, runtime)
  }

  get disposed(): boolean {
    return this.#disposed
  }

  get value(): number {
    this.#assertActive()
    this.sync()
    internalsOf(this.runtime).tracker.track(this)
    return this.#read().value
  }

  set value(next: number) {
    this.#assertActive()
    const normalized = asInt32(next, 'shared signal value')
    const version = writeLocked(
      this.#valueView,
      this.#versionView,
      SIGNAL_VALUE_SLOT,
      0,
      normalized
    )
    if (version === undefined) return
    this.#observedSharedVersion = version
    // Publish the committed version before local Reactive fanout: a hostile
    // scheduler/observer must not leave remote readers asleep after a write.
    Atomics.notify(this.#versionView as never, 0)
    internalsOf(this.runtime).notify(this)
  }

  /**
   * Pull remote writes into this Runtime.
   *
   * `watch()` 起了回路之后就不必手动调它；没有 waitAsync 的环境仍可从自己的消息 循环里 pump。
   */
  sync(): boolean {
    this.#assertActive()
    const { version } = this.#read()
    if (version === this.#observedSharedVersion) return false
    this.#observedSharedVersion = version
    internalsOf(this.runtime).notify(this)
    return true
  }

  /**
   * 起一条 waitAsync 回路：远端写入直接推到本 Runtime，不必再 pump `sync()`。
   *
   * 返回停止函数；`dispose()` 也会停。
   */
  watch(): IDisposer {
    this.#assertActive()
    if (this.#stopWatching) return this.#stopWatching
    let disposer: IDisposer | undefined
    const stop = watchSlot(
      this.#versionView,
      0,
      () => {
        if (!this.#disposed) this.sync()
      },
      (error) => {
        reportSharedWatchFailure(this.runtime, error)
        if (this.#stopWatching === disposer) this.#stopWatching = undefined
      }
    )
    disposer = () => {
      stop()
      if (this.#stopWatching === disposer) this.#stopWatching = undefined
    }
    this.#stopWatching = disposer
    return disposer
  }

  peek(): number {
    this.#assertActive()
    return this.#read().value
  }

  onObserved(): void {}
  onUnobserved(): void {}
  isStale(): boolean {
    return this.#read().version !== this.#observedSharedVersion
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#stopWatching?.()
    internalsOf(this.runtime).tracker.disconnectObservable(this, 'dispose')
  }

  #read(): { readonly value: number; readonly version: bigint } {
    return readConsistent(this.#valueView, this.#versionView, SIGNAL_VALUE_SLOT, 0)
  }

  #assertActive(): void {
    if (this.#disposed)
      throw createStoreSharedError(
        StoreSharedErrorCode.signalDisposed,
        StoreSharedErrorText.signalDisposed
      )
  }
}

export const sharedInt32 = (
  runtime: IRuntime,
  initialValue = 0,
  buffer?: SharedArrayBuffer
): SharedInt32Signal => new SharedInt32Signal(runtime, initialValue, buffer)

/**
 * 数组布局：ABI header、一个 64 位 generation cursor、所有值以及每格 64 位 seqlock。 每个 Runtime 保留自己的 generation/cell
 * cursors，因此任意数量的 readers 都能独立同步； 不再使用会被首个 reader 清掉的共享 dirty queue。
 */
const ARRAY_MAGIC_SLOT = 0
const ARRAY_LAYOUT_SLOT = 1
const ARRAY_KIND_SLOT = 2
const ARRAY_READY_SLOT = 3
const ARRAY_LENGTH_SLOT = 4
const ARRAY_GENERATION_OFFSET = 24
const ARRAY_VALUES_OFFSET = 32
const ARRAY_VALUE_BYTES = Int32Array.BYTES_PER_ELEMENT
const ARRAY_VERSION_BYTES = BigInt64Array.BYTES_PER_ELEMENT

class SharedInt32ArrayCell implements IObservable {
  readonly runtime: IRuntime
  #subs = new Set<IObserver>()
  readonly subs: ReadonlySet<IObserver>
  #initialVersion: number
  get version(): number {
    return readVersion(this, this.#initialVersion)
  }
  #owner: SharedInt32Array
  #index: number
  #observedSharedVersion: bigint

  constructor(owner: SharedInt32Array, index: number) {
    this.#owner = owner
    this.runtime = owner.runtime
    this.#index = index
    this.#observedSharedVersion = owner.readCell(index).version
    this.#initialVersion = internalsOf(this.runtime).clock.next()
    this.subs = registerSubs(this, this.#subs)
    registerVersion(this, this.#initialVersion)
    claimOwnership(this, this.runtime)
  }

  read(): number {
    this.#owner.assertActive()
    this.sync()
    internalsOf(this.runtime).tracker.track(this)
    return this.#owner.readCell(this.#index).value
  }

  write(value: number): boolean {
    this.#owner.assertActive()
    const version = this.#owner.writeCell(this.#index, asInt32(value, 'shared cell value'))
    if (version === undefined) return false
    this.commitWrite(version)
    return true
  }

  /** 写入已落盘之后的收尾：记下新版本、通知本 Runtime、唤醒远端。 */
  commitWrite(version: bigint): void {
    this.#observedSharedVersion = version
    this.#owner.recordObservedVersion(this.#index, version)
    // Publish the generation before local Reactive fanout: a hostile
    // scheduler/observer must not leave remote readers asleep after a write.
    this.#owner.notifyWaiters()
    internalsOf(this.runtime).notify(this)
  }

  sync(): boolean {
    this.#owner.assertActive()
    const { version } = this.#owner.readCell(this.#index)
    if (version === this.#observedSharedVersion) return false
    this.#observedSharedVersion = version
    internalsOf(this.runtime).notify(this)
    return true
  }

  isStale(): boolean {
    return this.#owner.readCell(this.#index).version !== this.#observedSharedVersion
  }
}

/**
 * Fixed-layout, index-granular shared state for Workers. Each element owns a value/seq pair in the
 * SharedArrayBuffer, so changing one conversation slot does not invalidate readers of every other
 * slot.
 */
export class SharedInt32Array implements IDisposable {
  readonly runtime: IRuntime
  readonly buffer: SharedArrayBuffer
  readonly length: number
  #valueView: Int32Array
  #versionView: BigInt64Array
  #generationView: BigInt64Array
  #cells = new Map<number, SharedInt32ArrayCell>()
  #observedVersions: BigInt64Array
  #observedGeneration: bigint
  #disposed = false
  #stopWatching?: IDisposer

  constructor(
    runtime: IRuntime,
    length: number,
    options: {
      readonly buffer?: SharedArrayBuffer
      readonly initialValues?: Iterable<number>
    } = {}
  ) {
    if (options === null || typeof options !== 'object') {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.optionsObject
      )
    }
    let buffer: SharedArrayBuffer | undefined
    let initialValues: Iterable<number> | undefined
    try {
      buffer = options.buffer
      initialValues = options.initialValues
    } catch (error) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.optionsRead,
        { cause: error }
      )
    }
    if (buffer !== undefined && !isSharedBuffer(buffer)) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.bufferType
      )
    }
    if (!Number.isInteger(length) || length < 0) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.arrayLength
      )
    }
    let preparedInitialValues: number[] | undefined
    if (!buffer && initialValues) {
      try {
        preparedInitialValues = []
        for (const value of initialValues) {
          if (preparedInitialValues.length >= length) break
          preparedInitialValues.push(asInt32(value, 'shared cell value'))
        }
      } catch (error) {
        throw createStoreSharedRangeError(
          StoreSharedErrorCode.invalidOption,
          StoreSharedErrorText.initialValuesInvalid,
          { cause: error }
        )
      }
    }
    this.runtime = runtime
    this.length = length
    const valuesEnd = ARRAY_VALUES_OFFSET + length * ARRAY_VALUE_BYTES
    const versionsOffset =
      (valuesEnd + BigInt64Array.BYTES_PER_ELEMENT - 1) & ~(BigInt64Array.BYTES_PER_ELEMENT - 1)
    const requiredBytes = versionsOffset + length * ARRAY_VERSION_BYTES
    if (
      !Number.isSafeInteger(requiredBytes) ||
      requiredBytes / Int32Array.BYTES_PER_ELEMENT > MAX_INT32_ARRAY_SLOTS
    ) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.arrayLengthTooLarge
      )
    }
    this.buffer = buffer ?? new SharedArrayBuffer(requiredBytes)
    if (this.buffer.byteLength < requiredBytes) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.bufferTooSmall,
        StoreSharedErrorText.arrayBufferSmall
      )
    }
    this.#valueView = new Int32Array(
      this.buffer,
      0,
      Math.ceil(valuesEnd / Int32Array.BYTES_PER_ELEMENT)
    )
    this.#versionView = new BigInt64Array(this.buffer, versionsOffset, length)
    this.#generationView = new BigInt64Array(this.buffer, ARRAY_GENERATION_OFFSET, 1)
    this.#observedVersions = new BigInt64Array(length)
    if (!buffer) {
      Atomics.store(this.#valueView, ARRAY_MAGIC_SLOT, SHARED_ABI_MAGIC)
      Atomics.store(this.#valueView, ARRAY_LAYOUT_SLOT, SHARED_ABI_VERSION)
      Atomics.store(this.#valueView, ARRAY_KIND_SLOT, SharedAbiKind.array)
      Atomics.store(this.#valueView, ARRAY_READY_SLOT, SharedAbiReady.initializing)
      Atomics.store(this.#valueView, ARRAY_LENGTH_SLOT, length)
      Atomics.store(this.#generationView, 0, 0n)
    } else {
      assertAbiHeader(this.#valueView, SharedAbiKind.array, length)
    }
    this.#observedGeneration = Atomics.load(this.#generationView, 0)
    if (preparedInitialValues) {
      for (let index = 0; index < preparedInitialValues.length; index++) {
        Atomics.store(this.#valueView, this.#valueSlot(index), preparedInitialValues[index])
      }
    }
    if (!buffer) Atomics.store(this.#valueView, ARRAY_READY_SLOT, SharedAbiReady.ready)
    // Do not scan every seqlock during construction. Cells establish their
    // own baseline when first observed, while array-level sync uses epoch to
    // decide whether a full scan is needed at all.
    claimOwnership(this, runtime)
  }

  get disposed(): boolean {
    return this.#disposed
  }

  get(index: number): number {
    this.#assertIndex(index)
    if (!internalsOf(this.runtime).tracker.isTracking()) {
      return this.readCell(index).value
    }
    return this.#cell(index).read()
  }

  set(index: number, value: number): void {
    this.#assertIndex(index)
    const cell = this.#cells.get(index)
    if (cell) {
      cell.write(value)
      return
    }
    const version = this.writeCell(index, asInt32(value, 'shared cell value'))
    if (version !== undefined) {
      this.#observedVersions[index] = version
      this.notifyWaiters()
    }
  }

  /**
   * 读-改-写。
   *
   * 用户回调**在锁外**执行：持锁期间调用别人的代码，一旦它抛错就留下一把奇数的 死锁，之后所有读者都会自旋到上限然后抛。所以先一致读、锁外算、再带期望值写， 值被别人改掉就重来。 因此
   * `update` 回调必须纯且可重复执行；不要在回调中埋点、发请求或产生不可逆副作用。
   */
  update(index: number, update: (current: number) => number): number {
    this.#assertIndex(index)
    if (typeof update !== 'function') {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.updateFunction
      )
    }
    const cell = this.#cells.get(index)
    for (let spins = 0; spins < SPIN_LIMIT; spins++) {
      this.assertActive()
      const { value: current } = this.readCell(index)
      const next = asInt32(update(current), 'shared cell value')
      if (current === next) return current
      const version = this.writeCell(index, next, current)
      if (version !== undefined) {
        this.#observedVersions[index] = version
        if (cell) cell.commitWrite(version)
        else this.notifyWaiters()
        return next
      }
    }
    throw createStoreSharedError(
      StoreSharedErrorCode.contentionLimit,
      StoreSharedErrorText.arrayRace(index)
    )
  }

  /**
   * Scan for remote writes and notify only affected index observers.
   *
   * `watch()` 起了回路之后不必手动调；没有 waitAsync 的环境仍可从消息循环 pump。
   */
  sync(index?: number): number {
    this.assertActive()
    if (index !== undefined) {
      this.#assertIndex(index)
      const version = this.readCell(index).version
      if (version === this.#observedVersions[index]) return 0
      this.#observedVersions[index] = version
      this.#cells.get(index)?.sync()
      return 1
    }
    // Remote writers publish one array-level epoch for every completed write.
    // If it did not move, no cell can have changed and even a dirty-page scan
    // is unnecessary. A concurrent writer that increments after this load is
    // observed by the next sync call.
    const generation = Atomics.load(this.#generationView, 0)
    if (generation === this.#observedGeneration) return 0
    let changed = 0
    // A reader owns its local cursor. Every reader independently compares every
    // cell version, so one reader can never consume another reader's wake-up.
    this.runtime.batch(() => {
      for (let current = 0; current < this.length; current++) {
        const version = this.readCell(current).version
        if (version === this.#observedVersions[current]) continue
        this.#observedVersions[current] = version
        this.#cells.get(current)?.sync()
        changed++
      }
    })
    this.#observedGeneration = generation
    return changed
  }

  /**
   * 起一条 waitAsync 回路覆盖整片。
   *
   * 等的是 epoch 而不是逐格的 seq：一格一个 waiter 在长数组上不可行。醒来后 `sync()` 扫描，只有真正变了的格会通知它自己的观察者。
   */
  watch(): IDisposer {
    this.assertActive()
    if (this.#stopWatching) return this.#stopWatching
    let disposer: IDisposer | undefined
    const stop = watchSlot(
      this.#generationView,
      0,
      () => {
        if (!this.#disposed) this.sync()
      },
      (error) => {
        reportSharedWatchFailure(this.runtime, error)
        if (this.#stopWatching === disposer) this.#stopWatching = undefined
      }
    )
    disposer = () => {
      stop()
      if (this.#stopWatching === disposer) this.#stopWatching = undefined
    }
    this.#stopWatching = disposer
    return disposer
  }

  snapshot(): Int32Array {
    this.assertActive()
    const result = new Int32Array(this.length)
    for (let index = 0; index < this.length; index++) {
      result[index] = this.readCell(index).value
    }
    return result
  }

  /** Release cells that no longer have observers after high-churn access. */
  prune(): number {
    this.assertActive()
    let removed = 0
    for (const [index, cell] of this.#cells) {
      if (cell.subs.size !== 0) continue
      internalsOf(this.runtime).tracker.disconnectObservable(cell, 'dispose')
      this.#cells.delete(index)
      removed++
    }
    return removed
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#stopWatching?.()
    for (const cell of this.#cells.values()) {
      internalsOf(this.runtime).tracker.disconnectObservable(cell, 'dispose')
    }
  }

  assertActive(): void {
    if (this.#disposed) {
      throw createStoreSharedError(
        StoreSharedErrorCode.arrayDisposed,
        StoreSharedErrorText.arrayDisposed
      )
    }
  }

  /** 一致读某一格：value 与 version 同源。 */
  readCell(index: number): {
    readonly value: number
    readonly version: bigint
  } {
    return readConsistent(this.#valueView, this.#versionView, this.#valueSlot(index), index)
  }

  /** 写某一格；返回新版本，或 undefined 表示没写（值未变或期望值不符）。 */
  writeCell(index: number, value: number, expected?: number): bigint | undefined {
    const version = writeLocked(
      this.#valueView,
      this.#versionView,
      this.#valueSlot(index),
      index,
      value,
      expected
    )
    return version
  }

  /** Advance the shared 64-bit generation and wake every independent reader cursor. */
  notifyWaiters(): void {
    this.#observedGeneration = Atomics.add(this.#generationView, 0, 1n) + 1n
    Atomics.notify(this.#generationView as never, 0)
  }

  /** Keep array-level pull bookkeeping aligned with local cell writes. */
  recordObservedVersion(index: number, version: bigint): void {
    this.#observedVersions[index] = version
  }

  #cell(index: number): SharedInt32ArrayCell {
    this.#assertIndex(index)
    let cell = this.#cells.get(index)
    if (!cell) {
      cell = new SharedInt32ArrayCell(this, index)
      this.#cells.set(index, cell)
      const created = cell
      // React/Computed may abandon a speculative read before committing an
      // observer. Reclaim that cell instead of retaining it until array dispose.
      queueMicrotask(() => {
        if (this.#disposed || created.subs.size !== 0) return
        internalsOf(this.runtime).tracker.disconnectObservable(created, 'dispose')
        if (this.#cells.get(index) === created) this.#cells.delete(index)
      })
    }
    return cell
  }

  #assertIndex(index: number): void {
    this.assertActive()
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.indexOutOfRange,
        StoreSharedErrorText.arrayIndex(index)
      )
    }
  }

  #valueSlot(index: number): number {
    return ARRAY_VALUES_OFFSET / Int32Array.BYTES_PER_ELEMENT + index
  }
}

export const sharedInt32Array = (
  runtime: IRuntime,
  length: number,
  options?: {
    readonly buffer?: SharedArrayBuffer
    readonly initialValues?: Iterable<number>
  }
): SharedInt32Array => new SharedInt32Array(runtime, length, options)
