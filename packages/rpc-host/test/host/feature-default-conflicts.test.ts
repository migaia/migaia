/** Host-wide call defaults and shared control aliases each have exactly one owner. */
import { describe, expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature, retryFeature } from '@migaia/rpc-host/features'
import { linkPolicy } from '@migaia/rpc-host/plugins/link-policy'
import { defineTransportPlugin, rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
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

/** A link policy and a carrier contribute disjoint roles that both reach the namespace cache. */
async function disjointDefaultsMerge(): Promise<void> {
  const host = await createRpcHost({
    self,
    plugins: [
      linkPolicy({ features: { replay: retryFeature({ attempts: 1 }) } }),
      rpcFeaturesPlugin({ name: 'carrier', features: { budget: timeoutFeature({ ms: 100 }) } }),
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
        linkPolicy({ features: { first: retryFeature({ attempts: 1 }) } }),
        rpcFeaturesPlugin({ name: 'carrier', features: { second: retryFeature({ attempts: 3 }) } }),
        emptyTransport()
      ]
    })
  ).rejects.toSatisfy(hasCode(RpcCoreErrorCode.featureCombinationConflict))
}

/** Two shared carriers cannot publish one caller alias for different outputs. */
async function duplicateSharedAliasFails(): Promise<void> {
  await expect(
    createRpcHost({
      self,
      plugins: [
        rpcFeaturesPlugin({ name: 'carrier-a', features: { policy: timeoutFeature({ ms: 100 }) } }),
        linkPolicy({ features: { policy: retryFeature({ attempts: 1 }) } }),
        emptyTransport()
      ]
    })
  ).rejects.toSatisfy(hasCode(RpcCoreErrorCode.invalidConfig))
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
  it('merges disjoint roles from a link policy and a carrier', disjointDefaultsMerge)
  it('rejects a second host-wide owner of one call role', duplicateDefaultRoleFails)
  it('rejects one shared control alias from two owners', duplicateSharedAliasFails)
}
