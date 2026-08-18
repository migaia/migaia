import type { IDisposable, IObservable, IObserver, IRuntime } from '../runtime/types.js';
import type { ICapture } from '../runtime/dependency-tracker.class.js';
import { internalsOf } from '../runtime/internals.js';
import { claimOwnership } from '../runtime/ownership.js';
import { createObserverRunTrace, describeObserver } from '../runtime/diagnostics.js';
import { registerSubs } from '../runtime/node-internals.js';
import { registerDeps, registerDepVersions } from '../runtime/node-internals.js';
import { createReactiveError } from '../errors.js';
import { ReactiveErrorCode } from '../error-code.js';
import { ReactiveErrorPhase } from '../runtime/trace-constants.js';
import { ReactiveErrorText } from '../error-text.js';

export type IComputedOptions<T> = {
  equals?: (a: T, b: T) => boolean;
  keepAlive?: boolean;
  debugName?: string;
};
export type IComputedConfig<T> = IComputedOptions<T> | ((a: T, b: T) => boolean);

// 惰性派生：写只标脏(push)，值只在被读时重算(pull)——没被订阅的 Computed 永不算
export class Computed<T> implements IObservable, IObserver, IDisposable {
  #subs = new Set<IObserver>();
  readonly subs: ReadonlySet<IObserver>;
  #deps = new Set<IObservable>();
  #depVersions = new Map<IObservable, number>();
  readonly deps: ReadonlySet<IObservable>;
  readonly depVersions: ReadonlyMap<IObservable, number>;
  #version = 0;
  get version(): number {
    return this.#version;
  }
  readonly runtime: IRuntime;
  debugName?: string;
  #value!: T;
  #dirty = true;
  #computing = false; // 循环自依赖保护：a→b→a 会在此触发可读错误而非栈溢出
  #disposed = false;
  #fn: () => T;
  #equals: (a: T, b: T) => boolean;
  #keepAlive: boolean;
  #suspensionGeneration = 0;
  #previewVersion = -1;
  #previewValue!: T;
  #previewDirty = true;
  #dirtyEpoch = 0;
  #previewEpoch = -1;
  #previewCapture?: ICapture<T>;
  constructor(fn: () => T, runtime: IRuntime, config: IComputedConfig<T> = {}) {
    this.subs = registerSubs(this, this.#subs);
    this.deps = registerDeps(this, this.#deps);
    this.depVersions = registerDepVersions(this, this.#depVersions);
    const options = typeof config === 'function' ? { equals: config } : config;
    this.#fn = fn;
    this.runtime = runtime;
    // 归属登记走唯一那张表，不再靠字段名让下游去猜
    claimOwnership(this, runtime);
    this.debugName = options.debugName;
    this.#equals = options.equals ?? Object.is;
    this.#keepAlive = options.keepAlive ?? false;
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  get observed(): boolean {
    return !this.#disposed && this.subs.size > 0;
  }
  // 释放：断开对上游的全部依赖边（不再被上游通知）+ 清空下游集合。
  // 读取已释放的 Computed 会抛错——绝不静默返回旧缓存，避免「看着能用但永不更新」的幽灵状态。
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#previewVersion = -1;
    this.#previewDirty = true;
    this.#previewValue = undefined as T;
    this.#previewCapture = undefined;
    internalsOf(this.runtime).tracker.clearDependencies(this); // 退订上游 + 清 deps/depVersions
    internalsOf(this.runtime).tracker.disconnectObservable(this, 'dispose');
  }
  markDirty(): void {
    this.#dirtyEpoch++;
    this.#previewDirty = true;
    if (this.#dirty) return; // 幂等 → diamond 去重
    this.#dirty = true;
    for (const s of Array.from(this.subs)) s.markDirty(); // 向下游传播「可能脏」
  }
  isStale(): boolean {
    return this.#dirty;
  }
  onObserved(): void {
    this.#suspensionGeneration++;
  }
  onUnobserved(): void {
    this.#suspend();
  }
  onDependencyDisconnected(): void {
    this.markDirty();
  }
  get value(): T {
    internalsOf(this.runtime).tracker.track(this); // computed 亦可被订阅
    this.pull();
    return this.#value;
  }
  peek(): T {
    this.pull();
    return this.#value;
  }
  /**
   * Evaluate a speculative snapshot without publishing a cache or dependency edges. React may
   * abandon getSnapshot renders; those reads must not warm a Computed that was never committed. A
   * committed subscription still uses `value`/`peek` and receives the normal cached reactive path.
   */
  preview(): T {
    if (this.#disposed)
      throw createReactiveError(ReactiveErrorCode.nodeDisposed, ReactiveErrorText.disposedComputed);
    const version = this.runtime.currentVersion();
    if (
      this.#previewVersion === version &&
      this.#previewEpoch === this.#dirtyEpoch &&
      !this.#previewDirty
    )
      return this.#previewValue;
    if (this.#computing)
      throw createReactiveError(
        ReactiveErrorCode.circularDependency,
        ReactiveErrorText.circularComputedDependency
      );
    this.#computing = true;
    let capture: ICapture<T>;
    try {
      capture = internalsOf(this.runtime).tracker.capture(this.#fn);
    } finally {
      this.#computing = false;
    }
    const value = capture.result;
    const baseline = this.#version > 0 ? this.#value : this.#previewValue;
    const hasBaseline = this.#version > 0 || this.#previewVersion >= 0;
    const changed = !hasBaseline || !this.#equals(value, baseline);
    // A speculative read must share the committed identity whenever equals
    // says the value is unchanged; otherwise React and imperative consumers
    // observe two equivalent but distinct objects.
    this.#previewValue = changed ? value : baseline;
    this.#previewVersion = version;
    this.#previewEpoch = this.#dirtyEpoch;
    this.#previewDirty = false;
    this.#previewCapture = capture;
    return this.#previewValue;
  }
  pull(): void {
    // 所有读取路径（value/peek/上游 hasStaleDependencies 的 dep.pull）都经过 pull，在此统一拦截已释放读取
    if (this.#disposed)
      throw createReactiveError(ReactiveErrorCode.nodeDisposed, ReactiveErrorText.disposedComputed);
    if (!this.#dirty) return;
    const runtime = internalsOf(this.runtime);
    const capture = this.#previewCapture;
    if (
      capture &&
      this.#previewVersion === this.runtime.currentVersion() &&
      this.#previewEpoch === this.#dirtyEpoch &&
      !this.#previewDirty &&
      runtime.tracker.commitCapture(this, capture)
    ) {
      const next = this.#previewValue;
      const changed = this.#version === 0 || !this.#equals(next, this.#value);
      if (changed) {
        const nextVersion = runtime.clock.next();
        this.#value = next;
        this.#version = nextVersion;
      }
      this.#previewCapture = undefined;
      this.#dirty = false;
      this.#scheduleSuspension();
      return;
    }
    this.#previewCapture = undefined;
    this.#recompute();
  } // 惰性落定版本
  #recompute(): void {
    if (this.#computing) {
      // 求值过程中又读到了自己：环。给出可理解的响应式错误，而不是让引擎栈溢出。
      throw createReactiveError(
        ReactiveErrorCode.circularDependency,
        ReactiveErrorText.circularComputedDependency
      );
    }
    this.#computing = true;
    const runtime = internalsOf(this.runtime);
    const tracing = runtime.traceEnabled();
    const trace = tracing
      ? createObserverRunTrace(describeObserver(this), {
          now: runtime.now,
          timestamp: runtime.timestamp,
          emitTrace: runtime.emitTrace,
          reportError: (error) =>
            this.runtime.reportError(error, {
              phase: ReactiveErrorPhase.traceListener,
              observer: this
            })
        })
      : undefined;
    trace?.start();
    let next: T;
    try {
      next = runtime.tracker.runTracked(this, this.#fn); // pull：仅此刻重算
      // equals 自定义比较可能抛错——若在 dirty 落定前抛出，dirty 必须保持 true，否则下次读会返回旧值永不重算
      const changed = this.version === 0 || !this.#equals(next, this.#value);
      if (changed) {
        // 与 Signal 一样先领取版本；耗尽时不能先改缓存再失败。
        const nextVersion = runtime.clock.next();
        this.#value = next;
        this.#version = nextVersion;
      }
    } catch (error) {
      trace?.error(error);
      throw error;
    } finally {
      this.#computing = false;
    }
    this.#dirty = false; // 仅在完全成功后才落定 dirty
    trace?.end();
    this.#scheduleSuspension();
  }
  #scheduleSuspension(): void {
    if (this.#keepAlive || this.subs.size > 0) return;
    const generation = ++this.#suspensionGeneration;
    // 走 runtime 的 idle 通道而不是裸 queueMicrotask：写死之后这条回收路径不受
    // 任何配置控制。刻意不复用 flush 策略——同步 flush 是合法配置，若共用，
    // 一次读完就立刻断上游边，同 tick 内第二次读会白算一遍。
    internalsOf(this.runtime).deferIdle(() => {
      if (generation === this.#suspensionGeneration && this.subs.size === 0) {
        this.#suspend();
      }
    });
  }
  #suspend(): void {
    if (this.#keepAlive || this.#disposed || this.subs.size > 0) return;
    this.#suspensionGeneration++;
    internalsOf(this.runtime).tracker.clearDependencies(this);
    this.#dirty = true;
  }
}
