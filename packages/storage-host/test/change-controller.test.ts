import { describe, expect, it, vi } from 'vitest'
import {
  createStorageHost,
  definePlugin,
  defineFeature,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../src/index.js'
import type { IBackendChangeController } from '../src/authoring/backend.js'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { walkErrorCauses } from '@migaia/utils/error'
import { catalog } from './helpers/catalog.js'

/** One actual map backend is bound to the controller's existing mutation resource owner. */
const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store'], Map<string, string>>()(
  'catalog'
)

describe('controlled backend change authoring', () => {
  it.each([false, true])(
    'preserves controller finalization failures with an existing identity: %s',
    async (coded) => {
      /** Both the raw callback failure and a backend-coded failure remain the original primary. */
      const original = coded
        ? new StorageContractError(StorageContractErrorCode.disposed)
        : new Error('controller finalize failed')
      /** Direct controller disposal exercises its newly public authoring boundary. */
      let controller!: IBackendChangeController
      /** The original store is still admitted and released by the same host resource owner. */
      const descriptor = (core: IStoragePluginCore) => {
        let state!: ReturnType<typeof catalog>
        return {
          kind,
          featureExpose: () => ({ getClient: () => state.client }),
          capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => state.installer,
          install: () => {
            state = catalog(core)
            controller = core.createChangeController({
              backend: 'catalog',
              finalize: () => {
                throw original
              }
            })
            core.registerStore(state.store)
            core.registerChangeController(state.store, controller)
            return {}
          }
        }
      }
      /** Reporter remains separate from the explicit primary disposal result. */
      const host = await createStorageHost({
        plugins: [definePlugin('finalize', descriptor)],
        report: vi.fn()
      })
      /**
       * The original stable Promise carries either the already-coded failure or its one host
       * wrapper.
       */
      const failure = await controller.dispose().catch((error) => error)
      if (coded) expect(failure).toBe(original)
      else
        expect(failure).toMatchObject({
          source: '@migaia/storage-host',
          code: 'STORAGE_HOST_DISPOSE_FAILED',
          cause: original
        })
      /** Later host cleanup keeps that same primary reachable instead of replacing it. */
      const aggregate = await host.dispose().catch((error) => error)
      expect(walkErrorCauses(aggregate)).toContain(original)
    }
  )
  it('publishes the same controller through its own lazy Feature getter and drains original mutations', async () => {
    /** Capture original core methods only to prove post-install window rejection. */
    let retained!: IStoragePluginCore
    /** Prepared value writes borrow the same row without changing the controller object. */
    const commitValue = async () => {}
    /** Finalization belongs to the original map and is invoked once through controller disposal. */
    let state!: ReturnType<typeof catalog>
    /** The factory creates one real controller, without an independent Feature registry. */
    let controller!: IBackendChangeController
    /** Feature construction retains the guarded lazy getter until the actual API endpoint. */
    const feature = defineFeature(kind, ({ featureExpose }) => ({
      capabilities: [],
      chain: {},
      api: {
        store: {
          async controller() {
            return featureExpose.getChangeController()
          }
        },
        transaction: {}
      }
    }))
    /** A named descriptor preserves exact provider and Feature inference. */
    const descriptor = (core: IStoragePluginCore) => {
      retained = core
      return {
        kind,
        featureExpose: () => ({ getClient: () => state.client }),
        capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => state.installer,
        install: () => {
          state = catalog(core)
          /** Preserve the real native cleanup while its resource boundary moves into the controller. */
          const dispose = state.store.dispose
          controller = core.createChangeController({ backend: 'catalog', finalize: dispose })
          state.store.dispose = () => controller.dispose()
          core.registerStore(state.store)
          core.registerChangeController(state.store, controller)
          core.registerValueCommit(state.store, commitValue)
          expect(() => core.registerValueCommit(state.store, commitValue)).toThrowError(
            expect.objectContaining({ code: 'INVALID_ARGUMENT' })
          )
          return {}
        }
      }
    }
    /** One installed registration supplies the same controller to its selected Feature. */
    const host = await createStorageHost({
      plugins: [definePlugin('catalog', descriptor, { feature })]
    })
    expect(await host.backend('catalog').api.controller()).toBe(controller)
    expect(() => retained.createChangeController({ backend: 'catalog' })).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
    )
    expect(() => retained.registerChangeController(state.store, controller)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
    )
    expect(() => retained.registerValueCommit(state.store, commitValue)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
    )
    /** An admitted mutation may publish its committed notification before physical cleanup. */
    const release = controller.beginMutation()
    /** The original channel preserves local event sequence and post-commit metadata. */
    const events: unknown[] = []
    controller.subscribe((event) => events.push(event))
    /** The same primary is cached before closure listeners can reenter disposal. */
    let reentered: Promise<void> | undefined
    controller.closingSignal.addEventListener(
      'abort',
      () => {
        reentered = controller.dispose()
      },
      { once: true }
    )
    /** Repeated disposal retains the exact original controller Promise. */
    const disposing = controller.dispose()
    expect(reentered).toBe(disposing)
    expect(controller.closingSignal.aborted).toBe(true)
    expect(controller.closingSignal.reason).toMatchObject({ code: 'STORE_DISPOSED' })
    expect(controller.dispose()).toBe(disposing)
    controller.publish({ channel: 'value', kind: 'put', keys: ['key'] })
    expect(events).toHaveLength(1)
    expect(state.cleanup).not.toHaveBeenCalled()
    release()
    await disposing
    await host.dispose()
    expect(state.cleanup).toHaveBeenCalledTimes(1)
    controller.publish({ channel: 'value', kind: 'put', keys: ['late'] })
    expect(events).toHaveLength(1)
  })

  it('rolls back an original controller on failed construction and rejects a foreign store', async () => {
    /** A failed handoff cannot orphan the controller or its captured original finalizer. */
    const cleanup = vi.fn()
    /** Save the original construction receiver to prove callback capture does not replace it. */
    let options: object | undefined
    /** Preserve the same actual client even though admission deliberately fails later. */
    let state!: ReturnType<typeof catalog>
    /** Registration must use the exact store already handed to its own core. */
    const descriptor = (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => state.client }),
      install: () => {
        /** Resource creation is admitted by the original install scope before any store is exposed. */
        const input = {
          backend: 'catalog',
          finalize() {
            expect(this).toBe(options)
            cleanup()
          }
        }
        options = input
        /** Both registration and rollback retain this exact original controller. */
        const controller = core.createChangeController(input)
        /** The actual provider store is legal, while the copied object has no handoff authority. */
        state = catalog(core)
        core.registerStore(state.store)
        core.registerChangeController({ ...state.store }, controller)
        return {}
      }
    })
    /** The original host install wrappers retain the exact semantic rejection on their cause chain. */
    const failure = await createStorageHost({
      plugins: [definePlugin('foreign', descriptor)]
    }).catch((error) => error)
    expect(failure.cause.cause).toMatchObject({ code: 'BACKEND_PLUGIN_INVALID' })
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('returns undefined for a registration without a controller', async () => {
    /** Lazy absence never creates a fallback registry or controller. */
    const feature = defineFeature(kind, ({ featureExpose }) => ({
      capabilities: [],
      chain: {},
      api: {
        store: {
          async controller() {
            return featureExpose.getChangeController()
          }
        },
        transaction: {}
      }
    }))
    /** Valid store construction can continue after the author observes invalid controller input. */
    const descriptor = (core: IStoragePluginCore) => {
      let state!: ReturnType<typeof catalog>
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
    await using host = await createStorageHost({
      plugins: [definePlugin('plain', descriptor, { feature })]
    })
    expect(await host.backend('plain').api.controller()).toBeUndefined()
  })
})
