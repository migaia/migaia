import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import {
  atomDef,
  createAtomStore,
  focusDef,
  opticDef,
  selectDef,
  splitDef,
  type IDefOptic,
  type IStandardWritableDef
} from '../src'

describe('selectDef', () => {
  it('projects a read-only slice and defaults to Object.is equality', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef({ id: 1, noise: 0 })
    const idOnly = selectDef(source, (value) => value.id)
    const onChange = vi.fn()
    const unsubscribe = store.sub(idOnly, onChange)
    store.set(source, (previous: { id: number; noise: number }) => ({
      ...previous,
      noise: previous.noise + 1
    }))
    expect(onChange).not.toHaveBeenCalled()
    store.set(source, (previous: { id: number; noise: number }) => ({ ...previous, id: 2 }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(store.get(idOnly)).toBe(2)
    unsubscribe()
    store.dispose()
  })

  it('accepts a custom equals comparator', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef({ tags: ['a'] })
    const tags = selectDef(
      source,
      (value) => value.tags,
      (left, right) => left.length === right.length
    )
    const onChange = vi.fn()
    const unsubscribe = store.sub(tags, onChange)
    store.set(source, () => ({ tags: ['b'] })) // different ref, same length -> equals true
    expect(onChange).not.toHaveBeenCalled()
    store.set(source, () => ({ tags: ['b', 'c'] }))
    expect(onChange).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.dispose()
  })
})

describe('opticDef', () => {
  it('reads/writes through a custom lens and skips a no-op write', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef({ celsius: 0 })
    const fahrenheit: IDefOptic<{ celsius: number }, number> = {
      get: (value) => (value.celsius * 9) / 5 + 32,
      set: (value, focus) => ({ celsius: ((focus - 32) * 5) / 9 })
    }
    const fahrenheitDef = opticDef(source, fahrenheit)
    expect(store.get(fahrenheitDef)).toBe(32)
    store.set(fahrenheitDef, 212)
    expect(store.get(source).celsius).toBe(100)
  })

  it('skips writing the source when the computed next focus is unchanged (Object.is)', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef({ value: 5 })
    const identity: IDefOptic<{ value: number }, number> = {
      get: (value) => value.value,
      set: (value, focus) => ({ value: focus })
    }
    const focusedDef = opticDef(source, identity)
    const onChange = vi.fn()
    const unsubscribe = store.sub(source, onChange)
    store.set(focusedDef, 5) // same value -> no write
    expect(onChange).not.toHaveBeenCalled()
    store.set(focusedDef, 6)
    expect(onChange).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.dispose()
  })
})

describe('focusDef', () => {
  it('reads and writes a one-level path without mutating the original object', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef({ name: 'ada' })
    const original = store.get(source)
    const nameDef = focusDef(source, 'name')
    expect(store.get(nameDef)).toBe('ada')
    store.set(nameDef, 'grace')
    expect(store.get(nameDef)).toBe('grace')
    expect(original.name).toBe('ada') // original object untouched
    store.dispose()
  })

  it('reads and writes a nested two-level path', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef({ user: { name: 'ada' } })
    const nameDef = focusDef(source, 'user', 'name')
    store.set(nameDef, (previous) => previous.toUpperCase())
    expect(store.get(nameDef)).toBe('ADA')
    expect(store.get(source).user.name).toBe('ADA')
    store.dispose()
  })

  it('reads and writes a three-level path', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef({ a: { b: { c: 1 } } })
    const cDef = focusDef(source, 'a', 'b', 'c')
    store.set(cDef, 2)
    expect(store.get(source).a.b.c).toBe(2)
    store.dispose()
  })

  it('preserves sibling fields when writing a nested path', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef({ user: { name: 'ada', age: 30 } })
    const nameDef = focusDef(source, 'user', 'name')
    store.set(nameDef, 'grace')
    expect(store.get(source).user).toEqual({ name: 'grace', age: 30 })
    store.dispose()
  })

  it('throws when called with no path segments', () => {
    const source = atomDef({ a: 1 })
    // @ts-expect-error -- 0 path segments is a runtime error case, not part of the typed focusDef API
    expect(() => focusDef(source as never)).toThrow(
      '[store] focusDef requires at least one path segment'
    )
  })

  it('throws TypeError reading through a null/non-object mid-path', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<{ a: { b: number } | null }>({ a: null })
    const bDef = focusDef(source as unknown as IStandardWritableDef<{ a: { b: number } }>, 'a', 'b')
    expect(() => store.get(bDef)).toThrow(TypeError)
    expect(() => store.get(bDef)).toThrow(/focusDef cannot read path segment/)
    store.dispose()
  })

  it('throws TypeError writing through a null/non-object mid-path', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<{ a: { b: number } | null }>({ a: null })
    const bDef = focusDef(source as unknown as IStandardWritableDef<{ a: { b: number } }>, 'a', 'b')
    // `opticDef`'s write handler reads the current focus first (`optic.get(currentSource)`) to
    // short-circuit a no-op write via `Object.is` — that read always walks the exact same path
    // prefix `writeOpticPath` would, so for a nested focus it fails with the *read* message
    // before `optic.set()` (and `writeOpticPath`'s own "cannot write" guard) is ever reached.
    expect(() => store.set(bDef, 1)).toThrow(TypeError)
    expect(() => store.set(bDef, 1)).toThrow(/focusDef cannot read path segment/)
    store.dispose()
  })

  it('writes an array element without mutating the source array', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef({ items: [1, 2, 3] })
    const original = store.get(source).items
    const itemDef = focusDef(source, 'items', 0)
    store.set(itemDef, 99)
    expect(store.get(source).items).toEqual([99, 2, 3])
    expect(original).toEqual([1, 2, 3])
    store.dispose()
  })

  it('safely handles a "__proto__" path segment without polluting the prototype chain', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<Record<string, unknown>>({ own: 1 })
    const protoDef = focusDef(source, '__proto__')
    store.set(protoDef, { polluted: true })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    const next = store.get(source)
    expect(Object.hasOwn(next, '__proto__')).toBe(true)
    expect((next as { __proto__: unknown }).__proto__).toEqual({ polluted: true })
    expect(next.own).toBe(1)
    store.dispose()
  })
})

