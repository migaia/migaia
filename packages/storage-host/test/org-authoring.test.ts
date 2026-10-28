import { createBackendChangeController } from '../src/core/change-controller.ts'
import { describe, expect, it } from 'vitest'
import {
  createStorageHost,
  createOrgId,
  definePlugin,
  defineStorageBackendKind,
  type IStorageOrgAuthoringPort,
  type IStoragePluginCore
} from '../src/index.ts'
import { getBackendChangeController } from '../src/core/change-controller.ts'
import { catalog } from './helpers/catalog.ts'

/** A lazy physical backend uses the original controller and exact-store registry after installation. */
function lazyBackend() {
  const children = new Map<string, ReturnType<typeof catalog>>()
  const finalized: string[] = []
  const controllers = new Map<
    string,
    ReturnType<IStorageOrgAuthoringPort['createChangeController']>
  >()
  const finalizeFailures = new Map<string, unknown>()
  let port!: IStorageOrgAuthoringPort
  let installedCore!: IStoragePluginCore
  const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store']>()('catalog')
  const plugin = definePlugin('lazy', (core: IStoragePluginCore) => {
    installedCore = core
    let root!: ReturnType<typeof catalog>
    return {
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => root.installer,
      install: () => {
        port = core.createOrgAuthoringPort()
        root = catalog(core)
        core.registerStore(root.store)
        core.registerChangeController(
          root.store,
          core.createChangeController({ backend: 'catalog' }, createBackendChangeController)
        )
        core.registerOrgBinding(root.store, {
          backend: (orgId) => {
            if (orgId === core.defaultOrgId) return root.store
            const existing = children.get(orgId)
            if (existing !== undefined) return existing.store
            const ports = core.getOrgContext(orgId)
            const child = catalog({ ...core, ...ports })
            const controller = port.createChangeController(
              {
                backend: 'catalog',
                finalize: async () => {
                  finalized.push(orgId)
                  await child.store.dispose()
                  if (finalizeFailures.has(orgId)) throw finalizeFailures.get(orgId)
                }
              },
              createBackendChangeController
            )
            port.registerChangeController(child.store, controller)
            controllers.set(orgId, controller)
            children.set(orgId, child)
            return child.store
          },
          drop: async (orgId) => {
            children.get(orgId)?.client.clear()
          }
        })
        return {}
      }
    }
  })
  return {
    plugin,
    children,
    controllers,
    finalized,
    finalizeFailures,
    port: () => port,
    core: () => installedCore
  }
}

describe('installation-captured organization authoring', () => {
  it('constructs exact native children late, filters their original controllers and drains owned work', async () => {
    const fixture = lazyBackend()
    const host = await createStorageHost({ plugins: [fixture.plugin] })
    const first = createOrgId()
    const second = createOrgId()
    const left = host.org(first).backend('lazy')
    const right = host.org(second).backend('lazy')
    fixture.children.get(first)!.client.set('key', 'left')
    fixture.children.get(second)!.client.set('key', 'right')
    expect(await left.get('key')).toBe('left')
    expect(await right.get('key')).toBe('right')
    expect(host.org(first).backend('lazy')).toBe(left)
    const observed: unknown[] = []
    const rootObserved: unknown[] = []
    getBackendChangeController(host.backend('lazy'))!.subscribe((change) => {
      rootObserved.push(change.orgId)
    })
    getBackendChangeController(left)!.subscribe((change) => {
      observed.push(change.orgId)
    })
    fixture.controllers.get(second)!.publish({ channel: 'value', kind: 'put', orgId: second })
    fixture.controllers.get(first)!.publish({ channel: 'value', kind: 'put', orgId: first })
    expect(observed).toEqual([first])
    expect(rootObserved).toEqual([second, first])
    expect('createOrgAuthoringPort' in host.org(first)).toBe(false)
    expect('createOrgAuthoringPort' in left).toBe(false)
    const release = fixture.controllers.get(first)!.beginMutation()
    const closed = host.dispose()
    await Promise.resolve()
    expect(fixture.finalized).toEqual([])
    release()
    await closed
    expect(fixture.finalized).toEqual([first, second])
    expect(fixture.children.get(first)!.cleanup).toHaveBeenCalledTimes(1)
    expect(fixture.children.get(second)!.cleanup).toHaveBeenCalledTimes(1)
    expect(() => fixture.port().createKeyLockPort()).toThrow()
    expect(() => left.get).toThrowError(expect.objectContaining({ code: 'STORAGE_HOST_DISPOSED' }))
  })

  it('keeps capture itself inside the original installation window', async () => {
    const fixture = lazyBackend()
    await using host = await createStorageHost({ plugins: [fixture.plugin] })
    expect(host.backend('lazy').backend).toBe('catalog')
    expect(() => fixture.core().createOrgAuthoringPort()).toThrow()
    expect(() =>
      fixture.core().createChangeController({ backend: 'catalog' }, createBackendChangeController)
    ).toThrow()
    expect(() => fixture.core().createKeyLockPort()).toThrow()
    expect(() => fixture.core().createRevisionPort()).toThrow()
  })

  it('creates independent original revision facts for late physical orgs and rejects after revocation', async () => {
    const fixture = lazyBackend()
    const host = await createStorageHost({ plugins: [fixture.plugin] })
    const first = fixture.port().createRevisionPort()
    const second = fixture.port().createRevisionPort()
    first.write('text', 'encoded-key')
    expect(first.read('text', 'encoded-key')).toBe(1)
    expect(second.read('text', 'encoded-key')).toBe(0)
    first.clear('text')
    expect(first.epoch('text')).toBe(1)
    expect(first.read('text', 'encoded-key')).toBe(0)
    expect(second.epoch('text')).toBe(0)
    await host.dispose()
    expect(() => fixture.port().createRevisionPort()).toThrow()
  })

  it('releases later native children when an earlier original finalizer fails', async () => {
    const fixture = lazyBackend()
    const host = await createStorageHost({ plugins: [fixture.plugin] })
    const first = createOrgId()
    const second = createOrgId()
    host.org(first).backend('lazy')
    host.org(second).backend('lazy')
    const original = new TypeError('native child close failed')
    fixture.finalizeFailures.set(first, original)
    const failure = await host.dispose().catch((error: unknown) => error)
    const reachable = (error: unknown): boolean => {
      if (error === original) return true
      if (!(error instanceof Error)) return false
      return (
        reachable(error.cause) || (error instanceof AggregateError && error.errors.some(reachable))
      )
    }
    expect(reachable(failure)).toBe(true)
    expect(fixture.finalized).toEqual([first, second])
    expect(fixture.children.get(second)!.cleanup).toHaveBeenCalledTimes(1)
  })
})
