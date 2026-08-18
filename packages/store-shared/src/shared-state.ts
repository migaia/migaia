import {
  ReactiveErrorPhase,
  type IDisposable,
  type IDisposer,
  type IObservable,
  type IObserver,
  type IRuntime
} from '@migaia/reactive/runtime';
import { internalsOf } from '@migaia/reactive/internals';
import { claimOwnership } from '@migaia/reactive/ownership';
import { registerSubs, registerVersion, readVersion } from '@migaia/reactive/node-internals';
import { createStoreSharedError, createStoreSharedRangeError } from './errors.js';
import { StoreSharedErrorCode } from './error-code.js';
import { StoreSharedErrorText } from './error-text.js';

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

const SPIN_LIMIT = 1 << 16;

/** Keeps waitAsync callback diagnostics from escaping the cross-thread promise boundary. */
function reportSharedWatchFailure(runtime: IRuntime, error: unknown): void {
  try {
    runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush });
    return;
  } catch (reporterError) {
    const hostReportError = (globalThis as { reportError?: (error: unknown) => void }).reportError;
    try {
      if (hostReportError) hostReportError(reporterError);
      else console.error(reporterError);
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
  view: Int32Array,
  valueSlot: number,
  seqSlot: number
): { readonly value: number; readonly version: number } {
  for (let spins = 0; spins < SPIN_LIMIT; spins++) {
    const before = Atomics.load(view, seqSlot);
    if ((before & 1) !== 0) continue;
    const value = Atomics.load(view, valueSlot);
    const after = Atomics.load(view, seqSlot);
    if (before === after) return { value, version: before };
  }
  throw createStoreSharedError(
    StoreSharedErrorCode.contentionLimit,
    StoreSharedErrorText.cellUnsettled
  );
}

/** 获锁：把偶数 seq 推成奇数。返回获锁前的偶数 seq。 */
function acquire(view: Int32Array, seqSlot: number): number {
  for (let spins = 0; spins < SPIN_LIMIT; spins++) {
    const seq = Atomics.load(view, seqSlot);
    if ((seq & 1) !== 0) continue;
    if (Atomics.compareExchange(view, seqSlot, seq, seq + 1) === seq) {
      return seq;
    }
  }
  throw createStoreSharedError(
    StoreSharedErrorCode.contentionLimit,
    StoreSharedErrorText.lockUnacquired
  );
}

/**
 * 带期望值的写入。
 *
 * `expected` 为 undefined 表示「无条件写」；给了期望值则相当于 CAS：值已经被别人 改掉就释放锁并返回 undefined，由调用方重算（`update` 用这条路）。
 *
 * 返回新的 seq（即新版本），或 undefined 表示未写入。值未变化时也返回 undefined， 并把 seq 原样释放——不变的写入不该推进版本，否则每次 set 相同值都会通知一轮。
 */
function writeLocked(
  view: Int32Array,
  valueSlot: number,
  seqSlot: number,
  next: number,
  expected?: number
): number | undefined {
  const seq = acquire(view, seqSlot);
  try {
    const current = Atomics.load(view, valueSlot);
    if (expected !== undefined && current !== expected) return undefined;
    if (current === next) return undefined;
    Atomics.store(view, valueSlot, next);
    const committed = (seq + 2) | 0;
    Atomics.store(view, seqSlot, committed);
    return committed;
  } finally {
    // 未写入时把锁原样放回；已写入时上面已经推进到 seq+2，这里不能再动
    if (Atomics.load(view, seqSlot) === seq + 1) {
      Atomics.store(view, seqSlot, seq);
    }
  }
}

const SIGNAL_VALUE_SLOT = 0;
const SIGNAL_SEQ_SLOT = 1;
const SIGNAL_SLOTS = 2;

/** The largest slot index supported by the ECMAScript typed-array index space. */
const MAX_INT32_ARRAY_SLOTS = 0xffffffff;

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
    );
  }
  return value;
}

