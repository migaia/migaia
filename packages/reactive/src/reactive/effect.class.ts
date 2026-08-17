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
import { describeObserver } from '../runtime/diagnostics.js';
import { registerDeps, registerDepVersions } from '../runtime/node-internals.js';
import { ReactiveTracePhase, ReactiveTraceType } from '../runtime/trace-constants.js';

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
  run(): void {
    if (this.#disposed) return;
    const runtime = internalsOf(this.runtime);
    const tracing = runtime.traceEnabled();
    const startedAt = tracing ? runtime.now() : 0;
    if (tracing) {
      runtime.emitTrace({
        type: ReactiveTraceType.observerRun,
        timestamp: runtime.timestamp(),
        phase: ReactiveTracePhase.start,
        observer: describeObserver(this)
      });
    }
    // 先摘掉旧 cleanup 再执行：否则若新 fn 抛错，赋值右侧未完成，this.cleanup 仍指向旧 cleanup，
    // 下次重跑/dispose 会重复执行旧 cleanup（重复 removeEventListener/释放资源/引用计数变负）。
    const previousCleanup = this.#cleanup;
    this.#cleanup = undefined;
    try {
      if (typeof previousCleanup === 'function') {
        this.runtime.untracked(previousCleanup); // cleanup 执行期间不建立依赖
      }
      this.#cleanup = runtime.tracker.runTracked(this, this.#fn);
    } catch (error) {
      if (tracing) {
        runtime.emitTrace({
          type: ReactiveTraceType.observerRun,
          timestamp: runtime.timestamp(),
          phase: ReactiveTracePhase.error,
          observer: describeObserver(this),
          durationMs: runtime.now() - startedAt,
          error
        });
      }
      throw error;
    }
    if (tracing) {
      runtime.emitTrace({
        type: ReactiveTraceType.observerRun,
        timestamp: runtime.timestamp(),
        phase: ReactiveTracePhase.end,
        observer: describeObserver(this),
        durationMs: runtime.now() - startedAt
      });
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
