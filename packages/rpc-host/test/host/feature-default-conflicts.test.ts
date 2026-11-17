/** Host-wide call defaults and shared control aliases each have exactly one owner. */
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'
import { defineTransportPlugin, defineFlowPlugin } from '@migaia/rpc-host/sdk'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'

/** Empty native transports acquire no resources while exercising genuine installation. */
function openEmptyTransport() {
  return { dispose: disposeEmptyTransport }
}

/** No resource was acquired by the empty transport. */
function disposeEmptyTransport(): void {}

/** Host identity shared by every case; each case builds its own host. */
const self = { name: 'default-conflicts', instanceId: 'default-conflicts' }

/** Each host needs one transport; it declares no local features of its own. */
function emptyTransport() {
  return defineTransportPlugin({
    name: 'conflict-test',
    namespace: 'local',
    features: {},
    open: openEmptyTransport
  })
}

/** Two flow plugins contribute disjoint roles that both reach the namespace cache. */
async function disjointDefaultsMerge(): Promise<void> {
  const host = await createRpcHost({
    self,
    plugins: [
      defineFlowPlugin({
        name: 'rpc-link-policy',
        features: { replay: retryFeature({ attempts: 1 }) }
      }),
      defineFlowPlugin({ name: 'carrier', features: { budget: timeoutFeature({ ms: 100 }) } }),
      emptyTransport()
    ]
  })
  try {
    /** Both owners' caller aliases stay addressable through the namespace control table. */
    expect(typeof host.local.features.replay.run).toBe('function')
    expect(typeof host.local.features.budget.run).toBe('function')
  } finally {
    await host.close()
  }
}

/** A second host-wide owner of the same call role is rejected instead of replacing the first. */
async function duplicateDefaultRoleFails(): Promise<void> {
  await expect(
    createRpcHost({
      self,
      plugins: [
        defineFlowPlugin({
          name: 'rpc-link-policy',
          features: { first: retryFeature({ attempts: 1 }) }
        }),
        defineFlowPlugin({ name: 'carrier', features: { second: retryFeature({ attempts: 3 }) } }),
        emptyTransport()
      ]
    })
  ).rejects.toSatisfy(hasCode('FEATURE_ROLE_CONFLICT'))
}

/** Two shared carriers cannot publish one caller alias for different outputs. */
async function duplicateSharedAliasFails(): Promise<void> {
  await expect(
    createRpcHost({
      self,
      plugins: [
        defineFlowPlugin({ name: 'carrier-a', features: { policy: timeoutFeature({ ms: 100 }) } }),
        defineFlowPlugin({
          name: 'rpc-link-policy',
          features: { policy: retryFeature({ attempts: 1 }) }
        }),
        emptyTransport()
      ]
    })
  ).rejects.toSatisfy(hasCode(RpcCoreErrorCode.invalidConfig))
}

/**
 * Startup admission distinguishes late admission from duplicate names by starting without any
 * policy.
 */
async function latePolicyRejectedAfterStartup(): Promise<void> {
  const host = await createRpcHost({ self, plugins: [emptyTransport()] })
  try {
    await expect(
      host.use(
        defineFlowPlugin({
          name: 'rpc-link-policy',
          features: { late: retryFeature({ attempts: 2 }) }
        })
      )
    ).rejects.toMatchObject({
      name: 'TypeError',
      code: RpcCoreErrorCode.invalidConfig,
      message: 'RPC flow hooks cannot be installed after transport startup'
    })
    expect(Object.hasOwn(host.local.features, 'late')).toBe(false)
  } finally {
    await host.close()
  }
}

/** One flow plugin installs its observer and its call default in a single registration. */
async function observerAndDefaultsShareOnePlugin(): Promise<void> {
  /** Counts observer setups; each host installation must run it exactly once. */
  const setup = vi.fn(() => ({}))
  const host = await createRpcHost({
    self,
    plugins: [
      defineFlowPlugin({
        name: 'observed-defaults',
        features: { budget: timeoutFeature({ ms: 100 }) },
        setup
      }),
      emptyTransport()
    ]
  })
  try {
    expect(setup).toHaveBeenCalledTimes(1)
    expect(typeof host.local.features.budget.run).toBe('function')
  } finally {
    await host.close()
  }
}

/** Only a non-empty record makes a flow plugin cold-only; observers stay late-installable. */
async function observersInstallAfterStartup(): Promise<void> {
  /** Each late plugin is observed through its own setup call. */
  const setup = vi.fn(() => ({}))
  const host = await createRpcHost({ self, plugins: [emptyTransport()] })
  try {
    await host.use(defineFlowPlugin({ name: 'late-observer', setup }))
    await host.use(defineFlowPlugin({ name: 'late-empty-record', features: {}, setup }))
    await host.use(defineFlowPlugin({ name: 'late-noop' }))
    expect(setup).toHaveBeenCalledTimes(2)
  } finally {
    await host.close()
  }
}

/** Search the native install wrapper's cause chain for the semantic RPC code. */
function hasCode(code: string): (error: unknown) => boolean {
  return (error) => findCode(error, code, 0)
}

/** Bounded cause/errors traversal; native wrappers keep the original reachable. */
function findCode(error: unknown, code: string, depth: number): boolean {
  if (depth > 8 || error === null || typeof error !== 'object') return false
  if ((error as { code?: unknown }).code === code) return true
  /** Aggregate members are searched before the single cause. */
  const members = (error as { errors?: unknown }).errors
  if (Array.isArray(members))
    for (const member of members) if (findCode(member, code, depth + 1)) return true
  return findCode((error as { cause?: unknown }).cause, code, depth + 1)
}

describe('RPC host-wide feature defaults', registerCases)

/** One case per ownership rule. */
function registerCases(): void {
  it(
    'Startup admission rejects a late policy before any policy name was registered',
    latePolicyRejectedAfterStartup
  )
  it('merges disjoint roles from two flow plugins', disjointDefaultsMerge)
  it(
    'installs an observer and a call default from one flow plugin',
    observerAndDefaultsShareOnePlugin
  )
  it(
    'installs observer, empty-record and empty flow plugins after startup',
    observersInstallAfterStartup
  )
  it('rejects a second host-wide owner of one call role', duplicateDefaultRoleFails)
  it('rejects one shared control alias from two owners', duplicateSharedAliasFails)
}
