/** Join SDK definitions to their genuine native receiving host without creating another plugin-host. */
import { getPluginRuntimeIntegration, type IPluginHostCore } from '@migaia/plugin-host'
import type { IRpcDefinitionMetadata } from '../sdk/metadata.js'
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
    owner = new RpcHost(
      {
        self: { name: integration.identity.name, instanceId: integration.identity.id },
        report: integration.report
      },
      integration.nodeId,
      false
    )
    ordinaryOwners.set(integration.identity, owner)
  }
  await owner.install(core, metadata)
  return {}
}
