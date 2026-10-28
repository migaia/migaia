/** Owns lazy and speculative derived values; canonical dependency edges remain with the tracker. */
import type { IDisposable, IObservable, IObserver, IRuntime } from '../runtime/types.ts'
import type { ICapture } from '../runtime/dependency-tracker.class.ts'
import { markSubscribers } from '../runtime/subscriber-graph.ts'
import { internalsOf, type IRuntimeInternals } from '../runtime/internals.ts'
import { claimOwnership } from '../runtime/ownership.ts'
import { createObserverRunTrace, describeObserver } from '../runtime/diagnostics.ts'
import { registerSubs } from '../runtime/node-internals.ts'
import { registerDeps, registerDepVersions } from '../runtime/node-internals.ts'
import { createReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorPhase, ReactiveTraceReason } from '../runtime/trace-constants.ts'
import { ReactiveErrorText } from '../error-text.ts'

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

/** Push invalidation and lazy pulls share one committed cache without publishing speculative reads. */
export class Computed<T> implements IObservable, IObserver, IDisposable {
  /** Canonical downstream membership is mutated only by graph operations. */
  #subs = new Set<IObserver>()
  /** Extensions receive the live subscriber view without writable graph authority. */
  readonly subs: ReadonlySet<IObserver>
  /** Committed upstream membership is retained until retracking, suspension or disposal. */
  #deps = new Set<IObservable>()
  /** Last committed upstream versions let unchanged derivations reuse the cached value. */
  #depVersions = new Map<IObservable, number>()
  /** Read-only dependency membership shares the canonical private collection. */
  readonly deps: ReadonlySet<IObservable>
  /** Read-only upstream version snapshots support graph diagnostics and stale checks. */
  readonly depVersions: ReadonlyMap<IObservable, number>
  /** Zero means no committed evaluation has published a value yet. */
  #version = 0
  /** Exposes the last committed version without forcing evaluation. */
  get version(): number {
    return this.#version
  }
  /** Owning Runtime fixes this derivation's graph and diagnostic channels for its lifetime. */
  readonly runtime: IRuntime
  /** Immutable kernel services captured once from this node's owning Runtime. */
  readonly #internals: IRuntimeInternals
  /** Optional diagnostic label does not participate in cache or dependency identity. */
  debugName?: string
  /** Last committed result preserves identity when the configured comparer considers values equal. */
  #value!: T
  /** Dirty reads pull upstream versions before deciding whether user derivation must run again. */
  #dirty = true
  /**
   * Whether the next dirty pull must run `fn` instead of trusting the recorded dependency versions.
   * True before the first successful evaluation, after a dependency was disconnected, and after a
   * failed evaluation, so an error is retried on every read until an evaluation succeeds.
   */
  #mustRecompute = true
  /** Shared evaluation guard rejects direct and indirectly reentrant derivation cycles. */
  #computing = false // 循环自依赖保护：a→b→a 会在此触发可读错误而非栈溢出
  /** Terminal state prevents disposed nodes from returning a disconnected stale cache. */
  #disposed = false
  /** Caller derivation executes only inside the owning tracker's read boundary. */
  #fn: () => T
  /** Comparer controls whether successful evaluation publishes a new version and value identity. */
  #equals: (a: T, b: T) => boolean
  /** Keep-alive nodes retain upstream edges even when they have no downstream subscribers. */
  #keepAlive: boolean
  /** Observation changes retire deferred suspension callbacks before they can disconnect live edges. */
  #suspensionGeneration = 0
  /** Negative sentinel means no speculative result exists for any Runtime version. */
  #previewVersion = -1
  /** Speculative value stays separate from the committed cache until a capture is admitted. */
  #previewValue!: T
  /** Explicit invalidation prevents a same-clock preview from surviving a dirty transition. */
  #previewDirty = true
  /** Local invalidations distinguish previews even when the shared version clock has not advanced. */
  #dirtyEpoch = 0
  /** Negative sentinel means no preview has recorded the current local invalidation epoch. */
  #previewEpoch = -1
  /** Opaque derivation token retains speculative dependencies for validation before publication. */
  #previewCapture?: ICapture<T>
  /** Registers graph metadata and options without eagerly evaluating the caller's derivation. */
  constructor(fn: () => T, runtime: IRuntime, config: IComputedConfig<T> = {}) {
    this.subs = registerSubs(this, this.#subs)
    this.deps = registerDeps(this, this.#deps)
    this.depVersions = registerDepVersions(this, this.#depVersions)
    /** Function shorthand selects only the comparer; object options retain their established reads. */
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
  /** Reports terminal disposal without evaluating or reconnecting the derivation. */
  get disposed(): boolean {
    return this.#disposed
  }
  /** A terminal node is unobserved even during its reentrant graph disconnection. */
  get observed(): boolean {
    return !this.#disposed && this.#subs.size > 0
  }
  /** Disposes once, discards speculative state and disconnects both upstream and downstream edges. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#previewVersion = -1
    this.#previewDirty = true
    this.#previewValue = undefined as T
    this.#previewCapture = undefined
    this.#internals.tracker.clearDependencies(this) // 退订上游 + 清 deps/depVersions
    this.#internals.tracker.disconnectObservable(this, ReactiveTraceReason.dispose)
  }
  /**
   * Invalidates the preview on every mark but propagates downstream only on the clean-to-dirty
   * edge.
   */
  markDirty(): void {
    this.#dirtyEpoch++
    this.#previewDirty = true
    if (this.#dirty) return // 幂等 → diamond 去重
    this.#dirty = true
    markSubscribers(this)
  }
  /** Reports pending invalidation without pulling dependencies or running the derivation. */
  isStale(): boolean {
    return this.#dirty
  }
  /** New observation retires any queued suspension of the previously unobserved node. */
  onObserved(): void {
    this.#suspensionGeneration++
  }
  /** Losing the last subscriber releases upstream edges while retaining reusable version snapshots. */
  onUnobserved(): void {
    this.#suspend()
  }
  /** A removed dependency requires a fresh derivation because its replacement cannot be inferred. */
  onDependencyDisconnected(): void {
    // The disconnected dependency is gone from `depVersions`; only `fn` can tell what replaces it.
    this.#mustRecompute = true
    this.markDirty()
  }
  /** Tracks this derived node and selects speculative capture or the committed lazy evaluation path. */
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
  /** Reads through the same lazy cache without subscribing the caller to this derived node. */
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
    /** Shared version and local epoch jointly identify a reusable speculative evaluation. */
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
    /** Captured dependencies remain detached until a later commit accepts this exact token. */
    let capture: ICapture<T>
    try {
      capture = this.#internals.tracker.capture(this.#fn)
    } finally {
      this.#computing = false
    }
    /** Derivation result is compared before any speculative identity is selected. */
    const value = capture.result
    /** Prefer committed identity when available, otherwise compare against the last preview. */
    const baseline = this.#version > 0 ? this.#value : this.#previewValue
    /** Version sentinels distinguish a real prior value from an uninitialized cache slot. */
    const hasBaseline = this.#version > 0 || this.#previewVersion >= 0
    /** An equal result must retain the same object identity across speculative and committed reads. */
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
  /**
   * Settles dirty state by accepting a valid preview, revalidating upstream versions or
   * recomputing.
   */
  pull(): void {
    // 所有读取路径（value/peek/上游 hasStaleDependencies 的 dep.pull）都经过 pull，在此统一拦截已释放读取
    if (this.#disposed)
      throw createReactiveError(ReactiveErrorCode.nodeDisposed, ReactiveErrorText.disposedComputed)
    if (!this.#dirty) return
    /** This node always uses its original Runtime services. */
    const runtime = this.#internals
    /** A retained render token can publish without executing the derivation a second time. */
    const capture = this.#previewCapture
    if (
      capture &&
      this.#previewVersion === this.#internals.clock.current() &&
      this.#previewEpoch === this.#dirtyEpoch &&
      !this.#previewDirty &&
      runtime.tracker.commitCapture(this, capture)
    ) {
      /** Admitted preview becomes a candidate for the committed cache under the configured comparer. */
      const next = this.#previewValue
      /** First publication always reserves a version even if the candidate is undefined. */
      const changed = this.#version === 0 || !this.#equals(next, this.#value)
      if (changed) {
        /** Clock exhaustion must fail before replacing the committed value. */
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
  /**
   * Recomputes under the cycle guard and commits cache state only after derivation and comparer
   * succeed.
   */
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
    /** Untraced evaluation avoids allocating a diagnostic span. */
    const tracing = runtime.traceEnabled()
    /** The optional span owns exactly this derivation attempt, including its failure terminal. */
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
    /** Candidate result remains unpublished while the derivation or comparer can still fail. */
    let next: T
    try {
      next = runtime.tracker.runTracked(this, this.#fn) // pull：仅此刻重算
      // equals 自定义比较可能抛错——若在 dirty 落定前抛出，dirty 必须保持 true，否则下次读会返回旧值永不重算
      /** Equal results preserve the prior committed identity and version. */
      const changed = this.version === 0 || !this.#equals(next, this.#value)
      if (changed) {
        // 与 Signal 一样先领取版本；耗尽时不能先改缓存再失败。
        /** Reserve publication authority before mutating the visible cache. */
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
  /** Queues idle suspension only for unobserved nodes and retires stale callbacks by generation. */
  #scheduleSuspension(): void {
    if (this.#keepAlive || this.#subs.size > 0) return
    /** Only this latest idle request may disconnect a node that remains unobserved. */
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
  /** Releases reverse edges while keeping dependency versions so a later read can reuse the cache. */
  #suspend(): void {
    if (this.#keepAlive || this.#disposed || this.#subs.size > 0) return
    this.#suspensionGeneration++
    // Keep the version snapshot so the next read can reuse the cache when no dependency changed.
    this.#internals.tracker.suspendDependencies(this)
    this.#dirty = true
  }
}
