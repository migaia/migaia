import { describe, expect, it, vi } from 'vitest'
import {
  assertStoreFeature,
  decodeStoreExperimental,
  encodeStoreExperimental,
  normalizeStoreConfig,
  readStoreFeature,
  type IStoreConfigValue,
  type IStoreFeatureExperimental
} from '../src/store-config'

describe('normalizeStoreConfig', () => {
  it('rejects invalid ready containers and barrier values at the public boundary', () => {
    expect(() => normalizeStoreConfig({ ready: null as never })).toThrow(
      'config.ready must be an array'
    )
    expect(() => normalizeStoreConfig({ ready: [42 as never] })).toThrow(
      'config.ready must be an array'
    )
    const hostile = {}
    Object.defineProperty(hostile, ['th' + 'en'].join(''), {
      get: () => {
        throw new Error('hostile then getter')
      }
    })
    expect(() => normalizeStoreConfig({ ready: [hostile as never] })).toThrow(
      'config.ready must be an array'
    )
  })

  it('contains revoked config proxies as tagged configuration errors', () => {
    const { proxy, revoke } = Proxy.revocable({ features: { wasm: true } }, {})
    revoke()
    try {
      normalizeStoreConfig(proxy as never)
      throw new Error('expected config normalization to fail')
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-react',
        code: 'INVALID_CONFIG',
        cause: expect.any(TypeError)
      })
    }
  })

  it('defaults to wasm off, no experimental flags, no ready barrier when called with no config', () => {
    const normalized = normalizeStoreConfig()

    expect(normalized.features.wasm).toBe(false)
    expect(normalized.features.experimental).toEqual({})
    expect(normalized.defaults.warnAsyncActions).toBe(false)
    expect(normalized.ready).toBeNull()
  })

  it('normalizes ready barriers (Promise and zero-arg factory) into a single tracked promise', async () => {
    const events: string[] = []
    const promiseBarrier = Promise.resolve().then(() => events.push('promise-settled'))
    const factoryBarrier = () => {
      events.push('factory-called')
      return Promise.resolve()
    }

    const normalized = normalizeStoreConfig({ ready: [promiseBarrier, factoryBarrier] })

    expect(normalized.ready).not.toBeNull()
    expect(normalized.ready!.status()).toBe('pending')
    await normalized.ready!.promise
    expect(normalized.ready!.status()).toBe('ready')
    expect(events).toContain('promise-settled')
    expect(events).toContain('factory-called')
  })

  it('injects a local rejecting barrier when features.wasm is true but ready is empty (README §8.2)', async () => {
    const normalized = normalizeStoreConfig({ features: { wasm: true } })

    expect(normalized.ready).not.toBeNull()
    await expect(normalized.ready!.promise).rejects.toThrow(
      /features\.wasm is true but config\.ready is empty/
    )
    expect(normalized.ready!.status()).toBe('error')
    expect((normalized.ready!.error() as Error).message).toMatch(/ensureWasm/)
  })

  it('does not inject the synthetic wasm barrier when a real ready barrier is supplied', () => {
    const normalized = normalizeStoreConfig({
      features: { wasm: true },
      ready: [Promise.resolve()]
    })

    // Only the caller-supplied barrier drives readiness; no local wasm-guard rejection.
    return expect(normalized.ready!.promise).resolves.toBeUndefined()
  })

  it('caches the ready promise per barrier-list identity within the same scope', () => {
    const scope = {}
    const barriers = [Promise.resolve()] as const

    const first = normalizeStoreConfig({ ready: barriers }, scope)
    const second = normalizeStoreConfig({ ready: barriers }, scope)

    expect(first.ready!.promise).toBe(second.ready!.promise)
    expect(first.ready).toBe(second.ready)
  })

  it('does not share ready promises across different scopes even with the same barrier list', () => {
    const barriers = [Promise.resolve()] as const

    const first = normalizeStoreConfig({ ready: barriers }, {})
    const second = normalizeStoreConfig({ ready: barriers }, {})

    expect(first.ready!.promise).not.toBe(second.ready!.promise)
  })

  it('runs a factory barrier at most once per scope (idempotent, not re-invoked on re-normalize)', async () => {
    const scope = {}
    const factory = vi.fn(() => Promise.resolve())
    const barriers = [factory] as const

    normalizeStoreConfig({ ready: barriers }, scope)
    const second = normalizeStoreConfig({ ready: barriers }, scope)
    await second.ready!.promise

    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('preserves defaults.warnAsyncActions only as a snapshot flag', () => {
    const normalized = normalizeStoreConfig({ defaults: { warnAsyncActions: true } })
    expect(normalized.defaults.warnAsyncActions).toBe(true)
  })
})

