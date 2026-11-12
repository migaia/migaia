import { describe, expect, it } from 'vitest'
import { createStoreRegistry, createStoreToken } from '../src/provider-registry.ts'
import { normalizeStoreConfig } from '../src/store-config.ts'

/** Captures a thrown value. */
function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

/** Error with a complete own identity, which must pass through unchanged. */
const coded = Object.assign(new Error('coded'), { source: 'app', code: 'APP_FAILED' })

describe('store-react option read failures', () => {
  it('passes a coded ready-slot failure through and codes an uncoded one', () => {
    const throwingSlot = (failure: unknown) =>
      new Proxy([], {
        get(target, key, receiver) {
          if (key === '0') throw failure
          if (key === 'length') return 1
          return Reflect.get(target, key, receiver)
        }
      })
    expect(thrownBy(() => normalizeStoreConfig({ ready: throwingSlot(coded) }))).toBe(coded)
    const plain = new Error('plain')
    expect(thrownBy(() => normalizeStoreConfig({ ready: throwingSlot(plain) }))).toMatchObject({
      code: 'INVALID_CONFIG',
      cause: plain
    })
  })

  it('passes a coded ownership getter failure through and codes an uncoded one', () => {
    const registry = createStoreRegistry()
    const token = createStoreToken<number>('value')
    const owned = (failure: unknown) => ({
      get owned(): boolean {
        throw failure
      }
    })
    expect(thrownBy(() => registry.register(token, 1, owned(coded)))).toBe(coded)
    const plain = new Error('plain')
    expect(thrownBy(() => registry.replace(token, 1, owned(plain)))).toMatchObject({
      code: 'INVALID_CONFIG',
      cause: plain
    })
    registry.dispose()
  })
})
