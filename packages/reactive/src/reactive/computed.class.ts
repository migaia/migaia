import type { IDisposable, IObservable, IObserver, IRuntime } from '../runtime/types.js'
import { markSubscribers, type ICapture } from '../runtime/dependency-tracker.class.js'
import { internalsOf, type IRuntimeInternals } from '../runtime/internals.js'
import { claimOwnership } from '../runtime/ownership.js'
import { createObserverRunTrace, describeObserver } from '../runtime/diagnostics.js'
import { registerSubs } from '../runtime/node-internals.js'
import { registerDeps, registerDepVersions } from '../runtime/node-internals.js'
import { createReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorPhase } from '../runtime/trace-constants.js'
import { ReactiveErrorText } from '../error-text.js'

/**
 * Options of `runtime.computed`: `equals` (default `Object.is`) decides whether a new value counts
 * as a change; `keepAlive: true` keeps computing without readers; `debugName` labels traces.
 */
export type IComputedOptions<T> = {
  equals?: (a: T, b: T) => boolean
  keepAlive?: boolean
  debugName?: string
}
/** Second argument of `runtime.computed`: the options object or just an `equals` function. */
export type IComputedConfig<T> = IComputedOptions<T> | ((a: T, b: T) => boolean)

// Lazy derivation: writes mark dirty (push), and reads recompute the value when needed (pull).
export class Computed<T> implements IObservable, IObserver, IDisposable {
  #subs = new Set<IObserver>()
  readonly subs: ReadonlySet<IObserver>
  #deps = new Set<IObservable>()
  #depVersions = new Map<IObservable, number>()
  readonly deps: ReadonlySet<IObservable>
  readonly depVersions: ReadonlyMap<IObservable, number>
  #version = 0
  get version(): number {
    return this.#version
  }
  readonly runtime: IRuntime
  /** Immutable kernel services captured once from this node's owning Runtime. */
  readonly #internals: IRuntimeInternals
  debugName?: string
  #value!: T
  #dirty = true
  /**
   * Whether the next dirty pull must run `fn` instead of trusting the recorded dependency versions.
   * True before the first successful evaluation, after a dependency was disconnected, and after a
   * failed evaluation, so an error is retried on every read until an evaluation succeeds.
   */
  #mustRecompute = true
  #computing = false // 循环自依赖保护：a→b→a 会在此触发可读错误而非栈溢出
  #disposed = false
  #fn: () => T
  #equals: (a: T, b: T) => boolean
  #keepAlive: boolean
  #suspensionGeneration = 0
  #previewVersion = -1
  #previewValue!: T
  #previewDirty = true
  #dirtyEpoch = 0
  #previewEpoch = -1
  #previewCapture?: ICapture<T>
  constructor(fn: () => T, runtime: IRuntime, config: IComputedConfig<T> = {}) {
    this.subs = registerSubs(this, this.#subs)
    this.deps = registerDeps(this, this.#deps)
    this.depVersions = registerDepVersions(this, this.#depVersions)
    const options = typeof config === 'function' ? { equals: config } : config
    this.#fn = fn
    this.runtime = runtime
    // 归属登记走唯一那张表，不再靠字段名让下游去猜
    claimOwnership(this, runtime)
    this.debugName = options.debugName
    this.#equals = options.equals ?? Object.is
    this.#keepAlive = options.keepAlive ?? false
    this.#internals = internalsOf(runtime)
  }
  get disposed(): boolean {
    return this.#disposed
  }
  get observed(): boolean {
    return !this.#disposed && this.#subs.size > 0
  }
  // Disposal removes all upstream dependency edges and clears downstream subscribers.
  // Reading a disposed `Computed` throws instead of returning a stale cache that no longer updates.
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#previewVersion = -1
    this.#previewDirty = true
    this.#previewValue = undefined as T
    this.#previewCapture = undefined
    this.#internals.tracker.clearDependencies(this) // 退订上游 + 清 deps/depVersions
    this.#internals.tracker.disconnectObservable(this, 'dispose')
  }
  markDirty(): void {
    this.#dirtyEpoch++
    this.#previewDirty = true
    if (this.#dirty) return // 幂等 → diamond 去重
    this.#dirty = true
    markSubscribers(this)
  }
  isStale(): boolean {
    return this.#dirty
  }
  onObserved(): void {
    this.#suspensionGeneration++
  }
  onUnobserved(): void {
    this.#suspend()
  }
  onDependencyDisconnected(): void {
    // The disconnected dependency is gone from `depVersions`; only `fn` can tell what replaces it.
    this.#mustRecompute = true
    this.markDirty()
  }
  get value(): T {
    this.#internals.tracker.track(this) // computed 亦可被订阅
    if (this.#internals.tracker.isCapturing()) {
      if (!this.#dirty) return this.#value
      /** Render evaluates only the existing preview; graph/cache publication belongs to commit. */
      const value = this.preview()
      /** Retain this exact derivation token and result rather than re-running user code later. */
      const capture = this.#previewCapture
      if (capture)
        this.#internals.tracker.stageDerivation(
          this,
          capture,
          () => this.#acceptPreview(value),
          () => this.#scheduleSuspension()
        )
      return value
    }
    this.pull()
    return this.#value
  }
  peek(): T {
    if (this.#internals.tracker.isCapturing()) return this.preview()
    this.pull()
    return this.#value
  }
  /** Publishes an already-validated render result without invoking the derivation or comparer. */
  #acceptPreview(value: T): void {
    /** Preview() retains the committed identity whenever the configured comparer says equal. */
    const changed = this.#version === 0 || !Object.is(value, this.#value)
    /** Reserve a version before publishing the corresponding cached value. */
    const version = changed ? this.#internals.clock.next() : this.#version
    this.#value = value
    this.#version = version
    this.#previewCapture = undefined
    this.#mustRecompute = false
    this.#dirty = false
  }
  /**
   * Evaluate a speculative snapshot without publishing a cache or dependency edges. React may
   * abandon getSnapshot renders; those reads must not warm a Computed that was never committed. A
   * committed subscription still uses `value`/`peek` and receives the normal cached reactive path.
   */
  preview(): T {
    if (this.#disposed)
      throw createReactiveError(ReactiveErrorCode.nodeDisposed, ReactiveErrorText.disposedComputed)
    const version = this.#internals.clock.current()
    if (
      this.#previewVersion === version &&
      this.#previewEpoch === this.#dirtyEpoch &&
      !this.#previewDirty
    )
      return this.#previewValue
    if (this.#computing)
      throw createReactiveError(
        ReactiveErrorCode.circularDependency,
        ReactiveErrorText.circularComputedDependency
      )
    this.#computing = true
    let capture: ICapture<T>
    try {
      capture = this.#internals.tracker.capture(this.#fn)
    } finally {
      this.#computing = false
    }
    const value = capture.result
    const baseline = this.#version > 0 ? this.#value : this.#previewValue
    const hasBaseline = this.#version > 0 || this.#previewVersion >= 0
    const changed = !hasBaseline || !this.#equals(value, baseline)
    // A speculative read must share the committed identity whenever equals
    // says the value is unchanged; otherwise React and imperative consumers
    // observe two equivalent but distinct objects.
    this.#previewValue = changed ? value : baseline
    this.#previewVersion = version
    this.#previewEpoch = this.#dirtyEpoch
    this.#previewDirty = false
    this.#previewCapture = capture
    return this.#previewValue
  }
  pull(): void {
    // 所有读取路径（value/peek/上游 hasStaleDependencies 的 dep.pull）都经过 pull，在此统一拦截已释放读取
    if (this.#disposed)
      throw createReactiveError(ReactiveErrorCode.nodeDisposed, ReactiveErrorText.disposedComputed)
    if (!this.#dirty) return
    /** This node always uses its original Runtime services. */
    const runtime = this.#internals
    const capture = this.#previewCapture
    if (
      capture &&
      this.#previewVersion === this.#internals.clock.current() &&
      this.#previewEpoch === this.#dirtyEpoch &&
      !this.#previewDirty &&
      runtime.tracker.commitCapture(this, capture)
    ) {
      const next = this.#previewValue
      const changed = this.#version === 0 || !this.#equals(next, this.#value)
      if (changed) {
        const nextVersion = runtime.clock.next()
        this.#value = next
        this.#version = nextVersion
      }
      this.#previewCapture = undefined
      this.#mustRecompute = false
      this.#dirty = false
      this.#scheduleSuspension()
      return
    }
    this.#previewCapture = undefined
    // "Maybe dirty" is confirmed first: pull the dependencies and compare versions. An upstream
    // value that `equals` kept unchanged then stops here and does not rerun `fn`.
    if (!this.#mustRecompute && this.#revalidate()) {
      this.#dirty = false
      this.#scheduleSuspension()
      return
    }
    this.#mustRecompute = true
    this.#recompute()
  } // Settles lazy node versions.
  /**
   * Checks the recorded dependency versions under the same cycle guard as `#recompute`. A cycle
   * recorded through a caught circular error would otherwise recurse through dependency pulls.
   */
  #revalidate(): boolean {
    if (this.#computing) {
      throw createReactiveError(
        ReactiveErrorCode.circularDependency,
        ReactiveErrorText.circularComputedDependency
      )
    }
    this.#computing = true
    try {
      return this.#internals.tracker.revalidate(this)
    } finally {
      this.#computing = false
    }
  }
  #recompute(): void {
    if (this.#computing) {
      // 求值过程中又读到了自己：环。给出可理解的响应式错误，而不是让引擎栈溢出。
      throw createReactiveError(
        ReactiveErrorCode.circularDependency,
        ReactiveErrorText.circularComputedDependency
      )
    }
    this.#computing = true
    /** This node always uses its original Runtime services. */
    const runtime = this.#internals
    const tracing = runtime.traceEnabled()
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
      : undefined
    trace?.start()
    let next: T
    try {
      next = runtime.tracker.runTracked(this, this.#fn) // pull：仅此刻重算
      // equals 自定义比较可能抛错——若在 dirty 落定前抛出，dirty 必须保持 true，否则下次读会返回旧值永不重算
      const changed = this.version === 0 || !this.#equals(next, this.#value)
      if (changed) {
        // 与 Signal 一样先领取版本；耗尽时不能先改缓存再失败。
        const nextVersion = runtime.clock.next()
        this.#value = next
        this.#version = nextVersion
      }
    } catch (error) {
      trace?.error(error)
      throw error
    } finally {
      this.#computing = false
    }
    this.#mustRecompute = false
    this.#dirty = false // 仅在完全成功后才落定 dirty
    trace?.end()
    this.#scheduleSuspension()
  }
  #scheduleSuspension(): void {
    if (this.#keepAlive || this.#subs.size > 0) return
    const generation = ++this.#suspensionGeneration
    // 走 runtime 的 idle 通道而不是裸 queueMicrotask：写死之后这条回收路径不受
    // 任何配置控制。刻意不复用 flush 策略——同步 flush 是合法配置，若共用，
    // 一次读完就立刻断上游边，同 tick 内第二次读会白算一遍。
    this.#internals.deferIdle(() => {
      if (generation === this.#suspensionGeneration && this.#subs.size === 0) {
        this.#suspend()
      }
    })
  }
  #suspend(): void {
    if (this.#keepAlive || this.#disposed || this.#subs.size > 0) return
    this.#suspensionGeneration++
    // Keep the version snapshot so the next read can reuse the cache when no dependency changed.
    this.#internals.tracker.suspendDependencies(this)
    this.#dirty = true
  }
}
