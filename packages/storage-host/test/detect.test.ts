import { storageProbe } from '../src/plugins/probe/index.js'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  assertOperationContext,
  StorageContractError,
  StorageContractErrorCode
} from '@migaia/storage-contract'
import {
  createStorageHost,
  createOrgId,
  definePlugin,
  defineFeature,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../src/index.js'
import { catalog } from './helpers/catalog.js'

/** A native map remains the actual client, store and lifecycle owner throughout detection. */
const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store'], Map<string, string>>()(
  'catalog'
)

describe('storage environment checks', () => {
  it('runs plugin and Feature checks in installation order and caches one successful Promise', async () => {
    /** Record actual original callbacks, without a separate execution seam. */
    const order: string[] = []
    /** Feature construction uses the original registration installation window. */
    const feature = defineFeature(kind, ({ featureExpose }) => {
      featureExpose.registerDetect(async (signal) => {
        expect(signal.aborted).toBe(false)
        order.push('feature')
      })
      return { capabilities: [], chain: {}, api: { store: {}, transaction: {} } }
    })
    /** Capture only the port needed to prove original installation-window admission. */
    let retained!: IStoragePluginCore['registerDetect']
    /** One actual backend and selected Feature share the original check sequence. */
    const descriptor = (core: IStoragePluginCore) => {
      /** Actual provider state is acquired only by the original install callback. */
      let state!: ReturnType<typeof catalog>
      retained = core.registerDetect
      core.registerDetect(async () => {
        order.push('factory')
      })
      return {
        kind,
        featureExpose: () => ({ getClient: () => state.client }),
        capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => state.installer,
        install: () => {
          state = catalog(core)
          core.registerStore(state.store)
          core.registerDetect(async () => {
            order.push('install')
          })
          return {}
        }
      }
    }
    /** Ordinary plugins use the same lifecycle window and remain in installation order. */
    const utility = definePlugin('utility', (core) => ({
      install: () => {
        core.registerDetect(async () => {
          order.push('utility')
        })
        return {}
      }
    }))
    await using host = await createStorageHost({
      plugins: [definePlugin('catalog', descriptor, { feature }), utility]
    })
    expect(order).toEqual(['factory', 'feature', 'install', 'utility'])
    expect(host.detect()).toBe(host.detect())
    await host.detect()
    expect(order).toHaveLength(4)
    expect(() => retained(async () => {})).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
    )
  })

  it('keeps delayed detection explicit, shares pending work and retries an uncached failed pass', async () => {
    /** One real check remains pending while concurrent detect calls join its Promise. */
    const entered = deferred<void>()
    /** Releasing this actual check avoids adding a scheduler or synthetic detection runner. */
    const resume = deferred<void>()
    /** A semantic backend failure must survive the detect boundary by identity. */
    const original = new StorageContractError(StorageContractErrorCode.unsupported)
    /** A failed pass must rerun every previously unchecked callback on retry. */
    const prefix = vi.fn(async () => {})
    /** Fail only the first actual pass. */
    let fail = true
    /** The same original map observes whether the real terminal was entered. */
    let state!: ReturnType<typeof catalog>
    /** Registration keeps its original resource owner and actual execution port. */
    const descriptor = (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => state.client }),
      capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => state.installer,
      install: () => {
        state = catalog(core)
        state.client.set('key', 'value')
        core.registerStore(state.store)
        core.registerDetect(prefix)
        core.registerDetect(async () => {
          entered.resolve()
          await resume.promise
          if (fail) throw original
        })
        return {}
      }
    })
    /** No constructor probe runs when detection is explicitly delayed. */
    const host = await createStorageHost({
      plugins: [definePlugin('delayed', descriptor)],
      autoDetect: false
    })
    /** The highest actual native client boundary answers whether any business work was invoked. */
    const read = vi.spyOn(state.client, 'get')
    await expect(host.backend('delayed').get('key')).rejects.toMatchObject({
      source: 'storage.contract',
      code: 'UNSUPPORTED_CAPABILITY'
    })
    expect(prefix).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    /** Observe rejection immediately, retaining the original shared Promise for identity checks. */
    const first = host.detect()
    const rejected = first.catch((error) => error)
    expect(host.detect()).toBe(first)
    await entered.promise
    resume.resolve()
    expect(await rejected).toBe(original)
    fail = false
    await host.detect()
    expect(prefix).toHaveBeenCalledTimes(2)
    await expect(host.backend('delayed').get('key')).resolves.toBe('value')
    expect(read).toHaveBeenCalledTimes(1)
    await host.dispose()
    await expect(host.detect()).rejects.toMatchObject({ code: 'STORAGE_HOST_DISPOSED' })
  })

  it.each([false, true])(
    'rolls back default detection failure in reverse order and preserves cleanup failures: %s',
    async (rejectCleanup) => {
      /** Original semantic detection failure remains first even when rollback also fails. */
      const original = new StorageContractError(StorageContractErrorCode.unsupported)
      /** Distinct original cleanup error must remain reachable in the aggregate. */
      const cleanupError = new StorageContractError(StorageContractErrorCode.disposed)
      /** These are actual original resource callbacks, not a fake store facade. */
      const cleanupOrder: string[] = []
      /** Business callbacks never run while createStorageHost is checking the environment. */
      const business = vi.fn()
      /** Every constructed store retains the original canonical disposal contract. */
      const backend = <const N extends string>(name: N) => {
        const descriptor = (core: IStoragePluginCore) => {
          let state!: ReturnType<typeof catalog>
          return {
            kind,
            featureExpose: () => ({ getClient: () => state.client }),
            capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => state.installer,
            install: () => {
              state = catalog(core)
              core.registerStore(state.store)
              core.onDispose(() => {
                cleanupOrder.push(name)
                if (name === 'second' && rejectCleanup) throw cleanupError
              })
              core.registerDetect(async () => {
                if (name === 'first') throw original
              })
              return { [name]: business }
            }
          }
        }
        return definePlugin(name, descriptor)
      }
      /** The create boundary performs default detection only after both stores are installed. */
      const failure = await createStorageHost({
        plugins: [backend('first'), backend('second')],
        report: vi.fn()
      }).catch((error) => error)
      expect(cleanupOrder).toEqual(['second', 'first'])
      expect(business).not.toHaveBeenCalled()
      if (rejectCleanup) {
        expect(failure).toBeInstanceOf(AggregateError)
        expect(failure.errors[0]).toBe(original)
        expect(failure.errors[1].errors[0].cause).toBe(cleanupError)
      } else expect(failure).toBe(original)
    }
  )

  it('invalidates the successful cache only for newly published registrations', async () => {
    /** Previously passed original contexts remain ready after the next atomic publication. */
    const oldCheck = vi.fn(async () => {})
    /** The new registration must be checked explicitly after host.use. */
    const newCheck = vi.fn(async () => {})
    /** Ordinary plugins prove ordering without acquiring an unrelated backend resource. */
    const plugin = (id: string, check: () => Promise<void>) =>
      definePlugin(id, (core) => ({
        install: () => {
          core.registerDetect(check)
          return {}
        }
      }))
    await using host = await createStorageHost({ plugins: [plugin('old', oldCheck)] })
    /** Retain the successful cached result before a later batch is installed. */
    const first = host.detect()
    await host.use(plugin('new', newCheck))
    expect(host.detect()).not.toBe(first)
    await host.detect()
    expect(oldCheck).toHaveBeenCalledTimes(1)
    expect(newCheck).toHaveBeenCalledTimes(1)
  })

  it('seals the original check signal and drains accepted work before disposing its backend', async () => {
    /** A check registered before store ownership can still be using the actual backend resource. */
    const entered = deferred<void>()
    /** Accepted work completes through its real Promise even when it ignores cancellation. */
    const resume = deferred<void>()
    /** The original owner supplies the observable cancellation boundary on its removal queue. */
    const cancelled = deferred<void>()
    /** Capture the original native registration signal without substituting another controller. */
    let aborted = () => false
    /** Observe the store's real captured cleanup function. */
    let state!: ReturnType<typeof catalog>
    /** Factory registration precedes the store disposer and therefore exercises reverse cleanup. */
    const descriptor = (core: IStoragePluginCore) => {
      core.registerDetect(async (signal) => {
        aborted = () => signal.aborted
        signal.addEventListener('abort', () => cancelled.resolve(), { once: true })
        entered.resolve()
        await resume.promise
        expect(state.cleanup).not.toHaveBeenCalled()
      })
      return {
        kind,
        featureExpose: () => ({ getClient: () => state.client }),
        capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => state.installer,
        install: () => {
          state = catalog(core)
          core.registerStore(state.store)
          return {}
        }
      }
    }
    /** Explicit detection allows close to compete with the actual accepted check. */
    const host = await createStorageHost({
      plugins: [definePlugin('closing', descriptor)],
      autoDetect: false
    })
    /** Handle the known losing detect result immediately. */
    const checking = host.detect().catch((error) => error)
    await entered.promise
    /** Facade admission seals now; original removal aborts its signal before resource cleanup. */
    const closing = host.dispose()
    await cancelled.promise
    expect(aborted()).toBe(true)
    expect(state.cleanup).not.toHaveBeenCalled()
    resume.resolve()
    expect(await checking).toMatchObject({ code: 'STORAGE_HOST_DISPOSED' })
    await closing
    expect(state.cleanup).toHaveBeenCalledTimes(1)
  })

  it('captures default organization identity before any plugin work and rejects invalid UUIDs', async () => {
    /** Native UUIDs share the canonical contract validator without another regex. */
    const org = createOrgId()
    expect(() => assertOperationContext({ orgId: org })).not.toThrow()
    /** Payload identity comes from one immutable host option snapshot. */
    const identities: string[] = []
    /** No backend factory can run when the host's organization input is malformed. */
    const install = vi.fn(() => ({}))
    /** Default identity and caller-supplied identity share the original event subscriber. */
    const plugin = definePlugin('ordinary', () => ({ install }))
    await using _host = await createStorageHost({
      org,
      plugins: [storageProbe({ beforeDetect: ({ orgId }) => identities.push(orgId) }), plugin]
    })
    /** Each installed registration reports its check pass; every one carries the configured org. */
    expect([...new Set(identities)]).toEqual([org])
    await expect(createStorageHost({ org: 'UPPERCASE', plugins: [plugin] })).rejects.toMatchObject({
      source: 'storage.contract',
      code: 'INVALID_ARGUMENT'
    })
    expect(install).toHaveBeenCalledTimes(1)
  })
})