const hasWaitAsync = (): boolean =>
  typeof Atomics !== 'undefined' &&
  typeof (
    Atomics as unknown as {
      waitAsync?: unknown;
    }
  ).waitAsync === 'function';

type IWaitAsyncResult = {
  readonly async: boolean;
  readonly value: 'ok' | 'not-equal' | 'timed-out' | Promise<'ok' | 'timed-out'>;
};

/**
 * 在某个 slot 上起一条 waitAsync 唤醒回路。
 *
 * 没有它的话，远端写入只能靠调用方自己 pump `sync()`——那意味着「共享响应式」在跨 线程方向其实是**拉取式**：本线程不主动问就永远不知道对面改了。
 *
 * `Atomics.wait` 不能用在主线程（会阻塞），所以走 `waitAsync`。环境不支持时抛错而 不是静默降级成拉取——静默降级会让调用方以为自己拿到了推送。
 */
function watchSlot(
  view: Int32Array,
  slot: number,
  onWake: () => void,
  onError: (error: unknown) => void
): IDisposer {
  if (!hasWaitAsync()) {
    throw createStoreSharedError(
      StoreSharedErrorCode.envUnsupported,
      StoreSharedErrorText.waitAsyncUnavailable
    );
  }
  const waitAsync = (
    Atomics as unknown as {
      waitAsync: (typedArray: Int32Array, index: number, value: number) => IWaitAsyncResult;
    }
  ).waitAsync;
  let stopped = false;

  const loop = (): void => {
    if (stopped) return;
    let result: IWaitAsyncResult;
    try {
      result = waitAsync(view, slot, Atomics.load(view, slot));
    } catch (error) {
      onError(error);
      return;
    }
    if (!result.async) {
      // 值在挂起前就变了（'not-equal'）：立刻处理并继续，不要错过这一次
      if (!stopped) {
        try {
          onWake();
        } catch (error) {
          onError(error);
          return;
        }
        setTimeout(loop, 0);
      }
      return;
    }
    void (result.value as Promise<'ok' | 'timed-out'>).then(
      () => {
        if (stopped) return;
        try {
          onWake();
        } catch (error) {
          onError(error);
          return;
        }
        setTimeout(loop, 0);
      },
      (error: unknown) => onError(error)
    );
  };

  loop();
  return () => {
    if (stopped) return;
    stopped = true;
    // Wake a pending waitAsync so its promise/callback can release the
    // captured SharedArrayBuffer view promptly instead of waiting for a
    // future remote write.
    try {
      Atomics.notify(view, slot);
    } catch {
      // The loop is already logically stopped; a host teardown may make the
      // view unavailable, so disposal must remain best-effort and idempotent.
    }
  };
}

