/** Reuses a genuine native source definition inside an already cold-declared RPC namespace. */
import { definePlugin, type IDefinedPluginConstraint } from '@migaia/plugin-host'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { RpcDefinition } from './define.ts'
import { HostErrorText } from '../host/error-text.ts'
import {
  readRpcDefinition,
  registerRpcDefinition,
  RpcDefinitionKind,
  type IRpcDefinitionMetadata
} from './metadata.ts'
import type { IRpcTransportPlugin } from './types.ts'

/**
 * Attach an original native source to one already-declared namespace. Its original namespace key
 * publishes native extensions only; the source creates no namespace pipeline group or local flow.
 */
export function defineRpcSourcePlugin(
  transport: IRpcTransportPlugin,
  namespace: string
): IDefinedPluginConstraint<Record<never, never>, never, Record<never, never>> {
  /** Weak SDK identity prevents structural definitions from acquiring source authority. */
  const original = readRpcDefinition(transport)
  if (
    original?.kind !== RpcDefinitionKind.transport ||
    typeof namespace !== 'string' ||
    !namespace ||
    Object.values(original.definition.features ?? {}).some((feature) => {
      /** Native resource features stay source-owned; local flow definitions cannot change groups. */
      const kind = readRpcDefinition(feature)?.kind
      return (
        kind === RpcDefinitionKind.feature ||
        kind === RpcDefinitionKind.flow ||
        kind === RpcDefinitionKind.features ||
        kind === RpcDefinitionKind.policy
      )
    })
  )
    throw tagRpcError(new TypeError(HostErrorText.pluginInvalid), RpcCoreErrorCode.invalidConfig)
  /** Original source-local native options remain untouched; flow placement belongs to namespace. */
  const metadata: IRpcDefinitionMetadata = {
    kind: RpcDefinitionKind.source,
    namespace,
    definition: original.definition
  }
  /** Only the shared native definition installer receives the genuine source metadata. */
  const plugin = definePlugin({
    name: original.definition.name,
    features: original.definition.features,
    install: new RpcDefinition(metadata).install
  })
  registerRpcDefinition(plugin, metadata)
  return plugin
}
