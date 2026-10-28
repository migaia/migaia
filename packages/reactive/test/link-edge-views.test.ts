import { describe, expect, it } from 'vitest'
import { createRuntime, type IReactiveEffect, type IRuntime } from '../src/index.ts'
import {
  createStaticObserver,
  createSourceBinding,
  createTrackedObserver,
  internalRuntimeOf,
  invalidateObservable,
  type IObservable,
  type IObserver,
  type IRuntimeSourceBinding,
  type ITrackedObserverBinding
} from '../src/entry/extension.ts'

/** Controlled observers exercise synchronous graph callbacks through the supported extension entry. */
type IControlledObserver = {
  observer: IObserver
  binding: ITrackedObserverBinding
  dispose(): void
}

/** A receiver token proves collection callbacks retain the caller's explicit thisArg. */
type IForEachContext = { label: string }

/** Bind one extension observer without replacing tracker, scheduling, or edge ownership. */
function createControlledObserver(
  runtime: IRuntime,
  onDirty: () => void = () => undefined
): IControlledObserver {
  /** Binding metadata is assigned before the observer participates in a dependency frame. */
  let binding: ITrackedObserverBinding
  /** The extension owner supplies its own terminal state while the binding owns all graph edges. */
  let disposed = false
  /** Callbacks expose only the canonical binding's live readonly diagnostic views. */
  const observer: IObserver = {
    runtime,
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
      if (!disposed) onDirty()
    },
    onDependencyDisconnected() {}
  }
  binding = createTrackedObserver(observer)
  return {
    observer,
    binding,
    dispose() {
      if (disposed) return
      disposed = true
      binding.clear()
    }
  }
}

