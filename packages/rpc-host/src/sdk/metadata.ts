/** Authenticate exact SDK-created native definitions; no host/session lifetime is stored here. */
import type { IPluginHostCore } from '@migaia/plugin-host'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcTransportDefinition } from '@migaia/rpc-contract/interfaces'
import type {
  IRpcFlowDefinition,
  IRpcFlowFeature,
  IRpcFlowInstallation,
  IRpcFlowSetupContext,
  IRpcLinkPolicyDefinition,
  IRpcTransportSetupContext
} from './types.js'
import type { IRpcBuiltinFeature } from './flow-feature.js'
import type { RpcTransportFlowProgram } from './flow-program.js'

/** Prepared placements retain native Feature identity and one actual setup result. */
export type IRpcFlowEntry = Readonly<{
  definition: IRpcFlowDefinition<object>
  installed: IRpcFlowInstallation<object>
  builtin?: IRpcBuiltinFeature
}>

/** One native wrapper owns every host root and its exact once-prepared dependency closure. */
export type IRpcSharedFlows = Readonly<{
  selection: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>
  entries: ReadonlyMap<object, IRpcFlowEntry>
}>

/** SDK definition kinds are private admission facts, never caller-supplied discriminators. */
export const RpcDefinitionKind = {
  transport: 'transport',
  source: 'source',
  flow: 'flow',
  policy: 'policy',
  feature: 'feature',
  features: 'features'
} as const

/** Exact native definitions carry their private resource-admission adapter outside public SDK types. */
export type IRpcDefinitionMetadata = Readonly<
  | {
      kind: 'transport'
      definition: IRpcTransportDefinition<unknown, object, IRpcTransportSetupContext>
      flows: RpcTransportFlowProgram
    }
  | {
      kind: 'source'
      namespace: string
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
  | {
      kind: 'feature'
      definition: IRpcFlowDefinition<object>
      /** Only package-owned factories may assign a built-in capability identity. */
      builtin?: IRpcBuiltinFeature
    }
  | {
      kind: 'features'
      prepare(
        core: IPluginHostCore,
        rootSignal: IAbortSignal,
        context: IRpcFlowSetupContext
      ): Promise<IRpcSharedFlows>
    }
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
