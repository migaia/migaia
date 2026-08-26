/* oxlint-disable unicorn/no-thenable -- adversarial fixtures verify thenable admission. */
import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { atomDef, atomDefFactory, createAtomStore, previewSafeAtomDefFactory } from '../src'

/**
 * SDD §3.5: atomDef/atomDefFactory must reject thenable return values at runtime instead of
 * silently storing an unresolved Promise as the atom's value. These cases previously passed
 * typecheck and ran without error.
 */
describe('thenable guard', () => {
  describe('atomDef', () => {
    it('throws a TypeError synchronously when init is a thenable', () => {
      const pending = Promise.resolve(42)
      expect(() => atomDef(pending)).toThrow(TypeError)
      expect(() => atomDef(pending)).toThrow(/@migaia\/resource/)
    })

    it('still accepts a plain, non-thenable init', () => {
      expect(() => atomDef(42)).not.toThrow()
    })

    it('contains a hostile then getter with one read and the original cause', () => {
      const failure = new Error('then getter failed')
      let reads = 0
      const hostile = Object.defineProperty({}, 'then', {
        get() {
          reads++
          throw failure
        }
      })
      expect(() => atomDef(hostile)).toThrow(
        expect.objectContaining({
          source: '@migaia/store-keyed',
          code: 'INVALID_OPTION',
          cause: failure
        })
      )
      expect(reads).toBe(1)
    })

    it('rejects callable thenables instead of storing them as sync values', () => {
      const callable = Object.assign(() => 42, {
        then: () => undefined
      })
      expect(() => atomDef(callable)).toThrow(
        expect.objectContaining({ source: '@migaia/store-keyed', code: 'INVALID_OPTION' })
      )
    })
  })

  describe('atomDefFactory', () => {
    it('does not validate at registration time (create has not run yet)', () => {
      // create() is a deferred function; atomDefFactory cannot know its
      // return value until the AtomStore actually invokes it.
      expect(() => atomDefFactory(async () => 42)).not.toThrow()
    })

    it('throws a TypeError the moment the store instantiates via get()', () => {
      const def = atomDefFactory(async () => 42)
      const store = createAtomStore(createRuntime())
      try {
        expect(() => store.get(def)).toThrow(TypeError)
        expect(() => store.get(def)).toThrow(/@migaia\/resource/)
      } finally {
        store.dispose()
      }
    })

    it('throws a TypeError the moment the store instantiates via peek()', () => {
      const def = atomDefFactory(async () => 'hello')
      const store = createAtomStore(createRuntime())
      try {
        expect(() => store.peek(def)).toThrow(TypeError)
      } finally {
        store.dispose()
      }
    })

    it('throws a TypeError when a preview-safe factory resolves via preview()', () => {
      const def = previewSafeAtomDefFactory(async () => 'hello')
      const store = createAtomStore(createRuntime())
      try {
        expect(() => store.preview(def)).toThrow(TypeError)
      } finally {
        store.dispose()
      }
    })

    it('still accepts a factory that returns a plain value', () => {
      const def = atomDefFactory(() => 7)
      const store = createAtomStore(createRuntime())
      try {
        expect(store.get(def)).toBe(7)
      } finally {
        store.dispose()
      }
    })
  })
})