describe('live readonly graph collection behavior', () => {
  it('preserves Set and Map order, size, callback arguments, receiver, and native tags', () => {
    /** Diagnostic graph views require the controlled extension factory rather than a mutable node. */
    const runtime = internalRuntimeOf(createRuntime())
    /** Sources are read in a deliberate order that differs from creation order. */
    const first = runtime.signal(1)
    /** The second source gives both views multiple distinct entries. */
    const second = runtime.signal(2)
    /** This extension observer retains the same view identities throughout its lifetime. */
    const controlled = createControlledObserver(runtime)
    controlled.binding.runTracked(() => {
      void second.value
      void first.value
    })
    /** Capture live views before later graph mutation. */
    const deps = controlled.binding.deps
    /** Version entries must retain the corresponding dependency order and current values. */
    const versions = controlled.binding.depVersions
    /** Receiver forwarding is part of the public readonly collection contract. */
    const receiver: IForEachContext = { label: 'collection receiver' }
    /** Set callbacks receive the same entry twice and this exact readonly view. */
    const setCalls: Array<[IObservable, IObservable, ReadonlySet<IObservable>]> = []
    /** Map callbacks receive value before key and this exact readonly map. */
    const mapCalls: Array<[number, IObservable, ReadonlyMap<IObservable, number>]> = []
    /** Both callback families must preserve the explicitly supplied receiver. */
    const receivers: IForEachContext[] = []
    deps.forEach(function (this: IForEachContext, value, repeatedValue, view) {
      receivers.push(this)
      setCalls.push([value, repeatedValue, view])
    }, receiver)
    versions.forEach(function (this: IForEachContext, value, key, view) {
      receivers.push(this)
      mapCalls.push([value, key, view])
    }, receiver)

    expect(deps.size).toBe(2)
    expect(deps.has(first)).toBe(true)
    expect([...deps]).toEqual([second, first])
    expect([...deps.keys()]).toEqual([second, first])
    expect([...deps.values()]).toEqual([second, first])
    expect([...deps.entries()]).toEqual([
      [second, second],
      [first, first]
    ])
    expect(setCalls).toEqual([
      [second, second, deps],
      [first, first, deps]
    ])
    expect(versions.size).toBe(2)
    expect(versions.has(first)).toBe(true)
    expect(versions.get(first)).toBe(first.version)
    expect([...versions]).toEqual([
      [second, second.version],
      [first, first.version]
    ])
    expect([...versions.keys()]).toEqual([second, first])
    expect([...versions.values()]).toEqual([second.version, first.version])
    expect([...versions.entries()]).toEqual([...versions])
    expect(mapCalls).toEqual([
      [second.version, second, versions],
      [first.version, first, versions]
    ])
    expect(receivers).toEqual([receiver, receiver, receiver, receiver])
    expect(Object.prototype.toString.call(deps)).toBe('[object Set]')
    expect(Object.prototype.toString.call(versions)).toBe('[object Map]')

    controlled.dispose()
    expect(controlled.binding.deps).toBe(deps)
    expect(controlled.binding.depVersions).toBe(versions)
    expect(deps.size).toBe(0)
    expect(versions.size).toBe(0)
    first.dispose()
    second.dispose()
  })

  it('lets subscriber forEach skip deleted entries and visit subscriptions added during iteration', () => {
    /** One source exposes its subscriber view through the extension diagnostic boundary. */
    const runtime = internalRuntimeOf(createRuntime())
    /** The source's native-order view stays live while callbacks mutate graph membership. */
    const source = runtime.signal(0)
    /** First entry removes an unvisited observer and adds a new observer during forEach. */
    const first = createControlledObserver(runtime)
    /** This entry is removed before its turn and must not receive a collection callback. */
    const second = createControlledObserver(runtime)
    /** A newly appended observer must be visited in this same native collection traversal. */
    const late = createControlledObserver(runtime)
    first.binding.runTracked(() => source.value)
    second.binding.runTracked(() => source.value)
    /** View identity is retained while the underlying graph changes. */
    const subscribers = source.subs
    /** Entry order records live forEach semantics without invoking notification dispatch. */
    const visited: IObserver[] = []
    subscribers.forEach((value, repeatedValue, view) => {
      expect(repeatedValue).toBe(value)
      expect(view).toBe(subscribers)
      visited.push(value)
      if (value === first.observer) {
        second.binding.clear()
        late.binding.runTracked(() => source.value)
      }
    })
    expect(visited).toEqual([first.observer, late.observer])
    expect(subscribers.size).toBe(2)
    expect([...subscribers]).toEqual([first.observer, late.observer])
    expect([...subscribers.entries()]).toEqual([
      [first.observer, first.observer],
      [late.observer, late.observer]
    ])
    expect(Object.prototype.toString.call(subscribers)).toBe('[object Set]')
    first.dispose()
    second.dispose()
    late.dispose()
    source.dispose()
  })

  it('retains stable membership order and restores suspended edges in their recorded order', () => {
    /** Stable member reads may reverse without changing existing diagnostic insertion order. */
    const runtime = internalRuntimeOf(createRuntime())
    /** The initial first dependency remains first even when later reads visit it last. */
    const first = runtime.signal(1)
    /** The second dependency supplies a distinct version snapshot and reverse edge. */
    const second = runtime.signal(2)
    /** A controlled binding exposes suspend and revalidate without accessing the tracker. */
    const controlled = createControlledObserver(runtime)
    controlled.binding.runTracked(() => {
      void first.value
      void second.value
    })
    controlled.binding.runTracked(() => {
      void second.value
      void first.value
    })
    expect([...controlled.binding.deps]).toEqual([first, second])
    expect([...controlled.binding.depVersions.keys()]).toEqual([first, second])
    /** Suspension retains exactly these values and this order until revalidation succeeds. */
    const recordedVersions = [...controlled.binding.depVersions]
    controlled.binding.suspend()
    expect(controlled.binding.isSuspended()).toBe(true)
    expect(controlled.binding.deps.size).toBe(0)
    expect([...controlled.binding.deps]).toEqual([])
    expect([...controlled.binding.depVersions]).toEqual(recordedVersions)
    expect(first.subs.size).toBe(0)
    expect(second.subs.size).toBe(0)
    expect(controlled.binding.revalidate()).toBe(true)
    expect(controlled.binding.isSuspended()).toBe(false)
    expect([...controlled.binding.deps]).toEqual([first, second])
    expect([...controlled.binding.depVersions]).toEqual(recordedVersions)
    expect([...first.subs]).toEqual([controlled.observer])
    expect([...second.subs]).toEqual([controlled.observer])
    controlled.dispose()
    first.dispose()
    second.dispose()
  })

  it('clears dependencies attached synchronously by an unobserved hook during the same clear', () => {
    /** Both sources participate through the same runtime and controlled observer binding. */
    const runtime = internalRuntimeOf(createRuntime())
    /** Removing this first edge synchronously replaces the observer's dependency with second. */
    const first = runtime.signal(0)
    /** The outer clear must also remove the edge created by the reentrant tracked read. */
    const second = runtime.signal(0)
    /** The binding owns both outer cleanup and reentrant graph participation. */
    const controlled = createControlledObserver(runtime)
    /** Hook order proves the outer cleanup continues through the newly attached dependency. */
    const hooks: string[] = []
    first.addObservedHooks({
      onUnobserved: () => {
        hooks.push('first')
        controlled.binding.runTracked(() => second.value)
      }
    })
    second.addObservedHooks({
      onUnobserved: () => {
        hooks.push('second')
      }
    })
    controlled.binding.runTracked(() => first.value)

    controlled.binding.clear()

    expect(hooks).toEqual(['first', 'second'])
    expect(controlled.binding.deps.size).toBe(0)
    expect(controlled.binding.depVersions.size).toBe(0)
    expect([...controlled.binding.deps]).toEqual([])
    expect([...controlled.binding.depVersions]).toEqual([])
    expect(first.subs.size).toBe(0)
    expect(second.subs.size).toBe(0)
    controlled.dispose()
    first.dispose()
    second.dispose()
  })

  it('deduplicates an edge installed reentrantly while the previous dependency disconnects', () => {
    /** Both tracked executions share the same canonical runtime and observer binding. */
    const runtime = internalRuntimeOf(createRuntime())
    /** Disconnecting the original dependency synchronously installs the replacement edge. */
    const original = runtime.signal(0)
    /** Inner and outer tracked executions request this same replacement dependency. */
    const replacement = runtime.signal(0)
    /** The binding must retain one forward edge and one reverse edge for this observer. */
    const controlled = createControlledObserver(runtime)
    original.addObservedHooks({
      onUnobserved: () => {
        controlled.binding.runTracked(() => replacement.value)
      }
    })
    controlled.binding.runTracked(() => original.value)

    controlled.binding.runTracked(() => replacement.value)

    expect(original.subs.size).toBe(0)
    expect(replacement.subs.size).toBe(1)
    expect([...replacement.subs]).toEqual([controlled.observer])
    expect(controlled.binding.deps.size).toBe(1)
    expect([...controlled.binding.deps]).toEqual([replacement])
    expect(controlled.binding.depVersions.size).toBe(1)
    expect([...controlled.binding.depVersions]).toEqual([[replacement, replacement.version]])
    controlled.binding.clear()
    expect(replacement.subs.size).toBe(0)
    expect(controlled.binding.deps.size).toBe(0)
    expect(controlled.binding.depVersions.size).toBe(0)
    controlled.dispose()
    original.dispose()
    replacement.dispose()
  })

  it('commits only outer reads after nested tracking changes the same observer topology', () => {
    /** Nested reads share one observer while retaining distinct dependency collection frames. */
    const runtime = internalRuntimeOf(createRuntime())
    /** The outer frame reads this dependency before and after the nested topology change. */
    const first = runtime.signal(0)
    /** This dependency changes position inside the nested frame but remains in the outer result. */
    const second = runtime.signal(0)
    /** The nested-only dependency must be removed when the outer frame commits. */
    const nestedOnly = runtime.signal(0)
    /** One binding owns both tracked executions and must never create duplicate graph edges. */
    const controlled = createControlledObserver(runtime)
    controlled.binding.runTracked(() => {
      void first.value
      void second.value
    })

    controlled.binding.runTracked(() => {
      void first.value
      controlled.binding.runTracked(() => {
        void second.value
        void first.value
        void nestedOnly.value
      })
      void second.value
      void first.value
    })

    expect(controlled.binding.deps.size).toBe(2)
    expect([...controlled.binding.deps]).toEqual([first, second])
    expect(controlled.binding.depVersions.size).toBe(2)
    expect([...controlled.binding.depVersions]).toEqual([
      [first, first.version],
      [second, second.version]
    ])
    expect([...first.subs]).toEqual([controlled.observer])
    expect([...second.subs]).toEqual([controlled.observer])
    expect(nestedOnly.subs.size).toBe(0)
    controlled.binding.clear()
    expect(first.subs.size).toBe(0)
    expect(second.subs.size).toBe(0)
    controlled.dispose()
    first.dispose()
    second.dispose()
    nestedOnly.dispose()
  })

  it('continues version checks through dependencies installed synchronously by an upstream pull', () => {
    /** Controlled custom sources expose the supported pull and source-publication protocols. */
    const runtime = createRuntime()
    /** The same observer is retracked while its recorded versions are being inspected. */
    const controlled = createControlledObserver(runtime)
    /** Source metadata is assigned before either source can enter a dependency frame. */
    let firstBinding: IRuntimeSourceBinding
    /** The replacement source owns its version advancement through its canonical binding. */
    let secondBinding: IRuntimeSourceBinding
    /** Each check replaces the dependency only once when the first source is pulled. */
    let replaceOnPull = true
    /** Pulling the original dependency replaces the observer's complete live version map. */
    const first: IObservable = {
      runtime,
      get subs() {
        return firstBinding.subs
      },
      get version() {
        return firstBinding.version
      },
      pull() {
        if (!replaceOnPull) return
        replaceOnPull = false
        controlled.binding.runTracked(() => secondBinding.source.track())
      }
    }
    /** A replacement pull changes its version after the nested tracked read recorded it. */
    const second: IObservable = {
      runtime,
      get subs() {
        return secondBinding.subs
      },
      get version() {
        return secondBinding.version
      },
      pull() {
        secondBinding.source.commit(() => undefined)
      }
    }
    firstBinding = createSourceBinding(first)
    secondBinding = createSourceBinding(second)
    controlled.binding.runTracked(() => firstBinding.source.track())
    /** The replacement version is recorded before its own pull publishes a new version. */
    const beforeStaleCheck = second.version

    expect(controlled.binding.hasStaleDependencies()).toBe(true)

    expect([...controlled.binding.deps]).toEqual([second])
    expect([...controlled.binding.depVersions]).toEqual([[second, beforeStaleCheck]])
    expect(second.version).toBeGreaterThan(beforeStaleCheck)
    expect(first.subs.size).toBe(0)
    expect([...second.subs]).toEqual([controlled.observer])
    controlled.binding.runTracked(() => firstBinding.source.track())
    replaceOnPull = true
    /** Revalidation must inspect the newly inserted map entry under the same live-iteration rule. */
    const beforeRevalidation = second.version

    expect(controlled.binding.revalidate()).toBe(false)

    expect([...controlled.binding.deps]).toEqual([second])
    expect([...controlled.binding.depVersions]).toEqual([[second, beforeRevalidation]])
    expect(second.version).toBeGreaterThan(beforeRevalidation)
    expect(first.subs.size).toBe(0)
    expect([...second.subs]).toEqual([controlled.observer])
    controlled.dispose()
    firstBinding.source.dispose()
    secondBinding.source.dispose()
  })

  it('keeps dependency Set and version Map iterators live across topology replacement', () => {
    /** Read order after replacement intentionally revisits an already yielded dependency. */
    const runtime = internalRuntimeOf(createRuntime())
    /** This dependency is yielded before the tracked topology changes. */
    const first = runtime.signal(1)
    /** This dependency is removed before either iterator can reach it. */
    const removed = runtime.signal(2)
    /** A replacement source is appended before the retained dependency is read again. */
    const added = runtime.signal(3)
    /** Supported retracking owns both forward dependencies and their version view. */
    const controlled = createControlledObserver(runtime)
    controlled.binding.runTracked(() => {
      void first.value
      void removed.value
    })
    /** Both iterators begin before the graph replaces their live backing entries. */
    const deps = controlled.binding.deps.values()
    /** Native Map iteration must also observe the replacement insertion order. */
    const versions = controlled.binding.depVersions.entries()
    expect(deps.next().value).toBe(first)
    expect(versions.next().value).toEqual([first, first.version])
    controlled.binding.runTracked(() => {
      void added.value
      void first.value
    })
    expect([...deps]).toEqual([added, first])
    expect([...versions]).toEqual([
      [added, added.version],
      [first, first.version]
    ])
    expect([...controlled.binding.deps]).toEqual([added, first])
    expect([...controlled.binding.depVersions.keys()]).toEqual([added, first])
    controlled.dispose()
    first.dispose()
    removed.dispose()
    added.dispose()
  })

  it('visits a yielded subscriber again after its edge is deleted and appended again', () => {
    /** Subscriber iterators retain native Set delete-and-reinsert behavior. */
    const runtime = internalRuntimeOf(createRuntime())
    /** The same source owns every membership change in this traversal. */
    const source = runtime.signal(0)
    /** This observer is first yielded and later appended again. */
    const first = createControlledObserver(runtime)
    /** The unvisited second observer is deleted completely. */
    const removed = createControlledObserver(runtime)
    /** New membership is appended before first is reconnected. */
    const added = createControlledObserver(runtime)
    first.binding.runTracked(() => source.value)
    removed.binding.runTracked(() => source.value)
    /** An open iterator must observe future graph mutations rather than a copied array. */
    const iterator = source.subs.values()
    expect(iterator.next().value).toBe(first.observer)
    removed.binding.clear()
    added.binding.runTracked(() => source.value)
    first.binding.clear()
    first.binding.runTracked(() => source.value)
    expect([...iterator]).toEqual([added.observer, first.observer])
    expect([...source.subs]).toEqual([added.observer, first.observer])
    first.dispose()
    removed.dispose()
    added.dispose()
    source.dispose()
  })
})

