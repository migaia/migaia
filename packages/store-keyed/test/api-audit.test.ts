import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import {
  atomDef,
  atomDefFactory,
  createAtomStore,
  focusDef,
  splitDef,
  isAtomDefinition,
  derivedDef
} from '../src/index.js'
import { readOpticPath, writeOpticPath } from '../src/atom/optics-path.js'

describe('store-keyed audit regressions', () => {
  it.each([-0, +0])(
    'SK-D01 uses the cache key relation when a signed-zero source is replaced',
    (key) => {
      /** The source always contains exactly one supported numeric key. */
      const source = atomDef<readonly { key: number; text: string }[]>([{ key, text: 'old' }])
      /** Map-backed token reuse must agree with lookup, write and removal. */
      const split = splitDef(source, (item) => item.key)
      /** A registered real Runtime owns the complete graph. */
      const store = createAtomStore(createRuntime())
      try {
        /** Keep the original token across the normal source replacement. */
        const token = split.of(key)
        expect(store.get(token).text).toBe('old')
        store.set(source, [{ key: -key, text: 'new' }])
        expect(split.of(-key)).toBe(token)
        expect(store.get(token).text).toBe('new')
        store.set(token, (value) => ({ ...value, text: 'written' }))
        expect(store.get(source)[0].text).toBe('written')
        expect(split.remove(store, key)).toBe(true)
        expect(store.get(source)).toEqual([])
      } finally {
        store.dispose()
      }
    }
  )

  it('SK-D02 reuses the hoisted focus definition from the maintained example', () => {
    /** Define tokens once, outside all reevaluating read callbacks. */
    const source = atomDef({ todos: [{ done: false }] })
    /** A stable focus belongs to this blueprint rather than each evaluation. */
    const todos = focusDef(source, 'todos')
    /** This is the corrected documented composition. */
    const active = derivedDef((get) => get(todos).filter((item) => !item.done))
    /** Public size observes actual store-owned instances. */
    const store = createAtomStore(createRuntime())
    try {
      store.get(active)
      for (let index = 0; index < 3; index++) {
        store.set(source, { todos: [{ done: index % 2 === 0 }] })
        store.get(active)
        expect(store.size).toBe(3)
      }
    } finally {
      store.dispose()
    }
  })

  it.each([false, true])('SK-D03 retains the original getter failure with frozen=%s', (frozen) => {
    /** Native mutable failures retain identity; frozen failures must remain on the cause chain. */
    const primary = new TypeError('application getter failed')
    if (frozen) Object.freeze(primary)
    /** Factories preserve application accessors without cloning the template. */
    const source = atomDefFactory(() => ({
      get item(): number {
        throw primary
      }
    }))
    /** The public focus path is the actual failing package boundary. */
    const focused = focusDef(source, 'item')
    /** An independent graph contains this failure. */
    const store = createAtomStore(createRuntime({ onError: () => {} }))
    try {
      try {
        store.get(focused)
        throw new Error('expected getter failure')
      } catch (error) {
        expect(error).toMatchObject({ source: '@migaia/store-keyed', code: 'OPTIC_ACCESS_FAILED' })
        if (frozen) expect((error as Error).cause).toBe(primary)
        else {
          expect(error).toBe(primary)
          expect(error).toBeInstanceOf(TypeError)
        }
      }
    } finally {
      store.dispose()
    }
  })

  it('SK-D03 rejects an unreadable unknown definition brand without throwing', () => {
    /** Revocation is a supported unknown input, with no fabricated private brand. */
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(isAtomDefinition(revoked.proxy)).toBe(false)
  })
  it.each(['read', 'write'] as const)(
    'SK-D03 classifies direct public optic %s access failures',
    (operation) => {
      /** This native error crosses the pure helper directly, without Reactive's callback boundary. */
      const primary = new Error('direct getter failed')
      /** Both get and immutable object copying can invoke application getters. */
      const source = {
        get item(): number {
          throw primary
        }
      }
      expect(() =>
        operation === 'read'
          ? readOpticPath(source, ['item'], 'audit')
          : writeOpticPath(source, ['item'], 1, 'audit')
      ).toThrow(primary)
      expect(primary).toMatchObject({ source: '@migaia/store-keyed', code: 'OPTIC_ACCESS_FAILED' })
    }
  )
})
