/** Owns one custom source's registration, publication and disposal without exposing graph authority. */
import { internalsOf, type IRuntimeInternals } from './internals.ts'
import { claimOwnership } from './ownership.ts'
import type { IObservable, IObserver, IRuntime } from './types.ts'
import { createReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'
import { ReactiveTraceReason } from './trace-constants.ts'
import {
  assertGraphNodeUnregistered,
  registerSubs,
  registerVersion,
  readVersion
} from './node-internals.ts'

/** Controlled source lifecycle and notification capabilities without exposing the graph node. */
export type IRuntimeFieldSource = {
  track(): void
  notify(): void
  commit<T>(write: () => T): T
  readonly observed: boolean
  readonly disposed: boolean
  dispose(): void
}

/** Custom node metadata is read-only; graph operations remain bound to this exact node. */
export type IRuntimeSourceBinding = Readonly<{
  /** Monotonic local graph version, advanced only by canonical source publication. */
  readonly version: number
  /** Live diagnostic view whose mutable backing set remains in the kernel. */
  readonly subs: ReadonlySet<IObserver>
  /** Lifecycle and update operations capture the original node without accepting another target. */
  readonly source: IRuntimeFieldSource
}>

/** Keeps source lifecycle state on one owner while retaining the existing ordinary-object ports. */
class SourceBinding {
  /** Exact graph identity; custom nodes are never replaced by their public source port. */
  readonly #node: IObservable
  /** Services captured from the node's runtime before any graph registration occurs. */
  readonly #services: IRuntimeInternals
  /** Frozen metadata published only after canonical versions and subscribers are registered. */
  readonly binding: IRuntimeSourceBinding
  /** Terminal state prevents publication after the source disconnects its graph edges. */
  #disposed = false

  /** Registers either an existing custom node or a private field node using the same source path. */
  constructor(target: IObservable | IRuntime, field: boolean, debugName?: string) {
    this.#node = field
      ? this.#createFieldNode(target as IRuntime, debugName)
      : (target as IObservable)
    /** Read the custom node's runtime exactly once, before validating its existing registration. */
    const runtime = this.#node.runtime
    this.#services = internalsOf(runtime)
    assertGraphNodeUnregistered(this.#node)
    claimOwnership(this.#node, runtime)
    /** Reserve the first version before publishing any source bookkeeping. */
    const initialVersion = this.#services.clock.next()
    /** Kernel mutations and diagnostic reads retain the same canonical subscriber set. */
    const subs = registerSubs(this.#node, new Set<IObserver>())
    registerVersion(this.#node, initialVersion)
    /** Getter methods retain their original names and plain-object descriptors. */
    // oxlint-disable-next-line typescript/no-this-alias -- Ordinary-object getters retain their names while reading the owner's private state.
    const owner = this
    /** Only the source operations are exposed; all lifecycle state remains on this owner. */
    const source: IRuntimeFieldSource = {
      track: () => this.#track(),
      notify: () => this.#notify(),
      commit: <T>(write: () => T): T => this.#commit(write),
      get observed() {
        return !owner.#disposed && owner.#node.subs.size > 0
      },
      get disposed() {
        return owner.#disposed
      },
      dispose: () => this.#dispose()
    }
    this.binding = Object.freeze({
      get version() {
        return readVersion(owner.#node)
      },
      subs,
      source
    })
  }

  /** Creates a private plain node whose metadata becomes readable when construction completes. */
  #createFieldNode(runtime: IRuntime, debugName?: string): IObservable {
    /** The node's accessors refer to the owner rather than retaining separate mutable binding state. */
    // oxlint-disable-next-line typescript/no-this-alias -- Plain graph-node getters keep their original receiver and names while reading the owner.
    const owner = this
    return {
      runtime,
      debugName,
      get subs() {
        return owner.binding.subs
      },
      get version() {
        return owner.binding.version
      }
    }
  }

  /** Rejects reads and notifications after this exact source has disconnected. */
  #assertActive(): void {
    if (this.#disposed)
      throw createReactiveError(
        ReactiveErrorCode.nodeDisposed,
        ReactiveErrorText.disposedFieldSource
      )
  }

  /** Collects this source in the runtime's current dependency frame. */
  #track(): void {
    this.#assertActive()
    this.#services.tracker.track(this.#node)
  }

  /** Publishes an external update through the existing runtime notification path. */
  #notify(): void {
    this.#assertActive()
    this.#services.notify(this.#node)
  }

  /** Reserves a version, executes the caller's write and publishes once through the runtime. */
  #commit<T>(write: () => T): T {
    this.#assertActive()
    return this.#services.commitSource(this.#node, write)
  }

  /** Marks the source terminal before disconnecting, so reentrant disposal remains idempotent. */
  #dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#services.tracker.disconnectObservable(this.#node, ReactiveTraceReason.dispose)
  }
}

/**
 * Creates a controlled source for extension layers.
 *
 * Callers receive `track`, `notify`, `commit`, `dispose`, and read-only observation and disposal
 * state. The node, `subs`, `version`, and tracker stay private. Callers cannot create one-sided
 * edges, fabricate versions, or notify another runtime's graph.
 */
export function createFieldSource(runtime: IRuntime, debugName?: string): IRuntimeFieldSource {
  return new SourceBinding(runtime, true, debugName).binding.source
}

/**
 * Binds a fresh custom observable, such as a SAB node, to the canonical source implementation.
 * Assign the returned readonly metadata during construction before publishing the node. Rebinding
 * an existing graph node rejects instead of replacing its live edges.
 */
export function createSourceBinding(node: IObservable): IRuntimeSourceBinding {
  return new SourceBinding(node, false).binding
}