describe('graph notification and static observer behavior', () => {
  it('retains notification entry membership and invalidates snapshots after every membership change', () => {
    /** Custom markDirty callbacks provide the supported synchronous reentrancy boundary. */
    const runtime = internalRuntimeOf(createRuntime())
    /** Each publication must use entry membership rather than a live diagnostic iterator. */
    const source = runtime.signal(0)
    /** Recorded callbacks distinguish the current entry snapshot from the next publication. */
    const sequence: string[] = []
    /** Only the first publication replaces membership during notification. */
    let changed = false
    /** The removed observer remains in the current notification's entry snapshot. */
    const second = createControlledObserver(runtime, () => sequence.push('second'))
    /** The new observer must wait until the next publication. */
    const late = createControlledObserver(runtime, () => sequence.push('late'))
    /** The first observer replaces subscriptions inside markDirty without bypassing the binding. */
    const first = createControlledObserver(runtime, () => {
      sequence.push('first')
      if (changed) return
      changed = true
      second.binding.clear()
      late.binding.runTracked(() => source.value)
    })
    first.binding.runTracked(() => source.value)
    second.binding.runTracked(() => source.value)
    source.value = 1
    expect(sequence).toEqual(['first', 'second'])
    expect([...source.subs]).toEqual([first.observer, late.observer])
    sequence.length = 0
    source.value = 2
    expect(sequence).toEqual(['first', 'late'])
    sequence.length = 0
    late.binding.clear()
    second.binding.runTracked(() => source.value)
    source.value = 3
    expect(sequence).toEqual(['first', 'second'])
    first.binding.clear()
    second.binding.clear()
    sequence.length = 0
    source.value = 4
    expect(sequence).toEqual([])
    first.binding.runTracked(() => source.value)
    source.value = 5
    expect(sequence).toEqual(['first'])
    first.dispose()
    second.dispose()
    late.dispose()
    source.dispose()
  })

  it('skips an effect disposed by an earlier notification and makes repeated disposal inert', () => {
    /** Real effects verify scheduler-facing disposal through the application API. */
    const runtime = internalRuntimeOf(createRuntime())
    /** Shared membership preserves first-before-second notification order. */
    const source = runtime.signal(0)
    /** The later effect is assigned before any effective update occurs. */
    let second: IReactiveEffect | undefined
    /** Only effective notification runs enter this sequence. */
    const sequence: string[] = []
    /** Cleanup counts distinguish initial cleanup, final cleanup, and duplicate disposal. */
    let firstCleanups = 0
    /** The disposed later observer must clean up its initial run exactly once. */
    let secondCleanups = 0
    /** Last-edge hooks must also remain idempotent. */
    let unobserved = 0
    source.addObservedHooks({
      onUnobserved: () => {
        unobserved++
      }
    })
    /** The first scheduled callback terminally removes the second pending callback. */
    const first = runtime.effect(() => {
      if (source.value > 0) {
        sequence.push('first')
        second?.dispose()
      }
      return () => {
        firstCleanups++
      }
    })
    second = runtime.effect(() => {
      if (source.value > 0) sequence.push('second')
      return () => {
        secondCleanups++
      }
    })
    source.value = 1
    expect(runtime.flush()).toBe('completed')
    expect(sequence).toEqual(['first'])
    expect(second.disposed).toBe(true)
    expect(source.subs.size).toBe(1)
    expect(secondCleanups).toBe(1)
    first.dispose()
    first.dispose()
    second.dispose()
    second.dispose()
    expect(firstCleanups).toBe(2)
    expect(secondCleanups).toBe(1)
    expect(unobserved).toBe(1)
    expect(source.subs.size).toBe(0)
    source.value = 2
    runtime.flush()
    expect(sequence).toEqual(['first'])
    source.dispose()
  })

  it('recomputes each diamond branch and sink once per effective batch', () => {
    /**
     * Diamond notifications must converge through the existing scheduler rather than duplicate sink
     * work.
     */
    const runtime = createRuntime()
    /** Both branches observe this one source version. */
    const source = runtime.signal(0)
    /** Per-node counters prove a single recomputation at each diamond level. */
    const calls = { left: 0, right: 0, sink: 0 }
    /** The left branch contributes the first deterministic derived offset. */
    const left = runtime.computed(() => {
      calls.left++
      return source.value + 1
    })
    /** The right branch reaches the same sink through an independent edge. */
    const right = runtime.computed(() => {
      calls.right++
      return source.value + 2
    })
    /** The sink must observe settled values from both branches exactly once. */
    const sink = runtime.computed(() => {
      calls.sink++
      return left.value + right.value
    })
    /** Public effect observations prove final values as well as computation counts. */
    const values: number[] = []
    /** One effect keeps the complete diamond actively observed. */
    const effect = runtime.effect(() => {
      values.push(sink.value)
    })
    expect(values).toEqual([3])
    expect(calls).toEqual({ left: 1, right: 1, sink: 1 })
    source.value = 1
    runtime.flush()
    expect(values).toEqual([3, 5])
    expect(calls).toEqual({ left: 2, right: 2, sink: 2 })
    runtime.batch(() => {
      source.value = 2
      source.value = 3
    })
    expect(values).toEqual([3, 5, 9])
    expect(calls).toEqual({ left: 3, right: 3, sink: 3 })
    effect.dispose()
    sink.dispose()
    left.dispose()
    right.dispose()
    source.dispose()
  })

  it('keeps static notifications untracked and consumes callback reentrant writes once', () => {
    /** The extension's static subscription is the same public seam used by store adapters. */
    const runtime = internalRuntimeOf(createRuntime())
    /** This node is the observer's one declared source. */
    const source = runtime.signal(0)
    /** Callback-only reads must never become additional dependency edges. */
    const incidental = runtime.signal(0)
    /** Stable notifications must reuse the admitted source rather than resolve it again. */
    let resolutions = 0
    /** Values are recorded before the callback's own reentrant write. */
    const values: number[] = []
    /** The stable source object keeps node identity and its tracked read together. */
    const selected = { node: source, read: () => source.value }
    /** Callback writes must commit the post-callback source version without another notification. */
    const observer = createStaticObserver(
      runtime,
      () => {
        resolutions++
        return selected
      },
      () => {
        void incidental.value
        values.push(source.peek())
        if (source.peek() === 1) source.value = 2
      }
    )
    expect(resolutions).toBe(1)
    source.value = 1
    runtime.flush()
    expect(values).toEqual([1])
    expect(source.peek()).toBe(2)
    expect(source.subs.size).toBe(1)
    expect(incidental.subs.size).toBe(0)
    incidental.value = 1
    runtime.flush()
    expect(values).toEqual([1])
    source.value = 3
    runtime.flush()
    expect(values).toEqual([1, 3])
    expect(resolutions).toBe(1)
    observer.dispose()
    observer.dispose()
    expect(source.subs.size).toBe(0)
    source.value = 4
    runtime.flush()
    expect(values).toEqual([1, 3])
    source.dispose()
    incidental.dispose()
  })

  it('reconnects an invalidated static route and notifies even when its replacement value is equal', () => {
    /**
     * Route invalidation uses the existing extension operation rather than disposing and recreating
     * the observer.
     */
    const runtime = internalRuntimeOf(createRuntime())
    /** The original route stays readable after its downstream edge is invalidated. */
    const original = runtime.signal(1)
    /** Equal values still require notification because graph identity changed. */
    const replacement = runtime.signal(1)
    /** Resolver selection changes only after the initial route is admitted. */
    let selected = original
    /** Resolution count distinguishes invalidation admission from stable-source ticks. */
    let resolutions = 0
    /** Every delivered callback reads the currently resolved route. */
    const values: number[] = []
    /** The observer must reconnect through its normal forced-resolution path. */
    const observer = createStaticObserver(
      runtime,
      () => {
        resolutions++
        return { node: selected, read: () => selected.value }
      },
      () => {
        values.push(selected.peek())
      }
    )
    expect(original.subs.size).toBe(1)
    selected = replacement
    invalidateObservable(runtime, original)
    runtime.flush()
    expect(values).toEqual([1])
    expect(resolutions).toBe(2)
    expect(original.subs.size).toBe(0)
    expect(replacement.subs.size).toBe(1)
    replacement.value = 2
    runtime.flush()
    expect(values).toEqual([1, 2])
    expect(resolutions).toBe(2)
    observer.dispose()
    observer.dispose()
    expect(replacement.subs.size).toBe(0)
    original.dispose()
    replacement.dispose()
  })
})
