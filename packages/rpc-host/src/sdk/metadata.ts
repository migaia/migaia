/** Authenticate exact SDK-created native definitions; no host/session lifetime is stored here. */
import type { IPluginHostCore } from '@migaia/plugin-host'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcTransportDefinition } from '@migaia/rpc-contract/interfaces'
import type {
  IRpcFlowDefinition,
  IRpcFlowInstallation,
  IRpcFlowSetupContext,
  IRpcLinkPolicyDefinition,
  IRpcTransportSetupContext
} from './types.js'

/** Exact native definitions carry their private resource-admission adapter outside public SDK types. */
export type IRpcDefinitionMetadata = Readonly<
  | {
      kind: 'transport'
      definition: IRpcTransportDefinition<unknown, object, IRpcTransportSetupContext>
    }
  | {
      kind: 'flow'
      definition: IRpcFlowDefinition<object>
      prepare(
        core: IPluginHostCore,
        rootSignal: IAbortSignal,
        context: IRpcFlowSetupContext
      ): Promise<IRpcFlowInstallation<object>>
    }
  | { kind: 'policy'; definition: IRpcLinkPolicyDefinition }
>

/** Definitions are configuration-only and disappear when their native identity is unreachable. */
const definitions = new WeakMap<object, IRpcDefinitionMetadata>()

/** Register only after canonical native admission has frozen the real definition object. */
export function registerRpcDefinition(plugin: object, metadata: IRpcDefinitionMetadata): void {
  definitions.set(plugin, Object.freeze(metadata))
}

/** Caller-supplied fields, copies and prototypes cannot impersonate the registered identity. */
export function readRpcDefinition(plugin: unknown): IRpcDefinitionMetadata | undefined {
  return plugin !== null && (typeof plugin === 'object' || typeof plugin === 'function')
    ? definitions.get(plugin)
    : undefined
}
