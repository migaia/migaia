import { describe, expect, it, vi } from 'vitest'
import {
  createStorageHost,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../src/index.js'
import type { ICodecStageObserver, IStorageBase } from '@migaia/storage-contract'
import { catalog } from './helpers/catalog.js'

/** One actual catalog fixture publishes the exact store used by its construction stage port. */
function observedCatalog() {
  /** Captured only to exercise the original core's post-install admission rules. */
  let core!: IStoragePluginCore
  /** Real provider output retains the same resource and public store identity. */
  let state!: ReturnType<typeof catalog>
  /** This stable observer exists before application listeners are registered. */
  let codec!: ICodecStageObserver
  /** The actual store and its native client determine authoring inference. */
  const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store'], Map<string, string>>()(
    'catalog'
  )
  /** Named descriptor keeps the store and original provider visible to public typing. */
  const descriptor = (current: IStoragePluginCore) => ({
    kind,
    featureExpose: () => ({ getClient: () => state.client }),
    install: () => {
      core = current
      state = catalog(core)
      codec = core.stageBindings.codecStages(state.store)
      codec.beforeEncode?.('install', 'json@1')
      core.registerStore(state.store)
      return {}
    }
  })
  return {
    plugin: definePlugin('observed', descriptor),
    core: () => core,
    state: () => state,
    codec: () => codec
  }
}

describe('the shared storage observation owner', () => {
  it('codes hook option reflection failures while preserving their exact original cause', async () => {
    /** Getter and own-key failures are configuration input failures, before any backend is opened. */
    const primary = new Error('hook descriptor failed')
    for (const hooks of [
      {
        get beforeHostClose() {
          throw primary
        }
      },
      new Proxy(
        {},
        {
          ownKeys() {
            throw primary
          }
        }
      )
    ])
      await expect(createStorageHost({ hooks })).rejects.toMatchObject({
        source: '@migaia/storage-host',
        code: 'INVALID_CONFIG',
        cause: primary
      })
    await expect(
      createStorageHost({ hooks: { beforeHostClose: 42 as never } })
    ).rejects.toMatchObject({ source: '@migaia/storage-host', code: 'INVALID_CONFIG' })
  })

  it('binds construction observers before handoff and observes later registration and cancellation', async () => {
    /** This real backend requests its construction binding before registerStore. */
    const fixture = observedCatalog()
    /** The constructor listener and later public listeners share one original channel. */
    const received: string[] = []
    /** Reporter observes exact failures without replacing normal operation results. */
    const report = vi.fn()
    /** Constructor observation proves the real install path can emit before publication. */
    const installing = vi.fn()
    await using host = await createStorageHost({
      plugins: [fixture.plugin],
      report,
      hooks: { beforeEncode: installing }
    })
    expect(installing).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'install', backendId: 'observed' })
    )
    /** The exact callback remains usable when a listener is added after observer construction. */
    const beforeEncode = fixture.codec().beforeEncode!
    beforeEncode('read', 'json@1')
    /** No stale listener snapshot is stored in the neutral observer. */
    const release = host.hooks.on('beforeEncode', (payload) => {
      expect(payload).toEqual({
        backendId: 'observed',
        backend: 'catalog',
        orgId: '00000000-0000-0000-0000-000000000000',
        operation: 'read',
        codec: 'json@1'
      })
      received.push(payload.operation)
    })
    beforeEncode('read', 'json@1')
    release()
    beforeEncode('read', 'json@1')
    expect(received).toEqual(['read'])
    expect(report).not.toHaveBeenCalled()
    expect(fixture.core().stageBindings.codecStages(fixture.state().store).kind).toBe('codec')
    expect(() => host.codecStages({ ...fixture.state().store } as IStorageBase)).toThrowError(
      expect.objectContaining({ code: 'BACKEND_PLUGIN_INVALID' })
    )
    expect(() => host.codecStages(fixture.state().store).forTransaction({})).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('shares constructor and host listeners while containing synchronous, getter and asynchronous failures', async () => {
    /** Payload construction is observable and must stay lazy for unused keys. */
    let constructed = 0
    /** Original listener failures must remain the actual reported instances. */
    const primary = new Error('listener failed')
    /** A then getter failure is independently observable through the shared utility. */
    const getterFailure = new Error('listener then getter failed')
    /** The host report callback receives every contained original error. */
    const report = vi.fn()
    /** This backend provides a real registration-issued emit endpoint. */
    const fixture = observedCatalog()
    /** Constructor options register on the same event channel as later host listeners. */
    const order: string[] = []
    await using host = await createStorageHost({
      plugins: [fixture.plugin],
      report,
      hooks: {
        beforeSql: () => {
          order.push('constructor')
        }
      }
    })
    fixture.core().emit('beforeDecode', () => {
      constructed += 1
      return {
        backendId: 'observed',
        backend: 'catalog',
        orgId: '00000000-0000-0000-0000-000000000000',
        operation: 'read',
        codec: 'json@1'
      }
    })
    expect(constructed).toBe(0)
    host.hooks.on('beforeSql', () => {
      order.push('host')
      throw primary
    })
    host.hooks.on(
      'beforeSql',
      () =>
        new Proxy(Promise.resolve(), {
          get(target, key) {
            if (key === 'then') throw getterFailure
            return Reflect.get(target, key, target)
          }
        }) as never
    )
    host.hooks.on('beforeSql', () => Promise.reject(primary) as never)
    fixture.core().emit('beforeSql', () => {
      constructed += 1
      return {
        backendId: 'observed',
        backend: 'catalog',
        orgId: '00000000-0000-0000-0000-000000000000',
        parameterCount: 0,
        sqlBytes: 0
      }
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(constructed).toBe(1)
    expect(order).toEqual(['constructor', 'host'])
    expect(report.mock.calls.map(([error]) => error)).toEqual([primary, getterFailure, primary])
  })

  it('owns plugin listeners in the original install window and caches disposal before reentrant close hooks', async () => {
    /** This listener is owned by the original registration resource stack. */
    const listener = vi.fn()
    /** The ordinary plugin proves hooks do not require a fake backend registration. */
    let installedCore!: Pick<IStoragePluginCore, 'hooks' | 'emit'>
    /** Register through the actual install hook, retaining the original unsubscribe handle. */
    const plugin = definePlugin('listener', (core) => ({
      install: () => {
        installedCore = core
        core.hooks.on('beforeSql', listener)
        return {}
      }
    }))
    /** A saved public hook port must not reopen the terminal host. */
    const host = await createStorageHost({ plugins: [plugin] })
    /** Reentrant cleanup must observe this same cached completion rather than start another close. */
    let reentrant: Promise<void> | undefined
    host.hooks.on('beforeHostClose', () => {
      reentrant = host.dispose()
    })
    /** Keep the actual public registration endpoint for a post-close admission assertion. */
    const hooks = host.hooks
    expect(() => installedCore.hooks.on('beforeSql', listener)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_OUTSIDE_INSTALL' })
    )
    /** Close publishes its cache before invoking any synchronous observer. */
    const disposed = host.dispose()
    expect(reentrant).toBe(disposed)
    await disposed
    expect(() => hooks.on('beforeSql', listener)).toThrowError(
      expect.objectContaining({ code: 'STORAGE_HOST_DISPOSED' })
    )
    expect(() =>
      installedCore.emit('beforeSql', () => ({
        backendId: 'none',
        backend: 'none',
        orgId: '00000000-0000-0000-0000-000000000000',
        parameterCount: 0,
        sqlBytes: 0
      }))
    ).toThrowError()
  })
})
