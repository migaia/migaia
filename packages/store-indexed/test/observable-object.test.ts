import { describe, expect, it } from 'vitest'
import { createRuntime, defaultRuntime } from '@migaia/reactive'
import { ObservableObject, observableObject } from '../src'

describe('ObservableObject', () => {
  it('reads initial values from the constructor', () => {
    const obj = new ObservableObject({ a: 1, b: 'x' })
    expect(obj.peek('a')).toBe(1)
    expect(obj.peek('b')).toBe('x')
    obj.dispose()
  })

  it('get() is fine-grained: an effect on one key does not rerun when a sibling key changes', () => {
    const obj = new ObservableObject({ a: 1, b: 2 })
    let runsA = 0
    const disposeEffect = defaultRuntime.effect(() => {
      obj.get('a')
      runsA++
    })
    expect(runsA).toBe(1)

    obj.set('b', 20)
    expect(runsA).toBe(1) // unrelated key: no rerun

    obj.set('a', 10)
    expect(runsA).toBe(2) // tracked key changed: rerun

    disposeEffect()
    obj.dispose()
  })

  it('peek() never establishes a dependency', () => {
    const obj = new ObservableObject({ a: 1 })
    let runs = 0
    const disposeEffect = defaultRuntime.effect(() => {
      obj.peek('a')
      runs++
    })
    expect(runs).toBe(1)

    obj.set('a', 999)
    expect(runs).toBe(1)

    disposeEffect()
    obj.dispose()
  })

  it('has() tracks the structure signal, not the value: reruns only on key add/remove', () => {
    const obj = new ObservableObject<Record<string, unknown>>({ a: 1 })
    let runs = 0
    const disposeEffect = defaultRuntime.effect(() => {
      obj.has('a')
      runs++
    })
    expect(runs).toBe(1)

    obj.set('a', 2) // value-only change on an existing key: structure untouched
    expect(runs).toBe(1)

    obj.set('newKey', 1) // key added: structure bumped
    expect(runs).toBe(2)

    obj.delete('newKey') // key removed: structure bumped
    expect(runs).toBe(3)

    disposeEffect()
    obj.dispose()
  })

  it('set() skips the revision bump when the value is Object.is-equal', () => {
    const obj = new ObservableObject({ a: 1 })
    let runs = 0
    const disposeEffect = defaultRuntime.effect(() => {
      obj.snapshot()
      runs++
    })
    expect(runs).toBe(1)

    obj.set('a', 1) // same value
    expect(runs).toBe(1)

    obj.set('a', 2)
    expect(runs).toBe(2)

    disposeEffect()
    obj.dispose()
  })

  it('update() applies set(key, updater(peek(key)))', () => {
    const obj = new ObservableObject({ count: 1 })
    obj.update('count', (v) => v + 1)
    expect(obj.peek('count')).toBe(2)
    obj.dispose()
  })

  it('delete() returns false and triggers nothing for a missing key', () => {
    const obj = new ObservableObject<Record<string, unknown>>({ a: 1 })
    let runs = 0
    const disposeEffect = defaultRuntime.effect(() => {
      obj.snapshot()
      runs++
    })
    expect(runs).toBe(1)

    expect(obj.delete('missing')).toBe(false)
    expect(runs).toBe(1)

    disposeEffect()
    obj.dispose()
  })

  it('delete() reports the key as absent to a still-subscribed reader instead of vanishing silently', () => {
    const obj = new ObservableObject<{ a: number }>({ a: 1 })
    const seen: (number | undefined)[] = []
    const disposeEffect = defaultRuntime.effect(() => {
      seen.push(obj.get('a'))
    })
    expect(seen).toEqual([1])

    expect(obj.delete('a')).toBe(true)
    expect(seen).toEqual([1, undefined])

    disposeEffect()
    obj.dispose()
  })

  it('keys() tracks structure and reflects the current key set', () => {
    const obj = new ObservableObject<Record<string, unknown>>({ a: 1, b: 2 })
    expect([...obj.keys()].sort()).toEqual(['a', 'b'])
    obj.delete('a')
    expect(obj.keys()).toEqual(['b'])
    obj.dispose()
  })

  it('snapshot() returns a frozen, null-prototype copy that keeps __proto__ as a plain data key', () => {
    const poisoned = Object.fromEntries([['__proto__', 'poison']]) as Record<string, unknown>
    const obj = new ObservableObject(poisoned)

    const snap = obj.snapshot()
    expect(Object.getPrototypeOf(snap)).toBe(null)
    expect(Object.isFrozen(snap)).toBe(true)
    expect((snap as Record<string, unknown>).__proto__).toBe('poison')

    obj.dispose()
  })

  it('snapshot() is a point-in-time copy unaffected by later writes', () => {
    const obj = new ObservableObject({ a: 1 })
    const snap = obj.snapshot()
    obj.set('a', 2)
    expect(snap.a).toBe(1)
    expect(obj.peek('a')).toBe(2)
    obj.dispose()
  })

  it('replace() deletes missing keys and sets new ones in a single batched notification', () => {
    const obj = new ObservableObject<Record<string, unknown>>({ a: 1, b: 2 })
    let runs = 0
    const disposeEffect = defaultRuntime.effect(() => {
      obj.snapshot()
      runs++
    })
    expect(runs).toBe(1)

    obj.replace({ b: 3, c: 4 })

    expect(runs).toBe(2) // one notification, not one per removed/added/changed key
    expect(obj.has('a')).toBe(false)
    expect(obj.peek('b')).toBe(3)
    expect(obj.peek('c')).toBe(4)
    expect([...obj.keys()].sort()).toEqual(['b', 'c'])

    disposeEffect()
    obj.dispose()
  })

  it('prune() never reclaims a cell that still has an active observer', () => {
    const obj = new ObservableObject<{ a: number }>({ a: 1 })
    const disposeEffect = defaultRuntime.effect(() => {
      obj.get('a')
    })

    obj.delete('a') // cell persists: the effect above is still watching it
    expect(obj.prune()).toBe(0)

    disposeEffect()
    obj.dispose()
  })

  it('dispose() makes every subsequent call throw, and is idempotent', () => {
    const obj = new ObservableObject<{ a: number }>({ a: 1 }, defaultRuntime, {
      debugName: 'myObj'
    })
    obj.dispose()
    expect(obj.disposed).toBe(true)

    expect(() => obj.get('a')).toThrow('[store] myObj is disposed')
    expect(() => obj.peek('a')).toThrow('[store] myObj is disposed')
    expect(() => obj.has('a')).toThrow('[store] myObj is disposed')
    expect(() => obj.set('a', 2)).toThrow('[store] myObj is disposed')
    expect(() => obj.delete('a')).toThrow('[store] myObj is disposed')
    expect(() => obj.keys()).toThrow('[store] myObj is disposed')
    expect(() => obj.snapshot()).toThrow('[store] myObj is disposed')
    expect(() => obj.replace({ a: 1 })).toThrow('[store] myObj is disposed')
    expect(() => obj.prune()).toThrow('[store] myObj is disposed')

    expect(() => obj.dispose()).not.toThrow()
  })

  it('mutationGuard is consulted on writes with the documented operation string, and never on reads', () => {
    const calls: (string | undefined)[] = []
    const obj = new ObservableObject<{ a: number }>({ a: 1 }, defaultRuntime, {
      mutationGuard: {
        assertMutationAllowed(operation) {
          calls.push(operation)
        }
      },
      debugName: 'guarded'
    })

    obj.get('a')
    obj.peek('a')
    obj.has('a')
    obj.keys()
    obj.snapshot()
    expect(calls).toEqual([]) // reads never consult the guard

    obj.set('a', 2)
    expect(calls).toEqual(['guarded.set(a)'])

    obj.delete('a')
    expect(calls).toEqual(['guarded.set(a)', 'guarded.delete(a)'])

    obj.dispose()
  })

  it('a throwing mutationGuard blocks the write and leaves state unchanged', () => {
    const obj = new ObservableObject<{ a: number }>({ a: 1 }, defaultRuntime, {
      mutationGuard: {
        assertMutationAllowed() {
          throw new Error('not in an action')
        }
      }
    })

    expect(() => obj.set('a', 2)).toThrow('not in an action')
    expect(obj.peek('a')).toBe(1)

    obj.dispose()
  })

  it('update() guards before invoking a hostile updater or allowing reentrant mutation', () => {
    const sideEffect = new ObservableObject({ value: 1 })
    let updaterCalls = 0
    const obj = new ObservableObject({ value: 1 }, defaultRuntime, {
      mutationGuard: {
        assertMutationAllowed() {
          throw new Error('not in an action')
        }
      }
    })

    expect(() =>
      obj.update('value', (value) => {
        updaterCalls++
        sideEffect.set('value', 2)
        return value + 1
      })
    ).toThrow('not in an action')
    expect(updaterCalls).toBe(0)
    expect(obj.peek('value')).toBe(1)
    expect(sideEffect.peek('value')).toBe(1)

    sideEffect.dispose()
    obj.dispose()
  })

  it('rejects a tracked read from a different Runtime, but allows peek() across Runtimes', () => {
    // A second, independent Runtime from the *same* module copy — this is the "same library,
    // two isolated graphs" scenario the cross-runtime guard exists for. Force-loading a second
    // copy of the module via `require()` tests something else entirely (COPY_CONFLICT, a
    // different guard with a different error), so it must not be used here.
    const otherRuntime = createRuntime()
    const obj = new ObservableObject<{ a: number }>({ a: 1 }, otherRuntime)

    expect(() =>
      defaultRuntime.effect(() => {
        obj.get('a')
      })
    ).toThrow('[store] cross-runtime dependency is not allowed')

    // peek() is an explicit non-tracked read: no cross-runtime restriction applies.
    expect(obj.peek('a')).toBe(1)

    obj.dispose()
  })

  it('observableObject() factory takes (initial, options, runtime), distinct from the class constructor order', () => {
    const obj = observableObject({ a: 1 }, { debugName: 'factoryObj' })
    expect(obj.peek('a')).toBe(1)
    obj.dispose()
    expect(() => obj.peek('a')).toThrow('[store] factoryObj is disposed')
  })
})