describe('encodeStoreExperimental / decodeStoreExperimental', () => {
  it('round-trips a flag map', () => {
    const encoded = encodeStoreExperimental({ betaUi: true, offlineMode: false })
    const decoded = decodeStoreExperimental(encoded)
    expect(decoded).toEqual({ betaUi: true, offlineMode: false })
  })

  it('produces identical encodings regardless of key insertion order (sorted-tuple canonicalization)', () => {
    const a = encodeStoreExperimental({ zeta: true, alpha: false })
    const b = encodeStoreExperimental({ alpha: false, zeta: true })
    expect(a).toBe(b)
  })

  it('encodes undefined input as an empty-list marker and decodes back to an empty object', () => {
    expect(encodeStoreExperimental(undefined)).toBe('[]')
    expect(decodeStoreExperimental('[]')).toEqual({})
  })

  it('ignores non-enumerable and accessor (getter) properties on the input', () => {
    const input: Record<string, boolean> = {}
    Object.defineProperty(input, 'hidden', { value: true, enumerable: false })
    Object.defineProperty(input, 'computed', { get: () => true, enumerable: true })
    input.plain = true

    const decoded = decodeStoreExperimental(encodeStoreExperimental(input))
    expect(decoded).toEqual({ plain: true })
  })

  it('decodes onto a null-prototype object so "__proto__" stays an inert own key', () => {
    // Computed key bypasses the object-literal `__proto__` special case, producing a genuine
    // own data property named "__proto__" rather than mutating the input's prototype.
    const input = { ['__proto__']: true }
    const decoded = decodeStoreExperimental(encodeStoreExperimental(input))
    expect(Object.getPrototypeOf(decoded)).toBeNull()
    expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value).toBe(true)
  })

  it('caches the encoded string for a frozen input object', () => {
    const input = Object.freeze({ a: true })
    const first = encodeStoreExperimental(input)
    const second = encodeStoreExperimental(input)
    expect(first).toBe(second)
    expect(first).toBe('[["a",true]]')
  })

  it('coerces non-boolean-true values to false during encoding', () => {
    const input = { flag: 1 as unknown as boolean }
    expect(encodeStoreExperimental(input)).toBe('[["flag",false]]')
  })

  it('contains hostile proxy traps as a tagged configuration error', () => {
    const input = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('ownKeys failure')
        }
      }
    ) as IStoreFeatureExperimental
    expect(() => encodeStoreExperimental(input)).toThrow(
      '[store] config.features.experimental could not be read safely'
    )
  })
})

describe('readStoreFeature', () => {
  const baseConfig: IStoreConfigValue = {
    features: { wasm: true, experimental: { betaUi: true } },
    defaults: { warnAsyncActions: false },
    ready: null
  }

  it('reads the wasm flag', () => {
    expect(readStoreFeature(baseConfig, 'wasm')).toBe(true)
    expect(
      readStoreFeature({ ...baseConfig, features: { ...baseConfig.features, wasm: false } }, 'wasm')
    ).toBe(false)
  })

  it('reads an experimental flag by suffix', () => {
    expect(readStoreFeature(baseConfig, 'experimental.betaUi')).toBe(true)
    expect(readStoreFeature(baseConfig, 'experimental.missing')).toBe(false)
  })

  it('returns false for an "experimental." path with an empty key', () => {
    expect(readStoreFeature(baseConfig, 'experimental.')).toBe(false)
  })
})

describe('assertStoreFeature', () => {
  it('throws a Provider-required error when config is null', () => {
    expect(() => assertStoreFeature(null, 'wasm')).toThrow(
      '[store] this API requires a StoreProvider (feature "wasm")'
    )
  })

  it('uses the caller-supplied apiName in the Provider-required error', () => {
    expect(() => assertStoreFeature(null, 'experimental.betaUi', 'useBetaUi')).toThrow(
      '[store] useBetaUi requires a StoreProvider (feature "experimental.betaUi")'
    )
  })

  it('throws a feature-not-enabled error when config exists but the flag is off', () => {
    const config: IStoreConfigValue = {
      features: { wasm: false, experimental: {} },
      defaults: { warnAsyncActions: false },
      ready: null
    }
    expect(() => assertStoreFeature(config, 'wasm')).toThrow(
      '[store] this API requires feature "wasm" to be explicitly enabled on StoreProvider config'
    )
  })

  it('does not throw when the feature is enabled', () => {
    const config: IStoreConfigValue = {
      features: { wasm: true, experimental: {} },
      defaults: { warnAsyncActions: false },
      ready: null
    }
    expect(() => assertStoreFeature(config, 'wasm')).not.toThrow()
  })
})
