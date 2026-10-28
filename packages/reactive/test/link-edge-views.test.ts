import { describe, expect, it } from 'vitest'
import { createRuntime } from '../src/index.ts'
import { internalRuntimeOf, type IObservable, type IObserver } from '../src/entry/extension.ts'
import { createControlledObserver, type IForEachContext } from './link-edge-views.fixture.ts'

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
})
