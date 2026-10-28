import { describe, expect, it } from 'vitest'
import { createRuntime, ReactiveErrorCode } from '../src/index.ts'
import {
  createObserverBinding,
  createTrackedObserver,
  internalRuntimeOf,
  invalidateObservable,
  type IObservable,
  type IObserver,
  type ITrackedObserverBinding
} from '../src/entry/extension.ts'

/** Source identities and ordered subscriber sets belong only to the independent reference graph. */
type IModelSource = {
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
type IModelObserver = {
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
type IFailureKind = 'throw' | 'disposed' | 'cross-runtime'

/** The fixture exposes operations, never mutable production graph storage. */
type IModelFixture = {
  step(index: number): void
  failure(kind: IFailureKind): void
  dispose(): void
}

/** These seeds make the exact operation stream reproducible without nondeterministic fuzz input. */
const SEEDS = [1, 7, 19, 31, 67, 101, 257, 1021, 4093, 65537] as const

/**
 * Reconcile the reference graph from the requested reads. Existing memberships keep their insertion
 * positions; a changed dependency set adopts first-read order. No production view is inspected
 * here. Observable versions are the public source metadata supplied by the operation.
 */
function commitModel(observer: IModelObserver, reads: readonly IModelSource[]): void {
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
function clearModel(observer: IModelObserver): void {
  for (const source of observer.deps) source.subs.delete(observer)
  observer.deps.clear()
  observer.versions.clear()
  observer.suspended = undefined
}

/** Suspension preserves only versions and independent topology epochs for subsequent validation. */
function suspendModel(observer: IModelObserver): void {
  if (observer.deps.size === 0) return
  observer.suspended = new Map([...observer.deps].map((source) => [source, source.topology]))
  for (const source of observer.deps) source.subs.delete(observer)
  observer.deps.clear()
}

/** Unchanged source snapshots can reconnect; changed or terminal snapshots remain suspended. */
function revalidateModel(observer: IModelObserver): boolean {
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

/**
 * Keep the randomized graph bounded to six signal slots and three extension observers. Real
 * Computed/Effect and capture bindings temporarily share those sources, with explicit flushes.
 * Their expected graph and execution sequence are planned from inputs, never copied from views.
 */
function createModelFixture(seed: number): IModelFixture {
  /** Manual flushes isolate one operation from the host's microtask scheduling policy. */
  const runtime = createRuntime({ schedulerStrategy: () => undefined })
  /** This supported extension factory exposes read-only graph metadata for real nodes. */
  const graphRuntime = internalRuntimeOf(runtime)
  /** Diagnostic labels keep failed assertions small and reveal unknown leaked subscribers. */
  const labels = new Map<object, string>()
  /** Production callbacks and independently planned callbacks are compared in exact order. */
  const actualNotifications: string[] = []
  const expectedNotifications: string[] = []
  const actualEffects: string[] = []
  const expectedEffects: string[] = []
  /** Temporary host/lazy nodes join the same per-step graph checks while alive. */
  const extraSources: IModelSource[] = []
  const extraObservers: IModelObserver[] = []
  /** Incrementing labels distinguish replacement nodes from their retired identities. */
  let serial = 0
  /** Xorshift32 has a nonzero, fixed seed and needs no external random state. */
  let randomState = seed >>> 0
  /** Reports the operation that produced the current comparison, including nested gadget checks. */
  let context = `seed=${seed}, initial`

  /** Return a bounded index while retaining the entire reproducible random stream in the seed. */
  function random(limit: number): number {
    randomState ^= randomState << 13
    randomState ^= randomState >>> 17
    randomState ^= randomState << 5
    return (randomState >>> 0) % limit
  }

  /** Construct a real signal, while keeping its reference memberships in an unrelated Set. */
  function makeSignal(value: number): IModelSource {
    /** Labels are unique even when this construction replaces a disposed signal slot. */
    const label = `signal-${serial++}`
    /** The public signal value is the only operation used to establish dependencies. */
    const signal = graphRuntime.signal(value, { debugName: label })
    labels.set(signal, label)
    return {
      node: signal,
      label,
      value,
      disposed: false,
      topology: 0,
      subs: new Set(),
      read: () => signal.value,
      write: (next) => {
        signal.value = next
      },
      dispose: () => signal.dispose()
    }
  }

  /** Custom owners retain lifecycle responsibility and use only the controlled tracker binding. */
  function makeObserver(): IModelObserver {
    /** Replacements need identities distinct from every previously disconnected observer. */
    const label = `observer-${serial++}`
    /** The owner changes this lifecycle flag before its canonical clear operation. */
    let disposed = false
    /** Binding assignment completes before any metadata getter can be read by an operation. */
    let binding: ITrackedObserverBinding
    /** Callback recordings are actual observations, never reference-model updates. */
    const node: IObserver = {
      runtime,
      debugName: label,
      get disposed() {
        return disposed
      },
      get deps() {
        return binding.deps
      },
      get depVersions() {
        return binding.depVersions
      },
      markDirty() {
        actualNotifications.push(`dirty:${label}`)
      },
      onDependencyDisconnected(source) {
        actualNotifications.push(`disconnect:${label}:${labels.get(source)}`)
      }
    }
    binding = createTrackedObserver(node)
    labels.set(node, label)
    return {
      node,
      label,
      role: 'tracked',
      deps: new Set(),
      versions: new Map(),
      disposed: false,
      binding,
      dispose: () => {
        disposed = true
        binding.clear()
      }
    }
  }

  /** Fixed slots permit construction/disposal churn without growing the live random graph. */
  const sources = Array.from({ length: 6 }, (_, index) => makeSignal(index + 1))
  const observers = Array.from({ length: 3 }, () => makeObserver())
  /** These failures are reachable through normal reads and cannot introduce successful edges. */
  const disposedSource = makeSignal(-1)
  disposedSource.dispose()
  disposedSource.disposed = true
  /** Cross-runtime reads must preserve the error thrown at the foreign source's read boundary. */
  const foreignRuntime = createRuntime({ schedulerStrategy: () => undefined })
  const foreign = foreignRuntime.signal(-2)

  /** Apply invalidation to all live reverse edges before scheduling disconnect callbacks. */
  function disconnectModel(source: IModelSource, terminal: boolean): void {
    /** Snapshot insertion order is the independent notification-order expectation. */
    const affected = [...source.subs]
    source.topology++
    if (terminal) source.disposed = true
    source.subs.clear()
    for (const observer of affected) {
      observer.deps.delete(source)
      observer.versions.delete(source)
    }
    for (const observer of affected) {
      if (observer.role === 'tracked')
        expectedNotifications.push(`disconnect:${observer.label}:${source.label}`)
    }
  }

  /** Plan ordinary source callbacks from the reference insertion order before performing a write. */
  function write(source: IModelSource): void {
    for (const observer of source.subs) {
      if (observer.role === 'tracked') expectedNotifications.push(`dirty:${observer.label}`)
    }
    source.value++
    source.write!(source.value)
    runtime.flush()
  }

  /** Run only the requested reads; duplicates exercise first-read deduplication explicitly. */
  function track(observer: IModelObserver, reads: readonly IModelSource[]): void {
    observer.binding!.runTracked(() => {
      for (const source of reads) source.read()
    })
    commitModel(observer, reads)
  }

  /** Short ordered plans vary membership and duplicate reads without creating unsupported cycles. */
  function readPlan(): IModelSource[] {
    return Array.from({ length: random(5) + 1 }, () => sources[random(sources.length)]!)
  }

  /** Include retired sources that remain reachable through a suspended version snapshot. */
  function checkedSources(): Set<IModelSource> {
    /** Active slots and temporary derived nodes are the ordinary source population. */
    const result = new Set([...sources, ...extraSources])
    for (const observer of [...observers, ...extraObservers]) {
      for (const source of observer.versions.keys()) result.add(source)
      for (const source of observer.deps) result.add(source)
    }
    return result
  }

  /** Snapshot every public edge view independently of reference state for exact rollback checks. */
  function snapshotViews() {
    return {
      observers: [...observers, ...extraObservers].map((observer) => ({
        label: observer.label,
        deps: [...observer.node.deps].map((node) => labels.get(node)),
        versions: [...observer.node.depVersions].map(([node, version]) => [
          labels.get(node),
          version
        ])
      })),
      sources: [...checkedSources()].map((source) => ({
        label: source.label,
        subs: [...source.node.subs].map((node) => labels.get(node))
      }))
    }
  }

  /** Compare order, versions, callback sequences and both graph directions after every operation. */
  function check(): void {
    expect(actualNotifications, context).toEqual(expectedNotifications)
    expect(actualEffects, context).toEqual(expectedEffects)
    for (const observer of [...observers, ...extraObservers]) {
      expect(
        [...observer.node.deps].map((node) => labels.get(node)),
        context
      ).toEqual([...observer.deps].map((source) => source.label))
      expect(
        [...observer.node.depVersions].map(([node, version]) => [labels.get(node), version]),
        context
      ).toEqual([...observer.versions].map(([source, version]) => [source.label, version]))
      if (observer.binding)
        expect(observer.binding.isSuspended(), context).toBe(observer.suspended !== undefined)
    }
    /** A single counter records all mirror violations without expensive nested matcher output. */
    let mirrorViolations = 0
    for (const source of checkedSources()) {
      expect(
        [...source.node.subs].map((node) => labels.get(node)),
        context
      ).toEqual([...source.subs].map((observer) => observer.label))
      for (const observer of [...observers, ...extraObservers]) {
        if (source.node.subs.has(observer.node) !== observer.node.deps.has(source.node))
          mirrorViolations++
      }
    }
    expect(mirrorViolations, context).toBe(0)
  }

  /** Failed reads first stage a different candidate topology, then retain the exact original error. */
  function failure(kind: IFailureKind): void {
    /** This observer already has committed or suspended state that must survive the failure. */
    const observer = observers[random(observers.length)]!
    /** Neither failed staging nor callback coding may change any existing view. */
    const before = snapshotViews()
    /** The failed candidate always includes a new edge, making premature commit detectable. */
    const staged = sources.find((source) => !observer.deps.has(source))!
    /** A native callback error must survive with identity and native type intact. */
    const businessFailure = new RangeError(`model failure ${seed}`)
    /** Capture source failures at their originating read, before the callback boundary sees them. */
    let original: unknown
    let caught: unknown
    try {
      observer.binding!.runTracked(() => {
        staged.read()
        for (const source of readPlan()) source.read()
        try {
          if (kind === 'disposed') disposedSource.read()
          else if (kind === 'cross-runtime') void foreign.value
          else throw businessFailure
        } catch (error) {
          original = error
          throw error
        }
      })
    } catch (error) {
      caught = error
    }
    expect(original, context).toBeDefined()
    expect(caught, context).toBe(original)
    if (kind === 'throw') expect(caught, context).toBe(businessFailure)
    else
      expect(caught, context).toMatchObject({
        code: kind === 'disposed' ? ReactiveErrorCode.nodeDisposed : ReactiveErrorCode.crossRuntime
      })
    expect(snapshotViews(), context).toEqual(before)
    check()
  }

  /**
   * Capture uses the host binding's own Effect. Stable commit installs the independently planned
   * graph; discard/staleness install nothing. A later write proves the committed effect executes
   * once and its empty body removes the capture-installed dependencies.
   */
  function capture(mode: 'commit' | 'discard' | 'stale'): void {
    /** Tokens capture only this explicitly generated first-read plan. */
    const reads = readPlan()
    /** The host binding owns its observer lifecycle rather than exposing tracker services. */
    const binding = createObserverBinding(runtime)
    const token = binding.capture(() => {
      for (const source of reads) source.read()
    })
    check()
    if (mode === 'discard') return
    /** The actual effect records executions but never updates the model from inside its callback. */
    const label = `capture-effect-${serial++}`
    expectedEffects.push(label)
    const release = binding.observe(() => {
      actualEffects.push(label)
    })
    if (mode === 'stale') {
      if (random(2) === 0) write(reads[0]!)
      else {
        disconnectModel(reads[0]!, false)
        invalidateObservable(runtime, reads[0]!.node)
      }
      expect(binding.commit(token), context).toBe('stale')
      release()
      check()
      return
    }
    /** Identity discovery uses an existing read-only subscriber view, not private Effect state. */
    const existing = new Set(reads[0]!.node.subs)
    expect(binding.commit(token), context).toBe('committed')
    const node = [...reads[0]!.node.subs].find((candidate) => !existing.has(candidate))!
    expect(node, context).toBeDefined()
    labels.set(node, label)
    /** Expected graph contents come from the input plan, not the newly discovered observer views. */
    const observer: IModelObserver = {
      node,
      label,
      role: 'effect',
      deps: new Set(),
      versions: new Map(),
      disposed: false,
      dispose: release
    }
    extraObservers.push(observer)
    commitModel(observer, reads)
    check()
    expectedEffects.push(label)
    write(reads[0]!)
    clearModel(observer)
    check()
    observer.disposed = true
    release()
    extraObservers.splice(extraObservers.indexOf(observer), 1)
  }

  /** A real conditional Computed/Effect pair joins the random sources and changes upstream edges. */
  function computedEffect(): void {
    /** Distinct branches guarantee an actual membership change when the gate switches. */
    const leftIndex = random(sources.length)
    const left = sources[leftIndex]!
    const right = sources[(leftIndex + random(sources.length - 1) + 1) % sources.length]!
    /** An explicit source makes the conditional switch observable to the canonical scheduler. */
    const gate = makeSignal(0)
    extraSources.push(gate)
    /** Keep-alive removes idle timing from this finite graph/order comparison. */
    const label = `computed-${serial++}`
    const derived = graphRuntime.computed(
      () => (gate.read() === 0 ? left.read() : right.read() + 1000000),
      { keepAlive: true, debugName: label }
    )
    labels.set(derived, label)
    /** The same concrete node has separate expected observable and observer roles. */
    const source: IModelSource = {
      node: derived,
      label,
      value: left.value,
      disposed: false,
      topology: 0,
      subs: new Set(),
      read: () => derived.value,
      dispose: () => derived.dispose()
    }
    const computed: IModelObserver = {
      node: derived,
      label,
      role: 'computed',
      deps: new Set(),
      versions: new Map(),
      disposed: false,
      dispose: () => derived.dispose()
    }
    extraSources.push(source)
    extraObservers.push(computed)
    /** Expected values are calculated from fixture inputs before any actual effect body runs. */
    const effectLabel = `effect-${serial++}`
    expectedEffects.push(`${effectLabel}:${left.value}`)
    const effect = runtime.effect(() => {
      actualEffects.push(`${effectLabel}:${derived.value}`)
    })
    const node = [...derived.subs][0]!
    labels.set(node, effectLabel)
    const observer: IModelObserver = {
      node,
      label: effectLabel,
      role: 'effect',
      deps: new Set(),
      versions: new Map(),
      disposed: false,
      dispose: () => effect.dispose()
    }
    extraObservers.push(observer)
    commitModel(computed, [gate, left])
    commitModel(observer, [source])
    check()
    gate.value = 1
    source.value = right.value + 1000000
    expectedEffects.push(`${effectLabel}:${source.value}`)
    gate.write!(1)
    runtime.flush()
    commitModel(computed, [gate, right])
    commitModel(observer, [source])
    check()
    clearModel(observer)
    observer.disposed = true
    effect.dispose()
    clearModel(computed)
    computed.disposed = true
    disconnectModel(source, true)
    derived.dispose()
    disconnectModel(gate, true)
    gate.dispose()
    check()
    extraObservers.splice(extraObservers.indexOf(observer), 1)
    extraObservers.splice(extraObservers.indexOf(computed), 1)
    extraSources.splice(extraSources.indexOf(source), 1)
    extraSources.splice(extraSources.indexOf(gate), 1)
  }

  for (let index = 0; index < observers.length; index++) {
    track(observers[index]!, [sources[index]!, sources[(index + 1) % sources.length]!])
  }
  check()
  return {
    step(index) {
      /** The first cycle guarantees every operation category occurs for every fixed seed. */
      const operation = index < 16 ? index : random(16)
      context = `seed=${seed}, step=${index}, operation=${operation}`
      /** Main operands are selected from bounded live slots before the operation changes topology. */
      const observerIndex = random(observers.length)
      const observer = observers[observerIndex]!
      const sourceIndex = random(sources.length)
      const source = sources[sourceIndex]!
      if (operation === 0) {
        disconnectModel(source, true)
        source.dispose()
        expect(source.node.subs.size, context).toBe(0)
        sources[sourceIndex] = makeSignal(random(100))
      } else if (operation === 1) {
        clearModel(observer)
        observer.disposed = true
        observer.dispose()
        observer.dispose()
        expect([...observer.node.deps], context).toEqual([])
        expect([...observer.node.depVersions], context).toEqual([])
        observers[observerIndex] = makeObserver()
      } else if (operation === 2) {
        /**
         * Both the reference plan and actual conditional derive their branch from the selector
         * value.
         */
        const branch = sources[0]!.value % 2 === 0 ? sources[1]! : sources[2]!
        observer.binding!.runTracked(() => {
          if (sources[0]!.read() % 2 === 0) sources[1]!.read()
          else sources[2]!.read()
          sources[0]!.read()
        })
        commitModel(observer, [sources[0]!, branch, sources[0]!])
      } else if (operation === 3) {
        /** Read-order reversal with identical membership must retain the old insertion positions. */
        const reads = observer.deps.size ? [...observer.deps].reverse() : readPlan()
        track(observer, [...reads, ...reads])
      } else if (operation >= 4 && operation <= 6) {
        failure((['throw', 'disposed', 'cross-runtime'] as const)[operation - 4]!)
      } else if (operation === 7) {
        observer.binding!.suspend()
        suspendModel(observer)
      } else if (operation === 8) {
        /** The reference uses independent topology epochs and public source versions only. */
        const expected = revalidateModel(observer)
        expect(observer.binding!.revalidate(), context).toBe(expected)
      } else if (operation >= 9 && operation <= 11) {
        capture((['commit', 'discard', 'stale'] as const)[operation - 9]!)
      } else if (operation === 12) {
        disconnectModel(source, false)
        invalidateObservable(runtime, source.node)
      } else if (operation === 13) write(source)
      else if (operation === 14) computedEffect()
      else {
        observer.binding!.clear()
        clearModel(observer)
      }
      check()
    },
    failure,
    dispose() {
      for (const observer of [...observers, ...extraObservers]) observer.dispose()
      for (const source of [...sources, ...extraSources]) source.dispose()
      disposedSource.dispose()
      foreign.dispose()
    }
  }
}

describe('independent ordered Set graph model', () => {
  it.each(SEEDS)(
    'matches every edge and effect execution for seed %i over 2000 steps',
    (seed) => {
      /** Each seed owns an isolated runtime, graph, callback history and PRNG state. */
      const fixture = createModelFixture(seed)
      try {
        for (let step = 0; step < 2000; step++) fixture.step(step)
      } finally {
        fixture.dispose()
      }
    },
    30000
  )
})

describe('failed tracking preserves the entire graph', () => {
  it.each(['throw', 'disposed', 'cross-runtime'] as const)(
    'preserves views and original error identity after %s',
    (kind) => {
      /** Nonempty baseline edges make premature commit or lost rollback immediately observable. */
      const fixture = createModelFixture(101)
      try {
        fixture.failure(kind)
      } finally {
        fixture.dispose()
      }
    }
  )
})