describe('splitDef', () => {
  type ITodo = { readonly id: string; readonly text: string; readonly done: boolean }
  const keyOf = (todo: ITodo) => todo.id

  it('of(key) always returns the same token for the same key', () => {
    const source = atomDef<readonly ITodo[]>([])
    const split = splitDef(source, keyOf)
    expect(split.of('a')).toBe(split.of('a'))
  })

  it('insert() appends by default, and reads/writes route through of(key)', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<readonly ITodo[]>([])
    const split = splitDef(source, keyOf)
    split.insert(store, { id: 't1', text: 'a', done: false })
    split.insert(store, { id: 't2', text: 'b', done: false })
    expect(store.get(source).map((todo) => todo.id)).toEqual(['t1', 't2'])
    const item = split.of('t1')
    store.set(item, (previous) => ({ ...previous, done: true }))
    expect(store.get(source)[0].done).toBe(true)
    store.dispose()
  })

  it('insert() clamps an out-of-range index into [0, length]', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<readonly ITodo[]>([{ id: 'a', text: '', done: false }])
    const split = splitDef(source, keyOf)
    split.insert(store, { id: 'b', text: '', done: false }, -5)
    expect(store.get(source).map((todo) => todo.id)).toEqual(['b', 'a'])
    split.insert(store, { id: 'c', text: '', done: false }, 999)
    expect(store.get(source).map((todo) => todo.id)).toEqual(['b', 'a', 'c'])
    store.dispose()
  })

  it('remove() reports whether an element was actually removed', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<readonly ITodo[]>([{ id: 'a', text: '', done: false }])
    const split = splitDef(source, keyOf)
    expect(split.remove(store, 'missing')).toBe(false)
    expect(split.remove(store, 'a')).toBe(true)
    expect(store.get(source)).toEqual([])
    store.dispose()
  })

  it('of(key) read throws once the key has been removed from the source', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<readonly ITodo[]>([{ id: 'a', text: '', done: false }])
    const split = splitDef(source, keyOf)
    const item = split.of('a')
    split.remove(store, 'a')
    expect(() => store.get(item)).toThrow('[store] split def item was removed')
    store.dispose()
  })

  it('of(key) write throws once the key has been removed from the source', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<readonly ITodo[]>([{ id: 'a', text: '', done: false }])
    const split = splitDef(source, keyOf)
    const item = split.of('a')
    split.remove(store, 'a')
    expect(() => store.set(item, (previous) => previous)).toThrow(
      '[store] cannot write a removed split def item'
    )
    store.dispose()
  })

  it('items derived def keeps identity stable across unrelated reorders and rejects duplicate keys', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<readonly ITodo[]>([
      { id: 'a', text: '', done: false },
      { id: 'b', text: '', done: false }
    ])
    const split = splitDef(source, keyOf)
    const first = store.get(split.items)
    const second = store.get(split.items)
    expect(second).toBe(first) // shallowArrayEquals -> same identity, no recompute notification
    expect(first).toEqual([split.of('a'), split.of('b')])

    store.set(source, [
      { id: 'a', text: '', done: false },
      { id: 'a', text: '', done: false }
    ])
    expect(() => store.get(split.items)).toThrow('[store] splitDef keys must be unique')
    store.dispose()
  })

  it('prune() clears only its own key->token cache, not AtomStore instances', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<readonly ITodo[]>([{ id: 'a', text: '', done: false }])
    const split = splitDef(source, keyOf)
    const item = split.of('a')
    store.get(item) // materialize an AtomStore instance for this item
    split.remove(store, 'a')
    expect(split.prune(store)).toBe(1)
    expect(split.prune(store)).toBe(0) // idempotent, nothing left to prune
    // AtomStore instance is untouched by prune(): explicit release is required.
    expect(store.release(item)).toBe(true)
    store.dispose()
  })

  it('defaults keyOf to the array index when omitted', () => {
    const store = createAtomStore(createRuntime())
    const source = atomDef<readonly string[]>(['x', 'y'])
    const split = splitDef(source)
    expect(store.get(split.of(0))).toBe('x')
    expect(store.get(split.of(1))).toBe('y')
    store.dispose()
  })
})
