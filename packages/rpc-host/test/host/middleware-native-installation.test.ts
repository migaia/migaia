/** Original native installation and rollback receipts use one real receiving PluginHost. */
import { defineHost, definePlugin, type IPluginHostCore } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { expect, it } from 'vitest'
import { coreMemoryServer } from './core-fixture.ts'

/** A genuine native install hook lends its original core without role descriptors or port facades. */
function nativeLifecyclePlugin(name: string, install: (core: IPluginHostCore) => void) {
  return definePlugin({
    name,
    install: (core) => {
      install(core)
      return {}
    }
  })
}

/** Original native cleanup appends its release before throwing the exact selected leaf. */
function failingRelease(releases: string[], name: string, error: unknown) {
  return (): never => {
    releases.push(name)
    throw error
  }
}

/** The canonical native Host owns transactions, resource callbacks and its disposal completion. */
function receivingHost() {
  /** Every original transport in this receiver declares the same actual memory namespace. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** The original native Host owns both these authentic pipelines and the existing transaction. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  return host
}

/** SUP021–023 preserve the original shared completion and successful terminal cleanup summary. */
async function runNativeInstallationBranch(name: string): Promise<void> {
  /** A real SDK transport joins this same Host before the ordinary native installation. */
  const server = coreMemoryServer(name)
  /** No second plugin-host or endpoint is constructed for RPC. */
  const host = receivingHost()
  await host.use(
    server.transport,
    nativeLifecyclePlugin(name, () => undefined)
  )
  /** The public native completion is borrowed before either repeated disposal call. */
  const dispose = host.dispose()
  expect(host.dispose()).toBe(dispose)
  await expect(dispose).resolves.toMatchObject({
    logicalTerminal: true,
    cleanupComplete: true,
    cleanupErrors: []
  })
  expect(host.dispose()).toBe(dispose)
}

// C146–148 originally call the same no-disposer helper; their titles do not prove distinct results.
it.each([
  ['RPC-TEST-FB075BDD690B-C146', 'native-observation-primitive'],
  ['RPC-TEST-FB075BDD690B-C147', 'native-observation-undefined'],
  ['RPC-TEST-FB075BDD690B-C148', 'native-observation-no-disposer']
] as const)('%s preserves native terminal cleanup', async (_id, name) => {
  await runNativeInstallationBranch(name)
})

// Preserve both original native failure and clean terminal receipts.
it('native Feature install failure rolls back without retaining Host residue', async () => {
  /** The failing hook's exact native value must remain the installation error cause. */
  const primary = new Error('native observation install failure')
  /** Actual transport acquisition participates in the same original native rollback transaction. */
  const server = coreMemoryServer('native-install-failure')
  /** This is the same public native Host that receives the SDK transport. */
  const host = receivingHost()
  /** Public use() preserves the original install error and its native rollback detail. */
  const failure = await host
    .use(
      server.transport,
      nativeLifecyclePlugin('native-observation-install-failure', () => {
        throw primary
      })
    )
    .catch((error: unknown) => error)
  expect(failure).toMatchObject({
    name: 'PluginHostError',
    source: 'plugin.host',
    code: 'PLUGIN_INSTALL_FAILED',
    detail: { failedName: 'native-observation-install-failure', rollbackErrors: [] },
    cause: primary
  })
  await expect(host.dispose()).resolves.toMatchObject({
    logicalTerminal: true,
    cleanupComplete: true,
    cleanupErrors: []
  })
})

// Preserve exact reverse cleanup, native leaves and completion identity.
it('later native failure rolls back earlier owned resources in reverse order', async () => {
  /** The later install failure stays primary while the original two cleanup leaves remain ordered. */
  const rollback = new Error('observation later rollback')
  /** Only the two genuine registered callbacks append their actual release observations. */
  const releases: string[] = []
  /** Original callback errors must retain identity through the native rollback detail. */
  const firstCleanup = new Error('observation first cleanup')
  /** Separate identity makes reverse cleanup order observable without counting wrapper nodes. */
  const secondCleanup = new Error('observation second cleanup')
  /** The real transport belongs to the same native batch and has its own normal cleanup. */
  const server = coreMemoryServer('native-later-failure')
  /** One native runtime owns the complete rollback and final disposal. */
  const host = receivingHost()
  /** The primary receipt is observed after genuine native rollback has finished. */
  const failure = await host
    .use(
      server.transport,
      nativeLifecyclePlugin('native-observation-later-rollback-first', (core) => {
        core.onDispose(failingRelease(releases, 'first', firstCleanup))
      }),
      nativeLifecyclePlugin('native-observation-later-rollback-second', (core) => {
        core.onDispose(failingRelease(releases, 'second', secondCleanup))
      }),
      nativeLifecyclePlugin('native-observation-later-failure', () => {
        throw rollback
      })
    )
    .catch((error: unknown) => error)
  expect(failure).toMatchObject({
    name: 'PluginHostError',
    source: 'plugin.host',
    code: 'PLUGIN_INSTALL_FAILED',
    detail: { failedName: 'native-observation-later-failure' },
    cause: rollback
  })
  /** The original native detail contains raw cleanup leaves, not a reconstructed error list. */
  const rollbackErrors = (
    failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
  ).detail?.rollbackErrors
  expect(rollbackErrors).toHaveLength(2)
  /** This view only lends the existing detail array for the original exact-identity assertion. */
  const rollbackList = rollbackErrors as readonly unknown[]
  expect(rollbackList).toEqual([secondCleanup, firstCleanup])
  expect(releases).toEqual(['second', 'first'])
  /** The original native disposal remains stable after the failed transaction already rolled back. */
  const dispose = host.dispose()
  expect(host.dispose()).toBe(dispose)
  await dispose
  expect(host.dispose()).toBe(dispose)
})
