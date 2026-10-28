import { describe, expect, it } from 'vitest'
import { assertTransactionOwner } from '../src/authoring/transaction.ts'
import { deferred } from '@migaia/utils/promise'
import {
  createOrgId,
  createStorageHost,
  defineFeature,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../src/index.ts'
import { createMemoryBackend } from '../src/backends/memory.ts'

/** Clients are borrowed fixture identities; actual data and transaction ownership stay in memory. */
type IClient = { readonly orgId: string; readonly marker: string }
/** A distinct native kind retains the original memory implementation and authentic scope owner. */
const kind = defineStorageBackendKind<
  ReturnType<typeof createMemoryBackend>['store'],
  IClient,
  { getTransactionClient(scope: object): IClient }
>()('memory')

/** Install one original backend and optionally opt in to native organization client selection. */
function nativeFixture(mode: 'legacy' | 'sync' | 'async') {
  /** Capture only actual callback order; no synthetic transaction or lifecycle owner exists. */
  const trace: string[] = []
  /** Tests control native preparation without changing the host's original accepted operation. */
  const ready = deferred<IClient>()
  /** The same saved core tests that registration cannot escape its installation window. */
  let installedCore!: IStoragePluginCore
  /** Actual data construction supplies every root and organization transaction owner. */
  let constructed!: ReturnType<typeof createMemoryBackend>
  /** Selected Feature construction must remain once even when new organizations are used. */
  let factories = 0
  const feature = defineFeature(kind, () => {
    factories += 1
    return {
      capabilities: [],
      chain: {},
      api: {
        store: {
          async client() {
            trace.push('store method')
            return this.client
          }
        },
        transaction: {
          async client() {
            trace.push('transaction method')
            return this.client
          }
        }
      }
    }
  })
  const factory = (core: IStoragePluginCore<{ feature: typeof feature }>) => {
    installedCore = core
    return {
      kind,
      featureExpose: () => ({
        getClient: () => {
          trace.push('legacy client')
          return { orgId: core.defaultOrgId, marker: 'legacy' }
        },
        getTransactionClient: (scope: object) => {
          assertTransactionOwner(constructed.store, scope)
          trace.push('legacy transaction')
          return { orgId: core.defaultOrgId, marker: 'legacy transaction' }
        }
      }),
      capabilityInstaller: (_store: typeof constructed.store) => constructed.installer,
      install: () => {
        constructed = createMemoryBackend(core, {})
        core.registerStore(constructed.store)
        core.registerChangeController(constructed.store, constructed.controller)
        core.registerOrgBinding(constructed.store, constructed.orgBinding)
        if (mode !== 'legacy')
          core.registerFeatureClientResolver(constructed.store, {
            getClient: (orgId) => {
              trace.push('resolved ' + orgId)
              if (mode === 'sync') return { orgId, marker: 'resolved' }
              return ready.promise
            },
            getTransactionClient: (scope, orgId) => {
              assertTransactionOwner(constructed.orgBinding.backend(orgId), scope)
              trace.push('resolved transaction ' + orgId)
              return { orgId, marker: 'resolved transaction' }
            }
          })
        return {}
      }
    }
  }
  /** Preserve the same exact descriptor inference used by native backend authoring. */
  const plugin = definePlugin<'native', typeof factory, { feature: typeof feature }>(
    'native',
    factory,
    { feature }
  )
  return {
    plugin,
    trace,
    ready,
    core: () => installedCore,
    native: () => constructed,
    factories: () => factories
  }
}

describe('installation-owned Feature client resolution', () => {
  it('leaves unregistered client getters and their original order unchanged', async () => {
    const fixture = nativeFixture('legacy')
    await using host = await createStorageHost({ plugins: [fixture.plugin] })
    expect((await host.backend('native').api.client()).marker).toBe('legacy')
    expect(fixture.trace).toEqual(['legacy client', 'store method'])
    await host.backend('native').transaction(async (scope) => {
      expect((await scope.api.client()).marker).toBe('legacy transaction')
    })
    expect(fixture.trace.slice(2)).toEqual(['legacy transaction', 'transaction method'])
  })

  it('routes synchronous root and organization clients without rerunning the selected Feature', async () => {
    const fixture = nativeFixture('sync')
    const defaultOrg = createOrgId()
    await using host = await createStorageHost({ org: defaultOrg, plugins: [fixture.plugin] })
    const first = createOrgId()
    const second = createOrgId()
    expect(await host.backend('native').api.client()).toEqual({
      orgId: defaultOrg,
      marker: 'resolved'
    })
    expect(await host.org(first).backend('native').api.client()).toEqual({
      orgId: first,
      marker: 'resolved'
    })
    expect(await host.org(second).backend('native').api.client()).toEqual({
      orgId: second,
      marker: 'resolved'
    })
    let saved!: () => Promise<IClient>
    await host
      .org(first)
      .backend('native')
      .transaction(async (scope) => {
        expect(await scope.api.client()).toEqual({ orgId: first, marker: 'resolved transaction' })
        saved = scope.api.client
      })
    const before = fixture.trace.length
    await expect(saved()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(fixture.trace).toHaveLength(before)
    expect(fixture.trace.some((entry) => entry.startsWith('legacy'))).toBe(false)
    expect(fixture.factories()).toBe(1)
  })

  it('awaits only actual native preparation with the exact client identity', async () => {
    const fixture = nativeFixture('async')
    await using host = await createStorageHost({ plugins: [fixture.plugin] })
    const pending = host.backend('native').api.client()
    expect(fixture.trace).not.toContain('store method')
    const client = { orgId: createOrgId(), marker: 'prepared identity' }
    fixture.ready.resolve(client)
    expect(await pending).toBe(client)
    expect(fixture.trace.at(-1)).toBe('store method')
  })

  it('keeps registration inside its original window and never revives a disposed registration', async () => {
    const fixture = nativeFixture('async')
    const host = await createStorageHost({ plugins: [fixture.plugin] })
    expect(() =>
      fixture.core().registerFeatureClientResolver(fixture.native().store, {
        getClient: () => undefined
      })
    ).toThrow()
    const pending = host.backend('native').api.client()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'REGISTRATION_REVOKED' })
    const closing = host.dispose()
    fixture.ready.resolve({ orgId: createOrgId(), marker: 'late' })
    await rejected
    await closing
    expect(fixture.trace).not.toContain('store method')
  })
})
