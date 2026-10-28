import { resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import {
  ReactiveErrorPhase,
  type IDisposable,
  type IDisposer,
  type IRuntime
} from '@migaia/reactive'
import {
  claimOwnership,
  deferRuntimeCleanup,
  createSourceBinding,
  isRuntimeTracking,
  type IRuntimeSourceBinding,
  type IObservable,
  type IObserver
} from '@migaia/reactive/extension'
import {
  createStoreSharedError,
  createStoreSharedRangeError,
  STORE_SHARED_SOURCE
} from './errors.ts'
import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'
import { StoreSharedErrorCode } from './error-code.ts'
import { StoreSharedErrorText } from './error-text.ts'
import {
  SHARED_ABI_MAGIC,
  SHARED_ABI_VERSION,
  SharedAbiKind,
  SharedAbiReady
} from './shared-constants.ts'

/**
 * SharedArrayBuffer 支撑的跨线程状态。
 *
 * 布局包含 ABI header、int32 value 与对齐的 int64 seq；signal 共 32 字节。`seq`
 * 同时充当版本号与写锁——奇数表示「有人正在写」，每次完成的写入把它推进 2。
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

/** Busy-spin attempts in one contention round, before each pause or backoff. */
const SPIN_LIMIT = 1 << 16

/**
 * Sustained contention window, in milliseconds, before a seqlock read or lock acquisition throws
 * `CONTENTION_LIMIT`. Persistent competition, a delayed writer or an abandoned lock can all exhaust
 * this window; reaching it alone does not identify which writer condition occurred.
 */
const CONTENTION_TIMEOUT_MS = 1000

/** Timeout, in milliseconds, of one `Atomics.wait` pause between contention rounds. */
const CONTENTION_WAIT_MS = 1

/**
 * Whether this agent may block in `Atomics.wait`. Browser main threads refuse it with a
 * `TypeError`; the first refusal flips this to false so later rounds back off by spinning again.
 */
let blockingWaitAllowed = true

/**
 * Pauses after one exhausted spin round. Returns false once contention has lasted
 * `CONTENTION_TIMEOUT_MS` since `startedAt`, so the caller throws `CONTENTION_LIMIT`.
 *
 * Worker threads block in `Atomics.wait` until the seq changes or `CONTENTION_WAIT_MS` elapses.
 * Where blocking is refused, the pause returns at once and the caller runs another spin round.
 */
function backOffContention(
  versionView: BigInt64Array,
  versionSlot: number,
  startedAt: number
): boolean {
  if (performance.now() - startedAt >= CONTENTION_TIMEOUT_MS) return false
  if (blockingWaitAllowed) {
    try {
      Atomics.wait(
        versionView,
        versionSlot,
        Atomics.load(versionView, versionSlot),
        CONTENTION_WAIT_MS
      )
    } catch (error) {
      // A TypeError is the host refusing to block this agent, a capability answer rather than a
      // failure. Any other error is a real fault and propagates.
      if (!(error instanceof TypeError)) throw error
      blockingWaitAllowed = false
    }
  }
  return true
}

/**
 * Keeps waitAsync callback diagnostics from escaping the cross-thread promise boundary.
 * `runtime.reportError` already contains reporter failures, so no fallback sink is needed here.
 */
function reportSharedWatchFailure(runtime: IRuntime, error: unknown): void {
  runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })
}

/**
 * 一致读：value 与 version 同源。
 *
 * 自旋有上限：写者若在持锁期间崩溃（线程被终止、页面被杀），seq 会永远停在奇数， 此时无限自旋会把这条线程也吊死。 每轮自旋到限后先退避（worker 用 `Atomics.wait`
 * 短暂阻塞，主线程再自旋一轮），写者只是被抢占时会很快恢复； 持续 `CONTENTION_TIMEOUT_MS` 仍未稳定才抛，把「有人写坏了」暴露出来，而不是静默卡住。
 */
