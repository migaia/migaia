import { describe, expect, it } from 'vitest'
import { createRuntime } from '../src/index.ts'
import {
  createSourceBinding,
  internalRuntimeOf,
  type IRuntimeSourceBinding,
  type IObservable
} from '../src/entry/extension.ts'
import { createControlledObserver } from './link-edge-views.fixture.ts'

/**
 * Groups the native live-iterator contract across reentrant edge changes; individual cases are
 * independent and share no mutable setup.
 */
describe('live readonly graph collection behavior', () => {
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
