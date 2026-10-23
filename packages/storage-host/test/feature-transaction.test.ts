import { describe, expect, expectTypeOf, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { assertTransactionOwner, records, type ITransactionScope } from '@migaia/storage-contract'
import { createMemoryBackend } from '../src/backends/memory.js'
import type { IStoragePluginCore } from '../src/index.js'
import {
  createStorageHost,
  defineFeature,
  definePlugin,
  memoryBackendKind,
  memoryBackendPlugin
} from '../src/index.js'

/** Real memory transactions retain their undefined native client while supporting scoped methods. */
const scopedFeature = () =>
  defineFeature(memoryBackendKind, () => ({
    capabilities: [],
    chain: {
      tx: {
        mark<T>(this: T): T {
          return this
        }
      },
      query: {
        mark<T>(this: T): T {
          return this
        }
      }
    },
    api: {
      store: {
        async identity() {
          expect(this.scope).toBeUndefined()
          expect(this.client).toBeUndefined()
          return this.store
        }
      },
      transaction: {
        async identity() {
          expectTypeOf(this.client).toEqualTypeOf<undefined>()
          return this.store === this.scope
        },
        nested: {
          async read(key: string) {
            return this.scope.get(key)
          }
        },
        async setAfter(key: string, value: string, waiting: Promise<void>) {
          await waiting
          await this.scope.set(key, value)
        },
        async fail(error: Error): Promise<never> {
          throw error
        }
      }
    }
  }))

describe('Feature transaction methods on original native views', () => {
  it('binds exact operation views and preserves expiry without adding an API to unselected scopes', async () => {
    await using plain = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    await plain
      .backend('memory')
      .transaction((scope) => expect(Object.hasOwn(scope, 'api')).toBe(false))
    await using host = await createStorageHost({
      plugins: [memoryBackendPlugin({ features: { scoped: scopedFeature() } })]
    })
    const store = host.backend('memory')
    expect(await store.api.identity()).toBe(store)
    let saved!: () => Promise<boolean>
    await store.transaction(async (scope) => {
      expect(Object.isFrozen(scope)).toBe(true)
      expect(Object.isFrozen(scope.api)).toBe(true)
      expect(await scope.api.identity()).toBe(true)
      await scope.set('key', 'value')
      expect(await scope.api.nested.read('key')).toBe('value')
      const query = scope
        .use(records)
        .query<{ id: string }>()
        .where({ id: 'one' })
        .limit(1)
        .select('id')
      expect(query.mark()).toBe(query)
      saved = scope.api.identity
    })
    await expect(saved()).rejects.toMatchObject({
      source: '@migaia/storage-host',
      code: 'TRANSACTION_FAILED'
    })
    await store
      .tx()
      .lock({ channel: 'text', key: 'key' })
      .run(async (scope) => {
        expect(await scope.api.identity()).toBe(true)
        const query = scope.use(records).query<{ id: string }>().where({ id: 'one' }).select('id')
        expect(query.mark()).toBe(query)
      })
  })

  it('drains unawaited Feature operations and keeps a caught method failure as the original first failure', async () => {
    await using host = await createStorageHost({
      plugins: [memoryBackendPlugin({ features: { scoped: scopedFeature() } })]
    })
    const store = host.backend('memory')
    /** The original operation owner admits the entire async method before the callback returns. */
    const started = deferred<void>()
    const finish = deferred<void>()
    let accepted: Promise<void> | undefined
    const transaction = store.transaction((scope) => {
      accepted = scope.api.setAfter('later', 'value', finish.promise)
      started.resolve()
    })
    await started.promise
    expect(await store.get('later')).toBeNull()
    finish.resolve()
    await Promise.all([transaction, accepted])
    expect(await store.get('later')).toBe('value')
    /** A raw Feature failure follows the same native normalizer and cannot be hidden by catch. */
    const original = new Error('Feature method failed')
    let first: unknown
    await expect(
      store.transaction(async (scope) => {
        await scope.putRecord({ draft: true }, 'draft')
        try {
          await scope.api.fail(original)
        } catch (error) {
          first = error
        }
      })
    ).rejects.toSatisfy((error: unknown) => error === first)
    expect(first).toMatchObject({ code: 'TRANSACTION_FAILED', cause: original })
    expect(await store.getRecord('draft')).toBeUndefined()
  })

  it('mixes selected fluent methods into original branches and guards saved endpoints after disposal', async () => {
    const host = await createStorageHost({
      plugins: [memoryBackendPlugin({ features: { scoped: scopedFeature() } })]
    })
    const store = host.backend('memory')
    const builder = store.tx()
    expect(builder.mark()).toBe(builder)
    const locked = builder.lock({ channel: 'record', key: 'item' })
    expect(locked.mark).toBe(builder.mark)
    expect(locked.mark()).toBe(locked)
    await locked.run(async (scope) => {
      await scope.putRecord({ id: 'item', active: true }, 'item')
    })
    const query = store.use(records).query<{ id: string; active: boolean }>()
    expect(query.mark()).toBe(query)
    const selected = query.where({ active: true }).select('id')
    expect(selected.mark).toBe(query.mark)
    expect(selected.mark()).toBe(selected)
    expect(await selected.all()).toEqual([{ id: 'item' }])
    await host.dispose()
    expect(() => locked.mark()).toThrowError()
    expect(() => selected.mark()).toThrowError()
  })

  it('rejects duplicate fluent methods before publishing selected capabilities', async () => {
    const duplicate = () =>
      defineFeature(memoryBackendKind, () => ({
        capabilities: [],
        chain: {
          tx: {
            lock() {
              return this
            }
          }
        },
        api: { store: {}, transaction: {} }
      }))
    const failure = await createStorageHost({
      plugins: [memoryBackendPlugin({ features: { duplicate: duplicate() } })]
    }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    /** Native installation adds finite original wrapper boundaries around the semantic rejection. */
    let cursor = failure
    const codes: unknown[] = []
    for (let depth = 0; depth < 8 && cursor instanceof Error; depth++) {
      if ('code' in cursor) codes.push(cursor.code)
      cursor = cursor.cause
    }
    expect(codes).toContain('EXTENSION_DUPLICATE')
  })

  it('keeps pure fluent configuration outside intervention while real terminals enter it', async () => {
    let stages = 0
    const intervention = definePlugin('intervention', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          stages++
          await next(input)
        })
        return {}
      }
    }))
    await using host = await createStorageHost({
      plugins: [memoryBackendPlugin({ features: { scoped: scopedFeature() } }), intervention]
    })
    const builder = host.backend('memory').tx()
    expect(builder.mark()).toBe(builder)
    expect(stages).toBe(0)
    await builder.lock({ channel: 'record', key: 'item' }).run(() => undefined)
    expect(stages).toBe(1)
  })

  it('retains a Feature method-table reflection failure on the coded installation cause chain', async () => {
    const original = new Error('Feature table reflection')
    const feature = defineFeature(memoryBackendKind, () => ({
      capabilities: [],
      api: { store: {}, transaction: {} },
      chain: new Proxy(
        {},
        {
          ownKeys() {
            throw original
          }
        }
      )
    }))
    const failure = await createStorageHost({
      plugins: [memoryBackendPlugin({ features: { feature } })]
    }).catch((error: unknown) => error)
    const seen: unknown[] = []
    let cursor = failure
    for (let depth = 0; depth < 8 && cursor instanceof Error; depth++) {
      seen.push(cursor)
      cursor = cursor.cause
    }
    expect(seen).toContain(original)
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '@migaia/storage-host',
          code: 'BACKEND_PLUGIN_INVALID',
          cause: original
        })
      ])
    )
  })

  it('rejects another real backend scope before running any Feature intervention', async () => {
    const features = { scoped: scopedFeature() }
    let project!: (scope: object) => object | undefined
    let stages = 0
    const factory = (core: IStoragePluginCore<typeof features>) => {
      let construction!: ReturnType<typeof createMemoryBackend>
      project = core.createTransactionApi
      return {
        kind: memoryBackendKind,
        capabilityInstaller: (_store: typeof construction.store) => construction.installer,
        featureExpose: () => ({
          getClient: () => undefined,
          getTransactionClient: (scope: ITransactionScope<unknown, typeof records>) => {
            assertTransactionOwner(construction.store, scope)
            return undefined
          }
        }),
        install: () => {
          construction = createMemoryBackend(core, {})
          core.registerStore(construction.store)
          core.registerChangeController(construction.store, construction.controller)
          core.usePipeline((input, next) => {
            if (input.operation === 'identity') stages++
            return next(input)
          })
          return {}
        }
      }
    }
    await using host = await createStorageHost({
      plugins: [definePlugin('left', factory, features), memoryBackendPlugin({ id: 'right' })]
    })
    await expect(
      host.backend('right').transaction(async (scope) => {
        const api = project(scope)!
        const identity = Reflect.get(api, 'identity') as () => Promise<unknown>
        await identity()
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(stages).toBe(0)
  })

  it('keeps query methods on both transaction entry points without adding an empty transaction API', async () => {
    const feature = defineFeature(memoryBackendKind, () => ({
      capabilities: [],
      api: { store: {}, transaction: {} },
      chain: {
        query: {
          mark<T>(this: T): T {
            return this
          }
        }
      }
    }))
    await using host = await createStorageHost({
      plugins: [memoryBackendPlugin({ features: { feature } })]
    })
    const store = host.backend('memory')
    await store.transaction(async (scope) => {
      expect(Object.hasOwn(scope, 'api')).toBe(false)
      const query = scope.use(records).query<{ id: string }>().where({ id: 'one' }).select('id')
      expect(query.mark()).toBe(query)
      await query.all()
      /** Type-only negative calls are never executed against the actual native scope. */
      const invalidCalls = () => {
        // @ts-expect-error Transaction reads cannot start a separate operation context.
        query.all({ timeoutMs: 1 })
        // @ts-expect-error No selected transaction API exists.
        void scope.api
      }
      expectTypeOf(invalidCalls).toEqualTypeOf<() => void>()
    })
    await store
      .tx()
      .lock({ channel: 'record', key: 'one' })
      .run(async (scope) => {
        const query = scope
          .use(records)
          .query<{ id: string }>()
          .where({ id: 'one' })
          .limit(1)
          .select('id')
        expect(query.mark()).toBe(query)
        await query.all()
      })
  })
})