function readConsistent(
  valueView: Int32Array,
  versionView: BigInt64Array,
  valueSlot: number,
  versionSlot: number
): { readonly value: number; readonly version: bigint } {
  /** Start of the sustained-contention window; set after the first exhausted spin round. */
  let startedAt: number | undefined
  do {
    for (let spins = 0; spins < SPIN_LIMIT; spins++) {
      const before = Atomics.load(versionView, versionSlot)
      if ((before & 1n) !== 0n) continue
      const value = Atomics.load(valueView, valueSlot)
      const after = Atomics.load(versionView, versionSlot)
      if (before === after) return { value, version: before }
    }
    startedAt ??= performance.now()
  } while (backOffContention(versionView, versionSlot, startedAt))
  throw createStoreSharedError(
    StoreSharedErrorCode.contentionLimit,
    StoreSharedErrorText.cellUnsettled
  )
}

/** 获锁：把偶数 seq 推成奇数。返回获锁前的偶数 seq。退避与超时规则同 `readConsistent`。 */
function acquire(versionView: BigInt64Array, versionSlot: number): bigint {
  /** Start of the sustained-contention window; set after the first exhausted spin round. */
  let startedAt: number | undefined
  do {
    for (let spins = 0; spins < SPIN_LIMIT; spins++) {
      const seq = Atomics.load(versionView, versionSlot)
      if ((seq & 1n) !== 0n) continue
      if (Atomics.compareExchange(versionView, versionSlot, seq, seq + 1n) === seq) {
        return seq
      }
    }
    startedAt ??= performance.now()
  } while (backOffContention(versionView, versionSlot, startedAt))
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
  onError: (error: unknown) => void,
  schedulerOption?: IScheduler
): { readonly start: () => void; readonly stop: IDisposer } {
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
  /** Capture one admitted scheduler before any waiter starts. */
  const scheduler = resolveSchedulerOption({ scheduler: schedulerOption }, systemScheduler)
  let stopped = false
  let timer: IScheduledTask | undefined

  /** Schedule another wait without retaining a live timer after disposal. */
  const schedule = (): void => {
    if (stopped) return
    try {
      timer = scheduler.schedule(() => {
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
      /**
       * Capture before reconciliation so a write during publication cannot become an unseen
       * baseline.
       */
      const expected = Atomics.load(view, slot)
      // The yielding task has no native waiter. Pull its missed writes before waiting again.
      onWake()
      if (stopped) return
      result = waitAsync(view as never, slot, expected)
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

  /** Stop is published by the owner before start can synchronously publish graph changes. */
  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (timer !== undefined) {
      timer.cancel()
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
  return { start: loop, stop }
}

/**
 * One shared int32 value with a local reactive source owned by the supplied Runtime. Pass its
 * buffer to a separate wrapper in another Runtime or Worker; the wrappers share bytes, not
 * subscriptions. Local writes publish immediately, while remote graph updates need a value read,
 * sync() or an active watch(). Dispose each wrapper when its local observers are done.
 */
export class SharedInt32Signal implements IObservable, IDisposable {
  /** Runtime whose graph tracks this wrapper and receives watch-loop diagnostics. */
  readonly runtime: IRuntime
  /** Shared ABI storage to pass to another wrapper; disposing this wrapper does not erase it. */
  readonly buffer: SharedArrayBuffer
  /** Canonical source metadata and graph operations bound to this exact SAB node. */
  readonly #binding: IRuntimeSourceBinding
  /** Live read-only subscription view maintained by the Runtime; consumers must not mutate it. */
  readonly subs: ReadonlySet<IObserver>
  /** Local reactive graph version, distinct from the shared 64-bit seqlock version. */
  get version(): number {
    return this.#binding.version
  }
  #valueView: Int32Array
  #versionView: BigInt64Array
  #observedSharedVersion: bigint
  #disposed = false
  #stopWatching?: IDisposer

  /**
   * Creates a 32-byte shared signal initialized to initialValue, which defaults to zero, or
   * attaches to an existing compatible buffer without reading or overwriting initialValue. New
   * values must be int32 integers. Invalid input or ABI headers throw INVALID_OPTION, undersized
   * buffers throw BUFFER_TOO_SMALL, and a shared value that cannot settle throws CONTENTION_LIMIT.
   */
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
    this.#binding = createSourceBinding(this)
    this.subs = this.#binding.subs
  }

  /** Whether this local wrapper has been disposed; reading this flag remains valid afterward. */
  get disposed(): boolean {
    return this.#disposed
  }

  /**
   * Reads a consistent shared value, publishes a newly observed remote version and tracks this
   * source in the current reactive computation. Synchronous publication may itself change the
   * value, so the returned value is reread after publication. Throws SIGNAL_DISPOSED after disposal
   * or CONTENTION_LIMIT if a consistent shared read cannot complete.
   */
  get value(): number {
    this.#assertActive()
    /** Reuse a stable seqlock snapshot; publication may synchronously run a writer. */
    const snapshot = this.#read()
    const changed = this.#syncVersion(snapshot.version)
    this.#binding.source.track()
    return changed ? this.#read().value : snapshot.value
  }

  /**
   * Commits an int32 value, wakes remote waiters and notifies local graph observers. An unchanged
   * value does none of these. Invalid values throw INVALID_OPTION; disposal and sustained lock
   * contention throw SIGNAL_DISPOSED and CONTENTION_LIMIT respectively. Graph notification can fail
   * after the shared write and remote wakeup have already committed.
   */
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
    this.#binding.source.notify()
  }

  /**
   * Pulls remote writes into this `Runtime`.
   *
   * An active `watch()` loop performs this automatically. Without `Atomics.waitAsync`, callers can
   * poll from their own message loop. Returns true when this reader's observed shared version
   * changes, false otherwise; it does not track a dependency. Throws SIGNAL_DISPOSED after disposal
   * or CONTENTION_LIMIT when the shared read remains unstable.
   */
  sync(): boolean {
    this.#assertActive()
    return this.#syncVersion(this.#read().version)
  }

  /** Publishes one remote version; its synchronous fanout can change the underlying value. */
  #syncVersion(version: bigint): boolean {
    if (version === this.#observedSharedVersion) return false
    this.#observedSharedVersion = version
    this.#binding.source.notify()
    return true
  }

  /**
   * Starts an `Atomics.waitAsync` loop that publishes remote writes to this `Runtime` without
   * manual `sync()` polling.
   *
   * The first call also reconciles existing remote writes synchronously. Its optional scheduler
   * defaults to systemScheduler and owns zero-delay rearming, not the native wait itself. Repeated
   * calls while active return the same stop function and retain that scheduler. Stop is idempotent,
   * wakes a pending waiter and permits a later watch() to start a new loop; dispose() stops it too.
   * Throws ENV_UNSUPPORTED without waitAsync or SIGNAL_DISPOSED after disposal. Loop failures go to
   * runtime.reportError; ordinary sync() polling remains available without waitAsync.
   */
  watch(scheduler?: IScheduler): IDisposer {
    this.#assertActive()
    if (this.#stopWatching) return this.#stopWatching
    let disposer: IDisposer | undefined
    const watch = watchSlot(
      this.#versionView,
      0,
      () => {
        if (!this.#disposed) this.sync()
      },
      (error) => {
        reportSharedWatchFailure(this.runtime, error)
        if (this.#stopWatching === disposer) this.#stopWatching = undefined
      },
      scheduler
    )
    disposer = () => {
      watch.stop()
      if (this.#stopWatching === disposer) this.#stopWatching = undefined
    }
    this.#stopWatching = disposer
    watch.start()
    return disposer
  }

  /**
   * Reads current shared bytes consistently without tracking, advancing the observed cursor or
   * notifying observers. A remote value can therefore be visible here while isStale() stays true.
   * Throws SIGNAL_DISPOSED after disposal or CONTENTION_LIMIT when the read cannot settle.
   */
  peek(): number {
    this.#assertActive()
    return this.#read().value
  }

  /** Reactive observation hook; this signal keeps its resources independent of subscriber count. */
  onObserved(): void {}
  /** Reactive unsubscription hook; it does not stop an explicitly owned watch loop. */
  onUnobserved(): void {}
  /**
   * Compares the current shared version with this reader's observed version without publishing or
   * tracking. It remains callable after disposal, but an unsettled read can throw
   * CONTENTION_LIMIT.
   */
  isStale(): boolean {
    return this.#read().version !== this.#observedSharedVersion
  }

  /**
   * Idempotently stops this wrapper's watcher and disconnects its reactive source. Dispose local
   * effects first if they would otherwise reread the source while it disconnects. Shared storage
   * and other wrappers remain usable; value, peek(), sync() and watch() now throw SIGNAL_DISPOSED.
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#stopWatching?.()
    this.#binding.source.dispose()
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

/**
 * Creates a SharedInt32Signal in the supplied Runtime. initialValue defaults to zero for a new
 * 32-byte buffer and is ignored when attaching a compatible buffer. The returned wrapper owns its
 * local graph source and watcher, so dispose it separately from other wrappers over the same bytes.
 * Construction failures follow the SharedInt32Signal constructor's validation and contention
 * rules.
 */
export const sharedInt32 = (
  runtime: IRuntime,
  initialValue = 0,
  buffer?: SharedArrayBuffer
): SharedInt32Signal => new SharedInt32Signal(runtime, initialValue, buffer)

/** Runs the public updater outside the lock and preserves its original failure identity or cause. */
function runSharedUpdate(update: (current: number) => number, current: number): number {
  try {
    return update(current)
  } catch (error) {
    if (isNativeErrorValue(error)) {
      /** Classified native errors keep their class, stack and exact identity. */
      let identified: Error | undefined
      try {
        /** Do not invoke application-owned metadata accessors during error classification. */
        const source = Object.getOwnPropertyDescriptor(error, 'source')
        /** Complete existing identities continue to refer to their actual owner. */
        const code = Object.getOwnPropertyDescriptor(error, 'code')
        if (typeof source?.value === 'string' && typeof code?.value === 'string') identified = error
        else if (!source && !code && Object.isExtensible(error)) {
          identified = attachErrorIdentity(error, {
            source: STORE_SHARED_SOURCE,
            code: StoreSharedErrorCode.updateFailed
          })
        }
      } catch (metadataError) {
        throw attachErrorIdentity(
          new AggregateError([error, metadataError], StoreSharedErrorText.updateFailed),
          { source: STORE_SHARED_SOURCE, code: StoreSharedErrorCode.updateFailed }
        )
      }
      if (identified) throw identified
    }
    throw createStoreSharedError(
      StoreSharedErrorCode.updateFailed,
      StoreSharedErrorText.updateFailed,
      {
        cause: error
      }
    )
  }
}

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
  /** Canonical source metadata and graph operations bound to this exact SAB node. */
  readonly #binding: IRuntimeSourceBinding
  readonly subs: ReadonlySet<IObserver>
  get version(): number {
    return this.#binding.version
  }
  #owner: SharedInt32Array
  #index: number
  #observedSharedVersion: bigint
  /** Releases this private cell only after its last graph observer leaves. */
  readonly #releaseDormant: () => void

  constructor(owner: SharedInt32Array, index: number, releaseDormant: () => void) {
    this.#releaseDormant = releaseDormant
    this.#owner = owner
    this.runtime = owner.runtime
    this.#index = index
    this.#observedSharedVersion = owner.readCell(index).version
    this.#binding = createSourceBinding(this)
    this.subs = this.#binding.subs
  }

  read(): number {
    this.#owner.assertActive()
    this.sync()
    this.#binding.source.track()
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
    this.#binding.source.notify()
  }

  sync(): boolean {
    this.#owner.assertActive()
    const { version } = this.#owner.readCell(this.#index)
    if (version === this.#observedSharedVersion) return false
    this.#observedSharedVersion = version
    this.#binding.source.notify()
    return true
  }

  isStale(): boolean {
    return this.#owner.readCell(this.#index).version !== this.#observedSharedVersion
  }

  /** The canonical tracker calls this when the final downstream edge disconnects. */
  onUnobserved(): void {
    this.#releaseDormant()
  }

  /** Releases the cell's graph source when its owning array evicts or disposes it. */
  dispose(): void {
    this.#binding.source.dispose()
  }
}

/**
 * Fixed-layout, index-granular shared state for Workers. Each element owns a value/seq pair in the
 * SharedArrayBuffer, so a write notifies only local reactive readers of that index. Each wrapper
 * owns independent synchronization cursors; sync() or watch() publishes remote writes to its graph.
 * The array supports int32 cells, not general objects or atomic transactions across several cells.
 */
export class SharedInt32Array implements IDisposable {
  /** Runtime that owns this wrapper, its lazily materialized cells and watch diagnostics. */
  readonly runtime: IRuntime
  /** Shared ABI storage; attach another wrapper with the same length to share these cells. */
  readonly buffer: SharedArrayBuffer
  /** Fixed number of int32 cells, including zero; it cannot be resized through this wrapper. */
  readonly length: number
  #valueView: Int32Array
  #versionView: BigInt64Array
  #generationView: BigInt64Array
  #cells = new Map<number, SharedInt32ArrayCell>()
  #observedVersions: BigInt64Array
  /** Generation last completely scanned by this reader, never acknowledged by local publication. */
  #observedGeneration: bigint
  #disposed = false
  #stopWatching?: IDisposer

  /**
   * Creates a zero-filled shared array, or attaches to a compatible buffer with the same length.
   * length must be a nonnegative integer whose layout fits the typed-array capacity. New-buffer
   * initialValues consumes at most length int32 values and closes the iterator at that prefix; zero
   * length consumes none. Attaching ignores initialValues and preserves shared data. Invalid
   * options, lengths, values or ABI headers throw INVALID_OPTION; small buffers throw
   * BUFFER_TOO_SMALL. Option-read and initial-iterator failures remain reachable through cause.
   */
  constructor(
    runtime: IRuntime,
    length: number,
    options: {
      /** Existing compatible array storage; omission allocates a new zero-filled layout. */
      readonly buffer?: SharedArrayBuffer
      /** Optional prefix for new storage only; remaining cells stay zero and the tail is not read. */
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
    if (!buffer && initialValues && length > 0) {
      try {
        preparedInitialValues = []
        for (const value of initialValues) {
          preparedInitialValues.push(asInt32(value, 'shared cell value'))
          if (preparedInitialValues.length >= length) break
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

  /** Whether this local wrapper has been disposed; metadata remains readable afterward. */
  get disposed(): boolean {
    return this.#disposed
  }

  /**
   * Reads one consistent cell. Inside a reactive computation it lazily materializes that index's
   * source, reconciles its version and tracks it; outside tracking it reads without a cell or graph
   * publication. Throws ARRAY_DISPOSED, INDEX_OUT_OF_RANGE or CONTENTION_LIMIT when applicable.
   */
  get(index: number): number {
    this.#assertIndex(index)
    if (!isRuntimeTracking(this.runtime)) {
      return this.readCell(index).value
    }
    return this.#cell(index).read()
  }

  /**
   * Writes an int32 cell, publishes its shared generation and notifies only its existing local
   * index observers. An equal value is a no-op. Throws ARRAY_DISPOSED, INDEX_OUT_OF_RANGE,
   * INVALID_OPTION or CONTENTION_LIMIT; local graph failure can occur after the write committed.
   */
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
   * Reads, updates, and writes one cell.
   *
   * The callback runs outside the lock so a thrown exception cannot leave readers spinning on an
   * odd locked version. The operation reads a consistent value, computes outside the lock, and
   * writes with that value as its expectation. It retries if another writer changes the value. The
   * `update` callback must be pure and repeatable. Avoid telemetry, requests, and irreversible side
   * effects in the callback. Returns the committed value, or the observed value if unchanged.
   * Invalid indexes/results throw INDEX_OUT_OF_RANGE/INVALID_OPTION, disposal throws ARRAY_DISPOSED
   * and exhausted retries throw CONTENTION_LIMIT. Callback errors keep a complete foreign identity;
   * unclassified extensible native errors receive UPDATE_FAILED in place, while other thrown values
   * remain reachable through cause. A callback failure itself never leaves the write lock held.
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
      const next = asInt32(runSharedUpdate(update, current), 'shared cell value')
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
   * Scans remote writes and notifies only affected index observers.
   *
   * An active `watch()` loop performs this automatically. Without `Atomics.waitAsync`, callers can
   * poll from their message loop. Omitting index compares the shared generation, returning zero
   * without a scan when unchanged, otherwise scanning all cells in one Runtime batch. The returned
   * count includes changed cells without observers; each wrapper consumes only its own cursor. A
   * supplied index checks only that cell and returns zero or one. Throws ARRAY_DISPOSED,
   * INDEX_OUT_OF_RANGE for an invalid supplied index, or CONTENTION_LIMIT for an unsettled cell.
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
   * Starts an `Atomics.waitAsync` loop for the whole array.
   *
   * It waits on the generation epoch instead of creating a waiter for every cell. After waking,
   * sync() scans cells and notifies observers only for cells that changed. The first call also
   * reconciles missed writes synchronously. scheduler defaults to systemScheduler for zero-delay
   * rearming; an active loop retains the first scheduler and returns the same stop function on
   * repeated calls. Stop is idempotent and a later watch() can start a new loop. Throws
   * ARRAY_DISPOSED after disposal or ENV_UNSUPPORTED without waitAsync; there is no silent polling
   * fallback. Loop failures are reported through this Runtime, and dispose() also stops the loop.
   */
  watch(scheduler?: IScheduler): IDisposer {
    this.assertActive()
    if (this.#stopWatching) return this.#stopWatching
    let disposer: IDisposer | undefined
    const watch = watchSlot(
      this.#generationView,
      0,
      () => {
        if (!this.#disposed) this.sync()
      },
      (error) => {
        reportSharedWatchFailure(this.runtime, error)
        if (this.#stopWatching === disposer) this.#stopWatching = undefined
      },
      scheduler
    )
    disposer = () => {
      watch.stop()
      if (this.#stopWatching === disposer) this.#stopWatching = undefined
    }
    this.#stopWatching = disposer
    watch.start()
    return disposer
  }

  /**
   * Copies all current values into a new ordinary Int32Array without tracking or publishing. Each
   * cell is read consistently, but concurrent writes can occur between cells: the result is not an
   * atomic whole-array snapshot. Mutating the copy cannot alter shared storage. Throws
   * ARRAY_DISPOSED after disposal or CONTENTION_LIMIT if a cell cannot settle.
   */
  snapshot(): Int32Array {
    this.assertActive()
    const result = new Int32Array(this.length)
    for (let index = 0; index < this.length; index++) {
      result[index] = this.readCell(index).value
    }
    return result
  }

  /**
   * Idempotently stops this local watcher and disconnects all materialized index sources. Dispose
   * dependent effects first if they would reread during disconnection. High-level reads, writes,
   * synchronization and watch calls then throw ARRAY_DISPOSED; shared bytes and other wrappers are
   * unaffected. Low-level cell primitives do not perform this lifecycle check automatically.
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#stopWatching?.()
    for (const cell of this.#cells.values()) {
      cell.dispose()
    }
  }

  /** Throws ARRAY_DISPOSED when composing low-level operations on a closed wrapper. */
  assertActive(): void {
    if (this.#disposed) {
      throw createStoreSharedError(
        StoreSharedErrorCode.arrayDisposed,
        StoreSharedErrorText.arrayDisposed
      )
    }
  }

  /**
   * Reads one cell consistently, returning a value and shared bigint version from the same
   * observation. Extension code must supply a valid index and enforce the lifecycle itself; this
   * primitive neither validates them nor tracks or publishes. Contention can throw
   * CONTENTION_LIMIT. Prefer get() for checked application reads.
   */
  readCell(index: number): {
    /** The cell's int32 value in this completed shared read. */
    readonly value: number
    /** Even shared seqlock sequence for that value, distinct from a local graph version. */
    readonly version: bigint
  } {
    return readConsistent(this.#valueView, this.#versionView, this.#valueSlot(index), index)
  }

  /**
   * Writes one cell and returns its new version. Returns `undefined` when the value is unchanged or
   * the expected value does not match. Omitting expected means an unconditional write. The caller
   * owns active/index/int32 validation and publication: after a changed write, call notifyWaiters()
   * then sync(index) to notify an existing local source. This primitive does not do either step or
   * advance observed cursors. Lock contention can throw CONTENTION_LIMIT; prefer set()/update()
   * unless composing that complete protocol.
   */
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

  /**
   * Advances the shared 64-bit generation and wakes array watchers after a low-level committed
   * write. It neither publishes local sources nor consumes this reader's cursor; use sync(index)
   * afterward for local publication. Extension code owns lifecycle checks and must not use this as
   * a replacement for actually committing a cell write.
   */
  notifyWaiters(): void {
    // Publishing this write does not mean this reader scanned other remote cells in the generation.
    Atomics.add(this.#generationView, 0, 1n)
    Atomics.notify(this.#generationView as never, 0)
  }

  /**
   * Copies one cell version into this reader's array-level cursor without validation or graph
   * publication. It is a bookkeeping primitive for extension code that already published the
   * change; copying it before sync(index) would hide that change from the existing local source.
   * Ordinary low-level writes should use notifyWaiters() then sync(index) instead.
   */
  recordObservedVersion(index: number, version: bigint): void {
    this.#observedVersions[index] = version
  }

  #cell(index: number): SharedInt32ArrayCell {
    this.#assertIndex(index)
    let cell = this.#cells.get(index)
    if (!cell) {
      /** Both committed and abandoned observations release only this exact private cell. */
      const releaseDormant = (): void => {
        if (this.#disposed || created.subs.size !== 0 || this.#cells.get(index) !== created) return
        this.#cells.delete(index)
        created.dispose()
      }
      const created = new SharedInt32ArrayCell(this, index, releaseDormant)
      cell = created
      this.#cells.set(index, created)
      // Abandoned speculative reads never reach an onUnobserved transition.
      deferRuntimeCleanup(this.runtime, releaseDormant)
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

/**
 * Creates a SharedInt32Array in the supplied Runtime, sharing an existing compatible buffer or
 * allocating fixed-length zero-filled int32 storage. options defaults to an empty object; a new
 * buffer can consume an initialValues prefix, while attachment ignores it. Dispose the returned
 * local wrapper independently of other readers. Validation follows the class constructor.
 */
export const sharedInt32Array = (
  runtime: IRuntime,
  length: number,
  options?: {
    /** Compatible shared array storage with the same length; omission allocates new storage. */
    readonly buffer?: SharedArrayBuffer
    /** Optional new-buffer prefix; stops after length entries, leaving missing entries zero. */
    readonly initialValues?: Iterable<number>
  }
): SharedInt32Array => new SharedInt32Array(runtime, length, options)
