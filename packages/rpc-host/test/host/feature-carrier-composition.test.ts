/** Shared feature carriers compose with transports and reject ambiguous or late placements. */
import { describe, expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { timeoutFeature } from '@migaia/rpc-host/features'
import { defineFlowFeature, defineTransportPlugin, rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { defineFeature, definePlugin, type IFeatureRecord } from '@migaia/plugin-host'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'

/** Empty native transports acquire no resources while exercising genuine installation. */
function openEmptyTransport() {
  return { dispose: disposeEmptyTransport }
}

/** No resource was acquired by the empty transport. */
function disposeEmptyTransport(): void {}

/** Flow setup with no stages or callbacks; only its placement is observed. */
function emptySetup() {
  return {}
}

/** Host identity shared by every case; each case builds its own host. */
const self = { name: 'carrier-composition', instanceId: 'carrier-composition' }

/** One transport with an optional local feature record. */
function transport(features: IFeatureRecord = {}) {
  return defineTransportPlugin({
    name: 'carrier-transport',
    namespace: 'local',
    features,
    open: openEmptyTransport
  })
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

/** A shared flow role, a local override of it, and a helper feature install and close cleanly. */
async function carrierAndLocalOverrideCompose(): Promise<void> {
  const shared = defineFlowFeature({ name: 'compose-flow', phase: 1, setup: emptySetup })
  const local = defineFlowFeature({ name: 'compose-flow', phase: 2, setup: emptySetup })
  /** A plugin-host feature with no RPC role is installed as a helper output only. */
  const helper = defineFeature(() => ({ value: 1 }))
  const host = await createRpcHost({
    self,
    plugins: [
      rpcFeaturesPlugin({
        name: 'carrier',
        features: { shared, helper, budget: timeoutFeature({ ms: 100 }) }
      }),
      transport({ local })
    ]
  })
  try {
    expect(Object.keys(host.local.features).sort()).toEqual(['budget', 'helper', 'local', 'shared'])
  } finally {
    await host.close()
  }
}

/** Two carriers that both own one flow role are rejected. */
async function duplicateSharedFlowRoleFails(): Promise<void> {
  await expect(
    createRpcHost({
      self,
      plugins: [
        rpcFeaturesPlugin({
          name: 'carrier-a',
          features: { a: defineFlowFeature({ name: 'dup-flow', phase: 1, setup: emptySetup }) }
        }),
        rpcFeaturesPlugin({
          name: 'carrier-b',
          features: { b: defineFlowFeature({ name: 'dup-flow', phase: 2, setup: emptySetup }) }
        }),
        transport()
      ]
    })
  ).rejects.toSatisfy(hasCode(RpcCoreErrorCode.featureCombinationConflict))
}

/** Plugins that are not RPC definitions are rejected before any host work. */
function foreignPluginFails(): void {
  expect(() =>
    createRpcHost({
      self,
      plugins: [definePlugin({ name: 'foreign', install: () => ({}) }) as never, transport()]
    })
  ).toThrow(TypeError)
}

/** A carrier cannot be added after the host started its information flow. */
async function lateCarrierFails(): Promise<void> {
  const host = await createRpcHost({ self, plugins: [transport()] })
  try {
    await expect(
      host.use(rpcFeaturesPlugin({ features: { t: timeoutFeature({ ms: 10 }) } }))
    ).rejects.toSatisfy(hasCode(RpcCoreErrorCode.invalidConfig))
  } finally {
    await host.close()
  }
}

describe('RPC shared feature carriers', registerCases)

/** A started host rejects a later plugin that is not an RPC definition. */
async function lateForeignPluginFails(): Promise<void> {
  const host = await createRpcHost({ self, plugins: [transport()] })
  try {
    await expect(
      host.use(definePlugin({ name: 'late-foreign', install: () => ({}) }) as never)
    ).rejects.toThrow(TypeError)
  } finally {
    await host.close()
  }
}

/** A transport-local helper dependency and a shared flow of another role both compose. */
async function localHelperAndSharedFlowCompose(): Promise<void> {
  const shared = defineFlowFeature({ name: 'shared-only-flow', phase: 3, setup: emptySetup })
  const helper = defineFeature(() => ({ value: 2 }))
  const local = defineFlowFeature({ name: 'local-only-flow', phase: 4, setup: emptySetup })
  const host = await createRpcHost({
    self,
    plugins: [rpcFeaturesPlugin({ features: { shared } }), transport({ helper, local })]
  })
  try {
    expect(Object.keys(host.local.features).sort()).toEqual(['helper', 'local', 'shared'])
  } finally {
    await host.close()
  }
}

/** One case per composition rule. */
function registerCases(): void {
  it('composes a shared role, a local override and a helper', carrierAndLocalOverrideCompose)
  it('rejects two carriers owning one flow role', duplicateSharedFlowRoleFails)
  it('rejects a plugin that is not an RPC definition', foreignPluginFails)
  it('rejects a carrier added after startup', lateCarrierFails)
  it('rejects a foreign plugin added after startup', lateForeignPluginFails)
  it('composes a local helper with a shared flow of another role', localHelperAndSharedFlowCompose)
}
