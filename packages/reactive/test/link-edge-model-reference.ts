/** Independent ordered-Set reference state; no production graph storage is copied into expectations. */
import type { IReactiveSignal, IRuntime } from '../src/index.ts'
import {
  createTrackedObserver,
  type IObservable,
  type IObserver,
  type ITrackedObserverBinding
} from '../src/entry/extension.ts'

/** Source identities and ordered subscriber sets belong only to the independent reference graph. */
export type IModelSource = {
  node: IObservable
  label: string
  value: number
  disposed: boolean
  topology: number
  subs: Set<IModelObserver>
  read(): number
  write?: (value: number) => void
  dispose(): void
}

/** The model retains snapshots during suspension without fabricating reverse edges. */
export type IModelObserver = {
  node: IObserver
  label: string
  role: 'tracked' | 'computed' | 'effect'
  deps: Set<IModelSource>
  versions: Map<IModelSource, number>
  suspended?: Map<IModelSource, number>
  disposed: boolean
  binding?: ITrackedObserverBinding
  dispose(): void
}

/** Failure categories exercise supported synchronous callback and source-read boundaries. */
export type IFailureKind = 'throw' | 'disposed' | 'cross-runtime'

/** The fixture exposes operations, never mutable production graph storage. */
export type IModelFixture = {
  step(index: number): void
  failure(kind: IFailureKind): void
  dispose(): void
}

/** These seeds make the exact operation stream reproducible without nondeterministic fuzz input. */
export const SEEDS = [1, 7, 19, 31, 67, 101, 257, 1021, 4093, 65537] as const

/**
 * Reconcile the reference graph from the requested reads. Existing memberships keep their insertion
 * positions; a changed dependency set adopts first-read order. No production view is inspected
 * here. Observable versions are the public source metadata supplied by the operation.
 */
export function commitModel(observer: IModelObserver, reads: readonly IModelSource[]): void {
  /** Set deduplication specifies the first-read ordering independently from the kernel tracker. */
  const next = new Set(reads)
  /** Equal membership preserves the historical Set and Map insertion order. */
  const unchanged =
    observer.deps.size === next.size &&
    observer.versions.size === next.size &&
    [...observer.deps].every((source) => next.has(source))
  if (!unchanged) {
    for (const source of observer.deps) {
      if (!next.has(source)) source.subs.delete(observer)
    }
    for (const source of next) {
      if (!observer.deps.has(source)) source.subs.add(observer)
    }
    observer.deps = next
    observer.versions.clear()
    observer.suspended = undefined
  }
  for (const source of next) observer.versions.set(source, source.node.version)
}

/** Terminal observer cleanup removes both directions and every retained version snapshot. */
export function clearModel(observer: IModelObserver): void {
  for (const source of observer.deps) source.subs.delete(observer)
  observer.deps.clear()
  observer.versions.clear()
  observer.suspended = undefined
}

/** Suspension preserves only versions and independent topology epochs for subsequent validation. */
export function suspendModel(observer: IModelObserver): void {
  if (observer.deps.size === 0) return
  observer.suspended = new Map([...observer.deps].map((source) => [source, source.topology]))
  for (const source of observer.deps) source.subs.delete(observer)
  observer.deps.clear()
}

/** Unchanged source snapshots can reconnect; changed or terminal snapshots remain suspended. */
export function revalidateModel(observer: IModelObserver): boolean {
  for (const [source, version] of observer.versions) {
    if (
      observer.suspended &&
      (source.disposed || source.topology !== observer.suspended.get(source))
    )
      return false
    if (source.node.version !== version) return false
  }
  if (observer.suspended) commitModel(observer, [...observer.versions.keys()])
  return true
}

/** A reference signal keeps expected membership separate from its real source's readonly graph. */
export class ModelSignal implements IModelSource {
  /** Real signal operations belong to this one independently modelled source. */
  #signal: IReactiveSignal<number> & IObservable
  /** Production identity is used only for operation targets and public-view comparisons. */
  readonly node: IObservable
  /** Unique labels make mismatched notifications readable. */
  readonly label: string
  /** Expected value follows fixture inputs rather than production views. */
  value: number
  /** Expected terminal state advances before the matching real operation. */
  disposed = false
  /** Independent topology epochs model invalidation even when a value is unchanged. */
  topology = 0
  /** Reference reverse memberships never alias production collections. */
  subs = new Set<IModelObserver>()
  /** Associate one real source with its independent expected state. */
  constructor(signal: IReactiveSignal<number> & IObservable, label: string, value: number) {
    this.#signal = signal
    this.node = signal
    this.label = label
    this.value = value
  }
  /** A real public read establishes only the production graph's dependency. */
  read(): number {
    return this.#signal.value
  }
  /** Expected values are updated by the operation planner before this real write. */
  write(value: number): void {
    this.#signal.value = value
  }
  /** Real disposal is distinct from the model's preceding terminal-state update. */
  dispose(): void {
    this.#signal.dispose()
  }
}

/** A custom observer owns actual lifecycle state separately from independent expected graph state. */
export class ModelTrackedObserver implements IModelObserver {
  /** Only an actual dispose operation changes the production observer's terminal flag. */
  #actualDisposed = false
  /** Actual callbacks append to this fixture-owned history, never to expected history. */
  #notifications: string[]
  /** Source labels explain disconnect callbacks without reading expected memberships. */
  #labels: Map<object, string>
  /** The supported observer protocol remains distinct from the reference observer object. */
  readonly node: IObserver
  /** Canonical binding owns every production forward and reverse edge. */
  readonly binding: ITrackedObserverBinding
  /** Diagnostic identity remains unique across replacement slots. */
  readonly label: string
  /** Custom observers participate only in direct notification comparisons. */
  readonly role = 'tracked' as const
  /** Reference dependencies and versions never alias binding views. */
  deps = new Set<IModelSource>()
  /** Expected version values are recorded from planned input reads. */
  versions = new Map<IModelSource, number>()
  /** Model suspension retains independent topology epochs. */
  suspended: Map<IModelSource, number> | undefined
  /** Model terminal state is changed by the planner before invoking actual disposal. */
  disposed = false
  /** Build the same supported observer protocol before registering its canonical binding. */
  constructor(
    runtime: IRuntime,
    label: string,
    notifications: string[],
    labels: Map<object, string>
  ) {
    this.label = label
    this.#notifications = notifications
    this.#labels = labels
    /** Metadata getters close over the named owner, whose state lives in private fields. */
    // oxlint-disable-next-line typescript/no-this-alias -- Protocol getters keep their native receiver while reading the named model owner's private state.
    const owner = this
    this.node = {
      runtime,
      debugName: label,
      get disposed() {
        return owner.#actualDisposed
      },
      get deps() {
        return owner.binding.deps
      },
      get depVersions() {
        return owner.binding.depVersions
      },
      markDirty: () => this.#recordDirty(),
      onDependencyDisconnected: (source) => this.#recordDisconnect(source)
    }
    this.binding = createTrackedObserver(this.node)
  }
  /** Record actual notification order independently from reference updates. */
  #recordDirty(): void {
    this.#notifications.push(`dirty:${this.label}`)
  }
  /** Record the actual disconnected source identity through its diagnostic label. */
  #recordDisconnect(source: IObservable): void {
    this.#notifications.push(`disconnect:${this.label}:${this.#labels.get(source)}`)
  }
  /** Mark the real observer terminal before clearing its canonical graph edges. */
  dispose(): void {
    this.#actualDisposed = true
    this.binding.clear()
  }
}
