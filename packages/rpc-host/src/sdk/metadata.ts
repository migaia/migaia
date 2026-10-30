/** Authenticate exact SDK-created native definitions; no host/session lifetime is stored here. */
import type { IFeature, IFeatureRecord, IPluginHostCore } from '@migaia/plugin-host'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcTransportDefinition } from '@migaia/rpc-contract/interfaces'
import type {
  IRpcFlowDefinition,
  IRpcFlowFeature,
  IRpcFlowInstallation,
  IRpcFlowSetupContext,
  IRpcLinkPolicyDefinition,
  IRpcTransportSetupContext
} from './types.ts'
import { RpcBuiltinFeature, type IRpcBuiltinFeature } from './flow-feature.ts'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.ts'
import type { RpcTransportFlowProgram } from './flow-program.ts'

/** Prepared placements retain native Feature identity and one actual setup result. */
export type IRpcFlowEntry = Readonly<{
  /** The original native identity connects placement to its declared dependencies. */
  feature: object
  definition: IRpcFlowDefinition<object>
  installed: IRpcFlowInstallation<object>
  builtin?: IRpcBuiltinFeature
}>

/** One native wrapper owns every host root and its exact once-prepared dependency closure. */
export type IRpcSharedFlows = Readonly<{
  selection: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>
  entries: ReadonlyMap<object, IRpcFlowEntry>
  /** Caller aliases address native root outputs without exposing private dependency aliases. */
  controls: Readonly<Record<string, object>>
}>

/** SDK definition kinds are private admission facts, never caller-supplied discriminators. */
export const RpcDefinitionKind = {
  transport: 'transport',
  source: 'source',
  flow: 'flow',
  policy: 'policy',
  feature: 'feature',
  features: 'features',
  callFeature: 'call-feature',
  nativeFeature: 'native-feature'
} as const

/** Exact native definitions carry their private resource-admission adapter outside public SDK types. */
export type IRpcDefinitionMetadata = Readonly<
  | {
      kind: 'transport'
      definition: IRpcTransportDefinition<IFeatureRecord, object, IRpcTransportSetupContext>
      flows: RpcTransportFlowProgram
    }
  | {
      kind: 'source'
      namespace: string
      definition: IRpcTransportDefinition<IFeatureRecord, object, IRpcTransportSetupContext>
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
      features: IFeatureRecord
      prepare(
        core: IPluginHostCore,
        rootSignal: IAbortSignal,
        context: IRpcFlowSetupContext
      ): Promise<IRpcSharedFlows>
    }
  | { kind: 'call-feature'; role: 'timeout' | 'retry' }
  | { kind: 'native-feature'; role: string }
>

/** Cold role projection is consumed only during definition/configuration and installation. */
export type IRpcFeatureMetadata = Readonly<{
  category: 'call' | 'flow' | 'native'
  role: PropertyKey
}>

/** The two fixed call-role keys select installed execution outputs at cold configuration. */
export const RpcCallFeatureRole = { timeout: 'timeout', retry: 'retry' } as const

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

/** Call factories register only their native identity; execution lives in the native output. */
export function registerRpcFeature(
  feature: IFeature<any, any, any>,
  metadata: Readonly<{ role: 'timeout' | 'retry' }>
): void {
  registerRpcDefinition(feature, { kind: RpcDefinitionKind.callFeature, role: metadata.role })
}

/** Transport packages register their own role vocabulary without gaining call/flow identity. */
export function registerRpcNativeFeature(
  feature: IFeature<any, any, any>,
  metadata: Readonly<{ role: string }>
): void {
  registerRpcDefinition(feature, { kind: RpcDefinitionKind.nativeFeature, role: metadata.role })
}

/** Exact native identities authenticate roles without reading public fields from a feature. */
export function readRpcFeature(feature: unknown): IRpcFeatureMetadata | undefined {
  /** One identity authority owns definitions and feature roles across the RPC SDK. */
  const metadata = readRpcDefinition(feature)
  if (metadata?.kind === RpcDefinitionKind.callFeature)
    return { category: 'call', role: metadata.role }
  if (metadata?.kind === RpcDefinitionKind.nativeFeature)
    return { category: 'native', role: metadata.role }
  if (metadata?.kind === RpcDefinitionKind.feature)
    return {
      category: 'flow',
      role: metadata.builtin ? RpcBuiltinFeature[metadata.builtin] : metadata.definition.name
    }
  return undefined
}

/** Native open hooks select their exact installed output once, before call/message execution. */
export function findRpcNativeFeatureOutput<TOutput extends object>(
  features: IFeatureRecord | undefined,
  owner: IRpcTransportSetupContext['owner'],
  role: PropertyKey
): TOutput | undefined {
  /** A role has one owner in this native registration, regardless of the caller's local alias. */
  let selected: TOutput | undefined
  for (const [alias, feature] of Object.entries(features ?? {})) {
    /** Metadata authenticates role identity; outputs come from the genuine installing core. */
    const metadata = readRpcFeature(feature)
    if (metadata?.category !== 'native' || metadata.role !== role) continue
    if (selected !== undefined)
      throw tagRpcError(
        new TypeError(HostErrorText.featureCombinationConflict),
        RpcCoreErrorCode.featureCombinationConflict
      )
    selected = owner.features[alias] as TOutput
  }
  return selected
}
