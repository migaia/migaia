import type { IObservable, IObserver, IRuntime } from './types';
import { internalsOf } from './internals';
import { assertReactiveOwnedBy } from './ownership';
import { describeObservable, describeObserver } from './diagnostics';
import {
  mutableSubs as mutableNodeSubs,
  mutableDeps as mutableNodeDeps,
  mutableDepVersions as mutableNodeVersions
} from './node-internals';

function mutableSubs(observable: IObservable): Set<IObserver> {
  return mutableNodeSubs(observable, observable.subs);
}

// 一次追踪的临时帧：fn 执行期间读到的依赖先攒在 nextDeps，不碰正式依赖边。
type TrackingFrame =
  | { kind: 'observer'; observer: IObserver; nextDeps: Set<IObservable> }
  | { kind: 'capture'; nextDeps: Set<IObservable> };

// Capture 的依赖与 Tracker 身份只存在于私有 WeakMap；调用者只能读取结果并交回整个 token。
declare const CAPTURE_TOKEN: unique symbol;
export type ICapture<R> = {
  readonly result: R;
  readonly [CAPTURE_TOKEN]: true;
};

type ICaptureState = {
  dependencies: Map<
    IObservable,
    {
      readonly version: number;
      readonly topologyToken: object | undefined;
    }
  >;
};

// 全局「当前正在追踪的 tracker」——单线程 JS 里同一时刻只有一个求值在进行，用它跨 tracker 检测跨 runtime 依赖。
// track() 被派发到「被读节点所属 runtime 的 tracker」上；若那个 tracker 不是当前活跃 tracker，
// 且当前活跃 tracker 确实在追踪（有 observer），说明是跨 runtime 读取——立即抛错，杜绝静默陈旧数据。
let activeTracker: DependencyTracker | null = null;

// 集中管理模块级同步追踪上下文，避免各方法直接写全局槽位。
function swapActiveTracker(next: DependencyTracker): DependencyTracker | null {
  const previous = activeTracker;
  activeTracker = next;
  return previous;
}

// 依赖追踪上下文（每个 Runtime 一个）：谁在被求值、依赖边的暂存/提交/断开/脏检查。
// 事务化：runTracked 期间 track() 只暂存到 nextDeps；成功才 commit 差异，失败直接丢弃、旧图不动。
export class DependencyTracker {
  #stack: (TrackingFrame | null)[] = [];
  #captures = new WeakMap<object, ICaptureState>();
  /**
   * Terminal invalidation is deliberately independent from VersionClock.
   *
   * Exhausting the monotonic clock must stop future writes, but it must never prevent graph
   * cleanup. A WeakSet also lets a render captured before disposal fail validation without
   * consuming another global version.
   */
  #terminalObservables = new WeakSet<IObservable>();
  /**
   * Dependency-edge invalidation is topology, not value state. An opaque identity avoids consuming
   * VersionClock and has no numeric exhaustion.
   */
  #topologyTokens = new WeakMap<IObservable, object>();
  #runtime: IRuntime;

  constructor(runtime: IRuntime) {
    this.#runtime = runtime;
  }

