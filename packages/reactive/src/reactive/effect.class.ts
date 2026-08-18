import type {
  IDisposable,
  IDisposer,
  IObservable,
  IObserver,
  IReactiveNodeOptions,
  IRuntime
} from '../runtime/types.js';
import { internalsOf } from '../runtime/internals.js';
import { claimOwnership } from '../runtime/ownership.js';
import { createObserverRunTrace, describeObserver } from '../runtime/diagnostics.js';
import { registerDeps, registerDepVersions } from '../runtime/node-internals.js';
import { ReactiveErrorPhase } from '../runtime/trace-constants.js';

// 副作用：唯一真正"被执行"的观察者——Computed 只标脏不重跑，只有 Effect 会被调度器实际 tick
export class Effect implements IObserver, IDisposable {
  #deps = new Set<IObservable>();
  #depVersions = new Map<IObservable, number>();
  readonly deps: ReadonlySet<IObservable>;
  readonly depVersions: ReadonlyMap<IObservable, number>;
  readonly runtime: IRuntime;
  debugName?: string;
  #cleanup: void | IDisposer = undefined;
  #disposed = false;
  #fn: () => void | IDisposer;
  #forceRun = false;
  constructor(fn: () => void | IDisposer, runtime: IRuntime, options: IReactiveNodeOptions = {}) {
    this.deps = registerDeps(this, this.#deps);
    this.depVersions = registerDepVersions(this, this.#depVersions);
    this.#fn = fn;
    this.runtime = runtime;
    // 归属登记走唯一那张表，不再靠字段名让下游去猜
    claimOwnership(this, runtime);
    this.debugName = options.debugName;
    this.run();
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  markDirty(): void {
    internalsOf(this.runtime).scheduler.enqueue(this);
  }
  tick(): void {
    // 冲刷时调用：仅当依赖真变才重跑
    if (this.#disposed) return;
    if (this.#forceRun) {
      this.#forceRun = false;
      this.run();
      return;
    }
    if (internalsOf(this.runtime).tracker.hasStaleDependencies(this)) this.run();
  }
  onDependencyDisconnected(): void {
    this.#forceRun = true;
    internalsOf(this.runtime).scheduler.enqueue(this);
  }
  /**
   * Runs cleanup and the effect body as one terminal-aware transaction. Cleanup may synchronously
   * dispose this effect; that terminal transition must prevent both a rerun and dependency commit.
   */
  run(): void {
    if (this.#disposed) return;
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
    // 先摘掉旧 cleanup 再执行：否则若新 fn 抛错，赋值右侧未完成，this.cleanup 仍指向旧 cleanup，
    // 下次重跑/dispose 会重复执行旧 cleanup（重复 removeEventListener/释放资源/引用计数变负）。
    const previousCleanup = this.#cleanup;
    this.#cleanup = undefined;
    try {
      if (typeof previousCleanup === 'function') {
        this.runtime.untracked(previousCleanup); // cleanup 执行期间不建立依赖
      }
      if (this.#disposed) return;
      /** Candidate cleanup returned by the current body; terminal effects must consume it locally. */
      const nextCleanup = runtime.tracker.runTracked(this, this.#fn);
      if (this.#disposed) {
        if (typeof nextCleanup === 'function') this.runtime.untracked(nextCleanup);
        return;
      }
      this.#cleanup = nextCleanup;
    } catch (error) {
      trace?.error(error);
      throw error;
    } finally {
      trace?.end();
    }
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    internalsOf(this.runtime).tracker.clearDependencies(this);
    const previousCleanup = this.#cleanup;
    this.#cleanup = undefined;
    if (typeof previousCleanup === 'function') this.runtime.untracked(previousCleanup);
    internalsOf(this.runtime).scheduler.dequeue(this);
  }
}