export class SharedInt32Signal implements IObservable, IDisposable {
  readonly runtime: IRuntime;
  readonly buffer: SharedArrayBuffer;
  #subs = new Set<IObserver>();
  readonly subs: ReadonlySet<IObserver>;
  #initialVersion: number;
  get version(): number {
    return readVersion(this, this.#initialVersion);
  }
  #view: Int32Array;
  #observedSharedVersion: number;
  #disposed = false;
  #stopWatching?: IDisposer;

  constructor(runtime: IRuntime, initialValue = 0, buffer?: SharedArrayBuffer) {
    if (buffer !== undefined && !(buffer instanceof SharedArrayBuffer)) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.bufferType
      );
    }
    this.runtime = runtime;
    this.buffer = buffer ?? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * SIGNAL_SLOTS);
    if (this.buffer.byteLength < Int32Array.BYTES_PER_ELEMENT * SIGNAL_SLOTS) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.bufferTooSmall,
        StoreSharedErrorText.signalBufferSmall
      );
    }
    this.#view = new Int32Array(this.buffer, 0, SIGNAL_SLOTS);
    if (!buffer) {
      Atomics.store(this.#view, SIGNAL_VALUE_SLOT, asInt32(initialValue, 'shared signal value'));
    }
    this.#observedSharedVersion = readConsistent(
      this.#view,
      SIGNAL_VALUE_SLOT,
      SIGNAL_SEQ_SLOT
    ).version;
    this.#initialVersion = internalsOf(runtime).clock.next();
    this.subs = registerSubs(this, this.#subs);
    registerVersion(this, this.#initialVersion);
    claimOwnership(this, runtime);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get value(): number {
    this.#assertActive();
    this.sync();
    internalsOf(this.runtime).tracker.track(this);
    return this.#read().value;
  }

  set value(next: number) {
    this.#assertActive();
    const normalized = asInt32(next, 'shared signal value');
    const version = writeLocked(this.#view, SIGNAL_VALUE_SLOT, SIGNAL_SEQ_SLOT, normalized);
    if (version === undefined) return;
    this.#observedSharedVersion = version;
    internalsOf(this.runtime).notify(this);
    Atomics.notify(this.#view, SIGNAL_SEQ_SLOT);
  }

  /**
   * Pull remote writes into this Runtime.
   *
   * `watch()` 起了回路之后就不必手动调它；没有 waitAsync 的环境仍可从自己的消息 循环里 pump。
   */
  sync(): boolean {
    this.#assertActive();
    const { version } = this.#read();
    if (version === this.#observedSharedVersion) return false;
    this.#observedSharedVersion = version;
    internalsOf(this.runtime).notify(this);
    return true;
  }

  /**
   * 起一条 waitAsync 回路：远端写入直接推到本 Runtime，不必再 pump `sync()`。
   *
   * 返回停止函数；`dispose()` 也会停。
   */
  watch(): IDisposer {
    this.#assertActive();
    if (this.#stopWatching) return this.#stopWatching;
    const stop = watchSlot(
      this.#view,
      SIGNAL_SEQ_SLOT,
      () => {
        if (!this.#disposed) this.sync();
      },
      (error) => reportSharedWatchFailure(this.runtime, error)
    );
    const disposer = () => {
      stop();
      if (this.#stopWatching === disposer) this.#stopWatching = undefined;
    };
    this.#stopWatching = disposer;
    return disposer;
  }

  peek(): number {
    this.#assertActive();
    return this.#read().value;
  }

  onObserved(): void {}
  onUnobserved(): void {}
  isStale(): boolean {
    return this.#read().version !== this.#observedSharedVersion;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopWatching?.();
    internalsOf(this.runtime).tracker.disconnectObservable(this, 'dispose');
  }

  #read(): { readonly value: number; readonly version: number } {
    return readConsistent(this.#view, SIGNAL_VALUE_SLOT, SIGNAL_SEQ_SLOT);
  }

  #assertActive(): void {
    if (this.#disposed)
      throw createStoreSharedError(
        StoreSharedErrorCode.signalDisposed,
        StoreSharedErrorText.signalDisposed
      );
  }
}

export const sharedInt32 = (
  runtime: IRuntime,
  initialValue = 0,
  buffer?: SharedArrayBuffer
): SharedInt32Signal => new SharedInt32Signal(runtime, initialValue, buffer);

/**
 * 数组布局：头部一个 epoch slot，随后是脏页 bitmap（每 bit 一页，每页 `DIRTY_PAGE_SIZE` 格），最后是每格 `[value, seq]`。
 *
 * Epoch 是为了让**一条** waitAsync 回路覆盖整片：10k 格各起一个 waiter 显然不行。 但仅凭 epoch 决定"要不要扫"之后，扫描本身曾经是
 * O(length)——百万格的数组里 改一格也要整片过一遍。bitmap 把"要不要扫"细化到"扫哪几页"：每次落盘写入用 `Atomics.or` 把自己所在页的 bit 点亮（OR
 * 是无损的——多个写者并发点同一 bit 不会互相覆盖，也不会丢失彼此的标记）；`sync()` 用 `Atomics.exchange` 逐字读出并 清零每个 bitmap
 * word——exchange 是单次原子读改写，不存在"清零期间丢失一次并发 OR"的窗口：并发的 OR 要么完全发生在 exchange 之前（已经反映在读出的旧值里），
 * 要么完全发生在之后（作用在刚清零的 0 上，正确地留给下一次 sync() 发现）。
 *
 * Bitmap 和 epoch 一样只是"可能有写入"的提示，不是正确性来源——命中的每一页仍然 逐格用 seqlock 版本号判定是否真的变了、要不要通知。就算某次 bit 因为极端时序被
 * 提前清零、写入方的 OR 恰好在那之前完成，页内逐格版本比较依然会在下一轮 sync() 补上，不会漏掉一次真实变化。
 */
const ARRAY_EPOCH_SLOT = 0;
const ARRAY_HEADER_BASE_SLOTS = 1;
const DIRTY_PAGE_SIZE = 32;
const DIRTY_BITS_PER_WORD = 32;
const ARRAY_VALUE_OFFSET = 0;
const ARRAY_SEQ_OFFSET = 1;
const ARRAY_ENTRY_SLOTS = 2;

function dirtyPageCount(length: number): number {
  return Math.ceil(length / DIRTY_PAGE_SIZE);
}

function dirtyBitmapWords(length: number): number {
  return Math.ceil(dirtyPageCount(length) / DIRTY_BITS_PER_WORD);
}

class SharedInt32ArrayCell implements IObservable {
  readonly runtime: IRuntime;
  #subs = new Set<IObserver>();
  readonly subs: ReadonlySet<IObserver>;
  #initialVersion: number;
  get version(): number {
    return readVersion(this, this.#initialVersion);
  }
  #owner: SharedInt32Array;
  #index: number;
  #observedSharedVersion: number;

  constructor(owner: SharedInt32Array, index: number) {
    this.#owner = owner;
    this.runtime = owner.runtime;
    this.#index = index;
    this.#observedSharedVersion = owner.readCell(index).version;
    this.#initialVersion = internalsOf(this.runtime).clock.next();
    this.subs = registerSubs(this, this.#subs);
    registerVersion(this, this.#initialVersion);
    claimOwnership(this, this.runtime);
  }

  read(): number {
    this.#owner.assertActive();
    this.sync();
    internalsOf(this.runtime).tracker.track(this);
    return this.#owner.readCell(this.#index).value;
  }

  write(value: number): boolean {
    this.#owner.assertActive();
    const version = this.#owner.writeCell(this.#index, asInt32(value, 'shared cell value'));
    if (version === undefined) return false;
    this.commitWrite(version);
    return true;
  }

  /** 写入已落盘之后的收尾：记下新版本、通知本 Runtime、唤醒远端。 */
  commitWrite(version: number): void {
    this.#observedSharedVersion = version;
    this.#owner.recordObservedVersion(this.#index, version);
    internalsOf(this.runtime).notify(this);
    this.#owner.notifyWaiters();
  }

  sync(): boolean {
    this.#owner.assertActive();
    const { version } = this.#owner.readCell(this.#index);
    if (version === this.#observedSharedVersion) return false;
    this.#observedSharedVersion = version;
    internalsOf(this.runtime).notify(this);
    return true;
  }

  isStale(): boolean {
    return this.#owner.readCell(this.#index).version !== this.#observedSharedVersion;
  }
}

/**
 * Fixed-layout, index-granular shared state for Workers. Each element owns a value/seq pair in the
 * SharedArrayBuffer, so changing one conversation slot does not invalidate readers of every other
 * slot.
 */
export class SharedInt32Array implements IDisposable {
  readonly runtime: IRuntime;
  readonly buffer: SharedArrayBuffer;
  readonly length: number;
  #view: Int32Array;
  #cells = new Map<number, SharedInt32ArrayCell>();
  #observedVersions: Int32Array;
  #observedEpoch: number;
  #bitmapWords: number;
  #disposed = false;
  #stopWatching?: IDisposer;

  constructor(
    runtime: IRuntime,
    length: number,
    options: {
      readonly buffer?: SharedArrayBuffer;
      readonly initialValues?: Iterable<number>;
    } = {}
  ) {
    if (options === null || typeof options !== 'object') {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.optionsObject
      );
    }
    let buffer: SharedArrayBuffer | undefined;
    let initialValues: Iterable<number> | undefined;
    try {
      buffer = options.buffer;
      initialValues = options.initialValues;
    } catch (error) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.optionsRead,
        { cause: error }
      );
    }
    if (buffer !== undefined && !(buffer instanceof SharedArrayBuffer)) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.bufferType
      );
    }
    if (!Number.isInteger(length) || length < 0) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.arrayLength
      );
    }
    let preparedInitialValues: number[] | undefined;
    if (!buffer && initialValues) {
      try {
        preparedInitialValues = [];
        for (const value of initialValues) {
          if (preparedInitialValues.length >= length) break;
          preparedInitialValues.push(asInt32(value, 'shared cell value'));
        }
      } catch (error) {
        throw createStoreSharedRangeError(
          StoreSharedErrorCode.invalidOption,
          StoreSharedErrorText.initialValuesInvalid,
          { cause: error }
        );
      }
    }
    this.runtime = runtime;
    this.length = length;
    this.#bitmapWords = dirtyBitmapWords(length);
    const headerSlots = ARRAY_HEADER_BASE_SLOTS + this.#bitmapWords;
    const slots = headerSlots + length * ARRAY_ENTRY_SLOTS;
    if (!Number.isSafeInteger(slots) || slots > MAX_INT32_ARRAY_SLOTS) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.arrayLengthTooLarge
      );
    }
    const requiredBytes = slots * Int32Array.BYTES_PER_ELEMENT;
    this.buffer = buffer ?? new SharedArrayBuffer(requiredBytes);
    if (this.buffer.byteLength < requiredBytes) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.bufferTooSmall,
        StoreSharedErrorText.arrayBufferSmall
      );
    }
    this.#view = new Int32Array(this.buffer, 0, slots);
    this.#observedVersions = new Int32Array(length);
    this.#observedEpoch = Atomics.load(this.#view, ARRAY_EPOCH_SLOT);
    if (preparedInitialValues) {
      for (let index = 0; index < preparedInitialValues.length; index++) {
        Atomics.store(this.#view, this.#valueSlot(index), preparedInitialValues[index]);
      }
    }
    // Do not scan every seqlock during construction. Cells establish their
    // own baseline when first observed, while array-level sync uses epoch to
    // decide whether a full scan is needed at all.
    claimOwnership(this, runtime);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get(index: number): number {
    this.#assertIndex(index);
    if (!internalsOf(this.runtime).tracker.isTracking()) {
      return this.readCell(index).value;
    }
    return this.#cell(index).read();
  }

  set(index: number, value: number): void {
    this.#assertIndex(index);
    const cell = this.#cells.get(index);
    if (cell) {
      cell.write(value);
      return;
    }
    const version = this.writeCell(index, asInt32(value, 'shared cell value'));
    if (version !== undefined) {
      this.#observedVersions[index] = version;
      this.notifyWaiters();
    }
  }

  /**
   * 读-改-写。
   *
   * 用户回调**在锁外**执行：持锁期间调用别人的代码，一旦它抛错就留下一把奇数的 死锁，之后所有读者都会自旋到上限然后抛。所以先一致读、锁外算、再带期望值写， 值被别人改掉就重来。 因此
   * `update` 回调必须纯且可重复执行；不要在回调中埋点、发请求或产生不可逆副作用。
   */
  update(index: number, update: (current: number) => number): number {
    this.#assertIndex(index);
    if (typeof update !== 'function') {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.invalidOption,
        StoreSharedErrorText.updateFunction
      );
    }
    const cell = this.#cells.get(index);
    for (let spins = 0; spins < SPIN_LIMIT; spins++) {
      this.assertActive();
      const { value: current } = this.readCell(index);
      const next = asInt32(update(current), 'shared cell value');
      if (current === next) return current;
      const version = this.writeCell(index, next, current);
      if (version !== undefined) {
        this.#observedVersions[index] = version;
        if (cell) cell.commitWrite(version);
        else this.notifyWaiters();
        return next;
      }
    }
    throw createStoreSharedError(
      StoreSharedErrorCode.contentionLimit,
      StoreSharedErrorText.arrayRace(index)
    );
  }

  /**
   * Scan for remote writes and notify only affected index observers.
   *
   * `watch()` 起了回路之后不必手动调；没有 waitAsync 的环境仍可从消息循环 pump。
   */
  sync(index?: number): number {
    this.assertActive();
    if (index !== undefined) {
      this.#assertIndex(index);
      const version = this.readCell(index).version;
      if (version === this.#observedVersions[index]) return 0;
      this.#observedVersions[index] = version;
      this.#cells.get(index)?.sync();
      return 1;
    }
    // Remote writers publish one array-level epoch for every completed write.
    // If it did not move, no cell can have changed and even a dirty-page scan
    // is unnecessary. A concurrent writer that increments after this load is
    // observed by the next sync call.
    const epoch = Atomics.load(this.#view, ARRAY_EPOCH_SLOT);
    if (epoch === this.#observedEpoch) return 0;
    let changed = 0;
    // 一次扫描算一次批处理：多格同时变化只惊动下游一轮。只走 bitmap 点亮的页，
    // 而不是整个数组——百万格数组里改一格不再是 O(length)。
    this.runtime.batch(() => {
      for (let word = 0; word < this.#bitmapWords; word++) {
        const bits = Atomics.exchange(this.#view, ARRAY_HEADER_BASE_SLOTS + word, 0);
        if (bits === 0) continue;
        for (let bit = 0; bit < DIRTY_BITS_PER_WORD; bit++) {
          if ((bits & (1 << bit)) === 0) continue;
          const page = word * DIRTY_BITS_PER_WORD + bit;
          const start = page * DIRTY_PAGE_SIZE;
          const end = Math.min(start + DIRTY_PAGE_SIZE, this.length);
          for (let current = start; current < end; current++) {
            const version = this.readCell(current).version;
            if (version === this.#observedVersions[current]) continue;
            this.#observedVersions[current] = version;
            this.#cells.get(current)?.sync();
            changed++;
          }
        }
      }
    });
    this.#observedEpoch = epoch;
    return changed;
  }

  /**
   * 起一条 waitAsync 回路覆盖整片。
   *
   * 等的是 epoch 而不是逐格的 seq：一格一个 waiter 在长数组上不可行。醒来后 `sync()` 扫描，只有真正变了的格会通知它自己的观察者。
   */
  watch(): IDisposer {
    this.assertActive();
    if (this.#stopWatching) return this.#stopWatching;
    const stop = watchSlot(
      this.#view,
      ARRAY_EPOCH_SLOT,
      () => {
        if (!this.#disposed) this.sync();
      },
      (error) => reportSharedWatchFailure(this.runtime, error)
    );
    const disposer = () => {
      stop();
      if (this.#stopWatching === disposer) this.#stopWatching = undefined;
    };
    this.#stopWatching = disposer;
    return disposer;
  }

  snapshot(): Int32Array {
    this.assertActive();
    const result = new Int32Array(this.length);
    for (let index = 0; index < this.length; index++) {
      result[index] = this.readCell(index).value;
    }
    return result;
  }

  /** Release cells that no longer have observers after high-churn access. */
  prune(): number {
    this.assertActive();
    let removed = 0;
    for (const [index, cell] of this.#cells) {
      if (cell.subs.size !== 0) continue;
      internalsOf(this.runtime).tracker.disconnectObservable(cell, 'dispose');
      this.#cells.delete(index);
      removed++;
    }
    return removed;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopWatching?.();
    for (const cell of this.#cells.values()) {
      internalsOf(this.runtime).tracker.disconnectObservable(cell, 'dispose');
    }
  }

  assertActive(): void {
    if (this.#disposed) {
      throw createStoreSharedError(
        StoreSharedErrorCode.arrayDisposed,
        StoreSharedErrorText.arrayDisposed
      );
    }
  }

  /** 一致读某一格：value 与 version 同源。 */
  readCell(index: number): {
    readonly value: number;
    readonly version: number;
  } {
    return readConsistent(this.#view, this.#valueSlot(index), this.#seqSlot(index));
  }

  /** 写某一格；返回新版本，或 undefined 表示没写（值未变或期望值不符）。 */
  writeCell(index: number, value: number, expected?: number): number | undefined {
    const version = writeLocked(
      this.#view,
      this.#valueSlot(index),
      this.#seqSlot(index),
      value,
      expected
    );
    if (version !== undefined) this.#markDirty(index);
    return version;
  }

  /** 推进 epoch 并唤醒远端 watcher。 */
  notifyWaiters(): void {
    this.#observedEpoch = Atomics.add(this.#view, ARRAY_EPOCH_SLOT, 1) + 1;
    Atomics.notify(this.#view, ARRAY_EPOCH_SLOT);
  }

  /** Keep array-level pull bookkeeping aligned with local cell writes. */
  recordObservedVersion(index: number, version: number): void {
    this.#observedVersions[index] = version;
  }

  #cell(index: number): SharedInt32ArrayCell {
    this.#assertIndex(index);
    let cell = this.#cells.get(index);
    if (!cell) {
      cell = new SharedInt32ArrayCell(this, index);
      this.#cells.set(index, cell);
      const created = cell;
      // React/Computed may abandon a speculative read before committing an
      // observer. Reclaim that cell instead of retaining it until array dispose.
      queueMicrotask(() => {
        if (this.#disposed || created.subs.size !== 0) return;
        internalsOf(this.runtime).tracker.disconnectObservable(created, 'dispose');
        if (this.#cells.get(index) === created) this.#cells.delete(index);
      });
    }
    return cell;
  }

  #assertIndex(index: number): void {
    this.assertActive();
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw createStoreSharedRangeError(
        StoreSharedErrorCode.indexOutOfRange,
        StoreSharedErrorText.arrayIndex(index)
      );
    }
  }

  get #headerSlots(): number {
    return ARRAY_HEADER_BASE_SLOTS + this.#bitmapWords;
  }

  #valueSlot(index: number): number {
    return this.#headerSlots + index * ARRAY_ENTRY_SLOTS + ARRAY_VALUE_OFFSET;
  }

  #seqSlot(index: number): number {
    return this.#headerSlots + index * ARRAY_ENTRY_SLOTS + ARRAY_SEQ_OFFSET;
  }

  /** Lossless: concurrent `Atomics.or` calls from other writers never clobber each other's bit. */
  #markDirty(index: number): void {
    const page = (index / DIRTY_PAGE_SIZE) | 0;
    const word = (page / DIRTY_BITS_PER_WORD) | 0;
    const bit = page % DIRTY_BITS_PER_WORD;
    Atomics.or(this.#view, ARRAY_HEADER_BASE_SLOTS + word, 1 << bit);
  }
}

export const sharedInt32Array = (
  runtime: IRuntime,
  length: number,
  options?: {
    readonly buffer?: SharedArrayBuffer;
    readonly initialValues?: Iterable<number>;
  }
): SharedInt32Array => new SharedInt32Array(runtime, length, options);
