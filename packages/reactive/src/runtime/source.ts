import { internalsOf } from './internals.ts'
import { claimOwnership } from './ownership.ts'
import type { IObservable, IObserver, IRuntime } from './types.ts'
import { createReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'
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

/**
 * Creates a controlled source for extension layers.
 *
 * Callers receive `track`, `notify`, `commit`, `dispose`, and read-only observation and disposal
 * state. The node, `subs`, `version`, and tracker stay private. Callers cannot create one-sided
 * edges, fabricate versions, or notify another runtime's graph.
 */
export function createFieldSource(runtime: IRuntime, debugName?: string): IRuntimeFieldSource {
  /** Metadata is assigned before this private node can enter any dependency frame. */
  let binding: IRuntimeSourceBinding
  /** The field source keeps its graph identity private while sharing canonical source state. */
  const node: IObservable = {
    runtime,
    debugName,
    get subs() {
      return binding.subs
    },
    get version() {
      return binding.version
    }
  }
  binding = createSourceBinding(node)
  return binding.source
}

/**
 * Binds a fresh custom observable, such as a SAB node, to the canonical source implementation.
 * Assign the returned readonly metadata during construction before publishing the node. Rebinding
 * an existing graph node rejects instead of replacing its live edges.
 */
export function createSourceBinding(node: IObservable): IRuntimeSourceBinding {
  /** Captured services belong to this node's runtime and never escape through the binding. */
  const runtime = node.runtime
  /** Internal services are captured once without exposing the mutable service objects. */
  const services = internalsOf(runtime)
  assertGraphNodeUnregistered(node)
  claimOwnership(node, runtime)
  /** Reserve the first version before publishing any source bookkeeping. */
  const initialVersion = services.clock.next()
  /** One registered set supplies both kernel mutation and the read-only diagnostic view. */
  const subs = registerSubs(node, new Set<IObserver>())
  registerVersion(node, initialVersion)
  /** Source disposal is the existing graph disconnection lifecycle, independent of its owner's data. */
  let disposed = false

  /** Rejects reads and notifications after the exact source has disconnected. */
  const assertActive = (): void => {
    if (disposed)
      throw createReactiveError(
        ReactiveErrorCode.nodeDisposed,
        ReactiveErrorText.disposedFieldSource
      )
  }

  /** Only these existing source operations are exposed, each capturing its original node. */
  const source: IRuntimeFieldSource = {
    track() {
      assertActive()
      services.tracker.track(node)
    },
    notify() {
      assertActive()
      services.notify(node)
    },
    commit<T>(write: () => T): T {
      assertActive()
      return services.commitSource(node, write)
    },
    get observed() {
      return !disposed && node.subs.size > 0
    },
    get disposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      services.tracker.disconnectObservable(node, 'dispose')
    }
  }
  return Object.freeze({
    get version() {
      return readVersion(node)
    },
    subs,
    source
  })
}
