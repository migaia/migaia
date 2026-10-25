/** Join SDK definitions to their genuine native receiving host without creating another plugin-host. */
import { getPluginRuntimeIntegration, type IPluginHostCore } from '@migaia/plugin-host'
import type { IRpcDefinitionMetadata } from '../sdk/metadata.js'
import { rpcPipelineOwner, type IRpcNativePipelineCore } from '../sdk/flow-pipelines.js'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from './error-text.js'
import { RpcHost } from './rpc-host.js'

/** Only createRpcHost supplies this private domain field on its actual native installation core. */
export const rpcInstallationOwner = Symbol('rpc-installation-owner')

/** Ordinary native hosts share one RPC owner under their authenticated native identity. */
const ordinaryOwners = new WeakMap<object, RpcHost>()

/** Native hooks remain the only acquisition path; their original transaction owns rollback. */
export async function installRpcDefinition(
  core: IPluginHostCore,
  metadata: IRpcDefinitionMetadata
): Promise<Record<never, never>> {
  /** Canonical native integration rejects forged structural cores before any resource opens. */
  const integration = getPluginRuntimeIntegration(core)
  /** Specialized hosts lend the exact owner already created for their one defineHost call. */
  const direct = Reflect.get(core, rpcInstallationOwner) as RpcHost | undefined
  /** Ordinary hosts reuse the authenticated identity, never a namespace supplied by a caller. */
  let owner = direct ?? ordinaryOwners.get(integration.identity)
  if (!owner || (!direct && owner.closed)) {
    /** Only the actual native host owner may lend execution; a plugin core carries registration. */
    const pipelines = Reflect.get(core, rpcPipelineOwner) as
      | IRpcNativePipelineCore[typeof rpcPipelineOwner]
      | undefined
    if (!pipelines || !integration.matchesHost(pipelines.host))
      throw tagRpcError(
        new TypeError(HostErrorText.nativePipelinesRequired),
        RpcCoreErrorCode.invalidConfig
      )
    owner = new RpcHost(
      {
        self: { name: integration.identity.name, instanceId: integration.identity.id },
        report: integration.report
      },
      integration.nodeId,
      false,
      pipelines
    )
    ordinaryOwners.set(integration.identity, owner)
  }
  await owner.install(core, metadata)
  return {}
}
