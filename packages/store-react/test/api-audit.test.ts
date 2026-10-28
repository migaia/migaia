import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createStore } from '@migaia/store-light'
import { UtilsAbortError } from '@migaia/utils/promise'
import {
  createStoreRegistry,
  createStoreToken,
  normalizeStoreConfig,
  StoreProvider,
  useProvidedStore
} from '../src/index.ts'

describe('store-react audit regressions', () => {
  it('closes admission before owned callbacks and shares reentrant completion', async () => {
    /** Observe the actual registry owner with lifecycle-owned asynchronous completion. */
    const registry = createStoreRegistry(createRuntime({ onError: () => {} }))
    /** The callback must not transfer ownership of a value to an already closing owner. */
    const late = createStoreToken('late')
    /** One actual owned callback can synchronously reenter the public completion API. */
    let reentrant: Promise<void> | undefined
    /** Idempotency must preserve the original cleanup count. */
    let disposed = 0
    registry.register(
      createStoreToken('first'),
      {
        dispose() {
          disposed++
          expect(registry.lifecycle).toBe('closing')
          expect(registry.disposed).toBe(true)
          expect(() => registry.register(late, {}, { owned: true })).toThrow(
            expect.objectContaining({ source: 'store.react', code: 'REGISTRY_DISPOSED' })
          )
          registry.dispose()
          reentrant = registry.disposeAsync()
        }
      },
      { owned: true }
    )
    registry.dispose()
    /** Reentrant and later callers wait for the same canonical plan. */
    const completion = registry.disposeAsync()
    expect(reentrant).toBe(completion)
    await completion
    expect(registry.lifecycle).toBe('terminal')
    expect(disposed).toBe(1)
  })

  it('contains a nested defaults getter before invoking readiness factories', () => {
    /** This actual accessor failure must remain reachable through the configuration boundary. */
    const original = new TypeError('defaults getter failed')
    /** Invalid configuration must not start the readiness side effect first. */
    let factoryCalls = 0
    expect(() =>
      normalizeStoreConfig({
        defaults: {
          get warnAsyncActions(): boolean {
            throw original
          }
        },
        ready: [
          () => {
            factoryCalls++
            return Promise.resolve()
          }
        ]
      })
    ).toThrow(
      expect.objectContaining({
        source: 'store.react',
        code: 'INVALID_CONFIG',
        cause: original
      })
    )
    expect(factoryCalls).toBe(0)
  })

  it('renders a store registered before the first child read using the same Runtime', async () => {
    /** Application assembly owns one registry and uses its actual Runtime for every injected Store. */
    const registry = createStoreRegistry(createRuntime({ onError: () => {} }))
    /** This matches the corrected complete example; registration precedes React rendering. */
    const store = createStore({ count: 3 }, { runtime: registry.runtime })
    /** The token carries the exact Store protocol type. */
    const token = createStoreToken<typeof store>('example')
    registry.register(token, store, { owned: true })
    /** No effect can satisfy the first synchronous require performed by this hook. */
    function Consumer() {
      return createElement(
        'span',
        null,
        useProvidedStore(token, (state) => state.count)
      )
    }
    try {
      expect(
        renderToString(
          createElement(StoreProvider, {
            registry,
            children: createElement(Consumer)
          })
        )
      ).toBe('<span>3</span>')
    } finally {
      await registry.disposeAsync()
    }
  })

  it.each(['native', 'frozen', 'foreign'] as const)(
    'classifies %s single cleanup failures without losing the original error',
    async (kind) => {
      /**
       * Supported native, frozen-native and real foreign-owner errors exercise one cleanup
       * boundary.
       */
      const original =
        kind === 'foreign' ? new UtilsAbortError() : new TypeError('owned cleanup failed')
      if (kind === 'frozen') Object.freeze(original)
      /** Runtime reports are observed independently of synchronous and async completion. */
      const reports: unknown[] = []
      /** Only actual public registry ownership is needed to trigger the callback. */
      const registry = createStoreRegistry(
        createRuntime({
          onError: (error) => {
            reports.push(error)
          }
        })
      )
      registry.register(
        createStoreToken('failure'),
        {
          dispose() {
            throw original
          }
        },
        { owned: true }
      )
      /** Capture the synchronous public result before requesting the same plan asynchronously. */
      let synchronous: unknown
      try {
        registry.dispose()
      } catch (error) {
        synchronous = error
      }
      /** Native and foreign errors retain identity; non-extensible errors keep a direct cause. */
      const expected =
        kind === 'frozen'
          ? { source: 'store.react', code: 'REGISTRY_DISPOSAL_FAILED', cause: original }
          : kind === 'foreign'
            ? { source: 'foundation.utils', code: 'ABORTED' }
            : { source: 'store.react', code: 'REGISTRY_DISPOSAL_FAILED' }
      expect(synchronous).toMatchObject(expected)
      if (kind !== 'frozen') expect(synchronous).toBe(original)
      /** The stable completion preserves this plan and its original failure chain. */
      const completion = registry.disposeAsync()
      expect(registry.disposeAsync()).toBe(completion)
      await expect(completion).rejects.toMatchObject(expected)
      expect(original.stack).toBeTruthy()
      expect(reports).toHaveLength(0)
    }
  )
})