  get #top(): TrackingFrame | null {
    return this.#stack.length ? this.#stack[this.#stack.length - 1] : null;
  }

  #hasActiveObserver(): boolean {
    return this.#top !== null;
  }

  /** Whether this tracker is currently collecting dependencies. */
  isTracking(): boolean {
    return activeTracker === this && this.#top !== null;
  }

  /** Whether any Runtime is currently collecting a dependency frame. */
  static isAnyTracking(): boolean {
    return activeTracker !== null && activeTracker.#hasActiveObserver();
  }

  /** 记一条依赖——只暂存到当前帧；跨 runtime 读取立即抛错 */
  track(observable: IObservable): void {
    this.#assertObservableOwner(observable);
    if (activeTracker === this) {
      this.#top?.nextDeps.add(observable);
      return;
    }
    // 派发到的是本 observable 所属 runtime 的 tracker；若它不是当前活跃 tracker 而别处正在追踪 → 跨 runtime
    if (activeTracker !== null && activeTracker.#hasActiveObserver()) {
      throw new Error(
        '[store] cross-runtime dependency is not allowed: a node was read while a node from another runtime was being tracked'
      );
    }
    // 无人追踪（或对方处于 untracked）→ 无依赖可建，静默跳过
  }

  /** 断开某 observer 的全部依赖边——仅供 dispose 用 */
  clearDependencies(observer: IObserver): void {
    for (const dep of observer.deps) this.#unsubscribe(dep, observer);
    mutableNodeDeps(observer, observer.deps).clear();
    mutableNodeVersions(observer, observer.depVersions).clear();
  }

  /**
   * 原子删除 Observable 的全部反向边，再通知下游失效。
   *
   * `invalidate` 用于仍可继续使用的节点（例如 Atom override）；`dispose` 是终态。 两者都更换独立的 topology token 使在途 capture
   * 过期，不消耗全局值版本， 因此在 VersionClock 已耗尽时仍能完整释放或撤销路由。
   */
  disconnectObservable(observable: IObservable, reason: 'invalidate' | 'dispose'): void {
    this.#assertObservableOwner(observable);
    const runtime = internalsOf(this.#runtime);
    this.#topologyTokens.set(observable, {});
    if (reason === 'dispose') {
      this.#terminalObservables.add(observable);
    }
    const observers = [...observable.subs];
    mutableSubs(observable).clear();
    for (const observer of observers) {
      mutableNodeDeps(observer, observer.deps).delete(observable);
      mutableNodeVersions(observer, observer.depVersions).delete(observable);
      if (runtime.traceEnabled()) {
        runtime.emitTrace({
          type: 'dependency',
          timestamp: Date.now(),
          phase: 'disconnect',
          observable: describeObservable(observable),
          observer: describeObserver(observer),
          reason
        });
      }
    }
    for (const observer of observers) {
      try {
        observer.onDependencyDisconnected(observable);
      } catch (error) {
        observer.runtime.reportError(error, {
          phase: 'dependency-disconnect',
          observer: describeObserver(observer),
          observable: describeObservable(observable)
        });
      }
    }
  }

  /** 事务化重算：成功才 commit 差异，失败丢弃临时集合。 */
  runTracked<R>(observer: IObserver, fn: () => R): R {
    const frame: TrackingFrame = {
      kind: 'observer',
      observer,
      nextDeps: new Set()
    };
    this.#stack.push(frame);
    const prevTracker = swapActiveTracker(this);
    try {
      const result = fn();
      this.#commit(observer, frame.nextDeps);
      return result;
    } finally {
      this.#stack.pop();
      activeTracker = prevTracker;
    }
  }

  /** Render 阶段只采集依赖与版本，不修改正式订阅边。调用方可在提交阶段交回 token，因而被 Concurrent React 丢弃的 render 不会泄漏订阅。 */
  capture<R>(fn: () => R): ICapture<R> {
    const frame: TrackingFrame = {
      kind: 'capture',
      nextDeps: new Set()
    };
    this.#stack.push(frame);
    const prevTracker = swapActiveTracker(this);
    try {
      const result = fn();
      const dependencies: ICaptureState['dependencies'] = new Map();
      for (const dep of frame.nextDeps) {
        dependencies.set(dep, {
          version: dep.version,
          topologyToken: this.#topologyTokens.get(dep)
        });
      }
      const capture = { result } as ICapture<R>;
      this.#captures.set(capture, { dependencies });
      return capture;
    } finally {
      this.#stack.pop();
      activeTracker = prevTracker;
    }
  }

  /** 原子验证并提交一次 capture。返回 false 表示捕获后依赖已变化，调用方必须重新求值； token 单次使用，且 observer 必须属于当前 Tracker。 */
  commitCapture(observer: IObserver, capture: ICapture<unknown>): boolean {
    if (internalsOf(observer.runtime).tracker !== this) {
      throw new Error('[store] cannot commit a capture to an observer from another runtime');
    }
    // A Concurrent render may finish after its committed observer was
    // disposed. Reject before consuming the token so a replacement observer
    // can still validate and commit the same capture.
    if (observer.disposed) {
      throw new Error('[store] cannot commit a capture to a disposed observer');
    }
    const state = this.#captures.get(capture);
    if (!state) {
      throw new Error(
        '[store] capture is invalid, already consumed, or belongs to another tracker'
      );
    }
    this.#captures.delete(capture);
    for (const [dep, recorded] of state.dependencies) {
      if (
        this.#terminalObservables.has(dep) ||
        this.#topologyTokens.get(dep) !== recorded.topologyToken ||
        dep.isStale?.() ||
        dep.version !== recorded.version
      ) {
        return false;
      }
    }
    this.#commit(observer, new Set(state.dependencies.keys()));
    return true;
  }

  #commit(observer: IObserver, nextDeps: Set<IObservable>): void {
    const prevDeps = observer.deps;
    for (const dep of prevDeps) {
      if (!nextDeps.has(dep)) this.#unsubscribe(dep, observer);
    }
    for (const dep of nextDeps) {
      if (!prevDeps.has(dep)) this.#subscribe(dep, observer);
    }
    const mutableDeps = mutableNodeDeps(observer, observer.deps);
    mutableDeps.clear();
    for (const dep of nextDeps) mutableDeps.add(dep);
    const versions = new Map<IObservable, number>();
    for (const dep of nextDeps) versions.set(dep, dep.version);
    const mutableVersions = mutableNodeVersions(observer, observer.depVersions);
    mutableVersions.clear();
    for (const [dep, version] of versions) mutableVersions.set(dep, version);
  }

  #subscribe(observable: IObservable, observer: IObserver): void {
    this.#assertObservableOwner(observable);
    assertReactiveOwnedBy(observer, this.#runtime, 'observer');
    const runtime = internalsOf(this.#runtime);
    const wasUnobserved = observable.subs.size === 0;
    mutableSubs(observable).add(observer);
    if (wasUnobserved) {
      try {
        observable.onObserved?.();
      } catch (error) {
        observer.runtime.reportError(error, {
          phase: 'lifecycle-hook',
          observer: describeObserver(observer),
          observable: describeObservable(observable)
        });
      }
    }
    if (runtime.traceEnabled()) {
      runtime.emitTrace({
        type: 'dependency',
        timestamp: Date.now(),
        phase: 'connect',
        observable: describeObservable(observable),
        observer: describeObserver(observer)
      });
    }
  }

  #unsubscribe(observable: IObservable, observer: IObserver): void {
    this.#assertObservableOwner(observable);
    if (!mutableSubs(observable).delete(observer)) return;
    const runtime = internalsOf(this.#runtime);
    if (runtime.traceEnabled()) {
      runtime.emitTrace({
        type: 'dependency',
        timestamp: Date.now(),
        phase: 'disconnect',
        observable: describeObservable(observable),
        observer: describeObserver(observer),
        reason: 'retrack'
      });
    }
    if (observable.subs.size === 0) {
      try {
        observable.onUnobserved?.();
      } catch (error) {
        observer.runtime.reportError(error, {
          phase: 'lifecycle-hook',
          observer: describeObserver(observer),
          observable: describeObservable(observable)
        });
      }
    }
  }

  #assertObservableOwner(observable: IObservable): void {
    assertReactiveOwnedBy(observable, this.#runtime, 'observable');
  }

  /** 在 fn 执行期间关闭依赖收集——action 内读取、cleanup 回调等场景用 */
  untracked<R>(fn: () => R): R {
    this.#stack.push(null);
    const prevTracker = swapActiveTracker(this);
    try {
      return fn();
    } finally {
      this.#stack.pop();
      activeTracker = prevTracker;
    }
  }

  /** 依赖是否真的变了（先惰性 pull 使版本落定再比较） */
  hasStaleDependencies(observer: IObserver): boolean {
    for (const [dep, recordedVersion] of observer.depVersions) {
      dep.pull?.();
      if (dep.version !== recordedVersion) return true;
    }
    return false;
  }
}
