/** Compile host and transport placements using the original native Feature graph and outputs. */
import {
  definePlugin,
  type IPluginHostCore,
  type IFeatureRecord,
  type IDefinedPluginConstraint
} from '@migaia/plugin-host'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { IAbortSignal } from '@migaia/utils/promise'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.ts'
import { installRpcDefinition } from '../host/installation.ts'
import { RpcFlowSetup } from './flow-setup.ts'
import { RpcBuiltinFeature } from './flow-feature.ts'
import {
  readRpcDefinition,
  registerRpcDefinition,
  RpcDefinitionKind,
  type IRpcFlowEntry,
  type IRpcSharedFlows
} from './metadata.ts'
import type {
  IRpcFlowDefinition,
  IRpcFlowFeature,
  IRpcFlowSetupContext,
  IRpcHostPlugin,
  IRpcFlowPlugin,
  IRpcTransportPlugin
} from './types.ts'

/** The common native registration owns shared setup independently from transport lifetimes. */
const flowPluginName = 'rpc-flow-features'

/** Reject invalid configuration before a transport can acquire native resources. */
function invalidFeature(): never {
  throw tagRpcError(new TypeError(HostErrorText.pluginInvalid), RpcCoreErrorCode.invalidConfig)
}

/** Private capability identity prevents a display name from impersonating a builtin. */
function featureKey(feature: IRpcFlowFeature<object>): PropertyKey {
  /** Only SDK-authenticated opaque handles participate in flow selection. */
  const metadata = readRpcDefinition(feature)
  if (metadata?.kind !== RpcDefinitionKind.feature) return invalidFeature()
  return metadata.builtin ? RpcBuiltinFeature[metadata.builtin] : metadata.definition.name
}

/** Preserve installation order while choosing exactly one instance of each capability. */
function featureSelection(
  features: readonly IRpcFlowFeature<object>[]
): ReadonlyMap<PropertyKey, IRpcFlowFeature<object>> {
  /** Selection is cold and never scanned by a message execution. */
  const selected = new Map<PropertyKey, IRpcFlowFeature<object>>()
  for (const feature of features) {
    /** A duplicate capability must not acquire a second quota owner. */
    const key = featureKey(feature)
    if (selected.has(key))
      throw tagRpcError(
        new TypeError(HostErrorText.featureCombinationConflict),
        RpcCoreErrorCode.featureCombinationConflict
      )
    selected.set(key, feature)
  }
  return selected
}

/** Keep native pool, media and call-policy features with their existing transport installers. */
function transportFlows(features: readonly unknown[]): IRpcFlowFeature<object>[] {
  /** Observers and other native RPC definitions cannot impersonate transport-local Features. */
  const flows: IRpcFlowFeature<object>[] = []
  for (const feature of features) {
    /** Metadata authenticates the original native definition rather than structural fields. */
    const metadata = readRpcDefinition(feature)
    if (metadata) {
      if (metadata.kind !== RpcDefinitionKind.feature) invalidFeature()
      flows.push(feature as IRpcFlowFeature<object>)
      continue
    }
    /** Transport-native feature admission remains owned by that transport. */
    const kind = feature && typeof feature === 'object' && Reflect.get(feature, 'kind')
    if (typeof kind !== 'string') invalidFeature()
  }
  return flows
}

/** Project selected roots through native inspection without evaluating a Feature factory. */
function inspectSelection(selection: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>) {
  return inspectFeatures(
    Object.fromEntries(
      [...selection.values()].map((feature, index) => [String(index), feature])
    ) as IFeatureRecord
  )
}

/** Read the real registration's already-built output; setup and disposal stay native-owned. */
async function prepareEntry(
  core: IPluginHostCore,
  alias: string,
  feature: object,
  rootSignal: IAbortSignal,
  context: IRpcFlowSetupContext
): Promise<IRpcFlowEntry> {
  /** Native Feature output is the authoritative cold configuration for this exact registration. */
  const definition = (
    core as IPluginHostCore &
      Readonly<{ features: Readonly<Record<string, IRpcFlowDefinition<object>>> }>
  ).features[alias]!
  /** Only authenticated flow Features reach this preparation path. */
  const metadata = readRpcDefinition(feature)!
  return {
    definition,
    installed: await new RpcFlowSetup(definition).prepare(core, rootSignal, context),
    builtin: metadata.kind === RpcDefinitionKind.feature ? metadata.builtin : undefined
  }
}

/** One cold local program can be reused; every native transport installation prepares its own state. */
export class RpcTransportFlowProgram {
  /** Native registration builds these aliases, including dependency-only helper outputs. */
  readonly features: IFeatureRecord
  /** Explicit local capabilities override host placements without replacing native identities. */
  readonly #selection: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>
  /** Native dependency membership identifies local implicit placements without another graph. */
  readonly #local: ReadonlySet<object>
  /** Every local output is readable through the installing transport's original core. */
  readonly #aliases = new Map<object, string>()

  /** Capture authentic local roots without executing configuration or native acquisition. */
  constructor(features: readonly unknown[] = []) {
    this.#selection = featureSelection(transportFlows(features))
    /** Canonical inspection fixes dependency order and validates the original closure once. */
    const inspection = inspectSelection(this.#selection)
    /** Aliases expose original handles rather than rebuilding or wrapping their factories. */
    const roots: Record<string, IFeatureRecord[string]> = Object.create(null)
    for (const feature of inspection.ordered) {
      /** The complete closure must remain visible on core.features, not just explicit roots. */
      const alias = String(this.#aliases.size)
      this.#aliases.set(feature, alias)
      roots[alias] = feature
    }
    this.features = Object.freeze(roots)
    this.#local = new Set(inspection.ordered)
  }

  /** Combine native dependency order with host reuse and registration-local overrides. */
  async prepare(
    core: IPluginHostCore,
    rootSignal: IAbortSignal,
    context: IRpcFlowSetupContext,
    shared: IRpcSharedFlows
  ): Promise<readonly IRpcFlowEntry[]> {
    /** Whole-host roots retain their original relative order unless locally overridden. */
    const selected = new Map<PropertyKey, IRpcFlowFeature<object>>()
    for (const [key, feature] of shared.selection)
      if (!this.#selection.has(key)) selected.set(key, feature)
    for (const [key, feature] of this.#selection) selected.set(key, feature)
    /** Each physical namespace consumes a single dependency-first projection. */
    const entries: IRpcFlowEntry[] = []
    for (const feature of inspectSelection(selected).ordered) {
      /** Helper Features supply native outputs but contribute no RPC intervention. */
      const metadata = readRpcDefinition(feature)
      if (metadata?.kind !== RpcDefinitionKind.feature) continue
      /** An explicitly selected capability suppresses an older dependency's flow placement. */
      const key = metadata.builtin ? RpcBuiltinFeature[metadata.builtin] : metadata.definition.name
      const root = selected.get(key)
      if (root && root !== feature) continue
      /** An explicit host root wins over the same handle reached through a local dependency. */
      const local = root ? this.#selection.get(key) === feature : this.#local.has(feature)
      entries.push(
        local
          ? await prepareEntry(core, this.#aliases.get(feature)!, feature, rootSignal, context)
          : shared.entries.get(feature)!
      )
    }
    return Object.freeze(entries)
  }
}

/** Cold host composition owns all shared roots, even when current transports override them all. */
export class RpcFlowProgram {
  /** Observers and policies keep their genuine native registration identities. */
  readonly flows: readonly IRpcFlowPlugin[]
  /** Native transport installation remains a separate atomic batch after shared setup. */
  readonly transports: readonly IRpcTransportPlugin[]
  /** Host roots select one shared instance for each capability. */
  readonly #selection: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>
  /** The native wrapper builds the complete host closure independently from namespace inventory. */
  readonly #roots: IFeatureRecord
  /** Dependency-first handles preserve the canonical native order during shared setup. */
  readonly #ordered: readonly object[]
  /** Alias lookup reads only the original native wrapper's feature outputs. */
  readonly #aliases = new Map<object, string>()

  /** Classify cold definitions without executing Feature factories or transport acquisition. */
  constructor(plugins: readonly IRpcHostPlugin[]) {
    /** Host Features are prepared once, independently from transport-local selection. */
    const features: IRpcFlowFeature<object>[] = []
    /** Native readonly observer and policy definitions are installed unchanged. */
    const flows: IRpcFlowPlugin[] = []
    /** Transport metadata already owns its complete local native Feature program. */
    const transports: IRpcTransportPlugin[] = []
    for (const plugin of plugins) {
      /** Only original SDK registrations may join composition. */
      const metadata = readRpcDefinition(plugin)
      if (!metadata) invalidFeature()
      if (metadata.kind === RpcDefinitionKind.feature)
        features.push(plugin as IRpcFlowFeature<object>)
      else if (metadata.kind === RpcDefinitionKind.transport)
        transports.push(plugin as IRpcTransportPlugin)
      else if (
        metadata.kind === RpcDefinitionKind.flow ||
        metadata.kind === RpcDefinitionKind.policy
      )
        flows.push(plugin as IRpcFlowPlugin)
      else invalidFeature()
    }
    this.flows = Object.freeze(flows)
    this.transports = Object.freeze(transports)
    this.#selection = featureSelection(features)
    /** All host dependencies remain available to a transport installed in a later transaction. */
    const inspection = inspectSelection(this.#selection)
    /** The real native wrapper receives every original dependency as an output alias. */
    const roots: Record<string, IFeatureRecord[string]> = Object.create(null)
    for (const feature of inspection.ordered) {
      /** Alias order is native dependency order, not namespace or capability-name order. */
      const alias = String(this.#aliases.size)
      this.#aliases.set(feature, alias)
      roots[alias] = feature
    }
    this.#ordered = inspection.ordered
    this.#roots = Object.freeze(roots)
  }

  /** The one native wrapper owns shared setup and its original reverse cleanup. */
  plugin(): IDefinedPluginConstraint<Record<never, never>, never, Record<never, never>> {
    /** Metadata borrows this cold program without retaining an installed core. */
    const metadata = { kind: RpcDefinitionKind.features, prepare: this.#prepare }
    /** Native installation evaluates original factories and owns every setup disposer. */
    const plugin = definePlugin({
      name: flowPluginName,
      features: this.#roots,
      install: (core) => installRpcDefinition(core as unknown as IPluginHostCore, metadata)
    })
    registerRpcDefinition(plugin, metadata)
    return plugin as unknown as IDefinedPluginConstraint<
      Record<never, never>,
      never,
      Record<never, never>
    >
  }

  /** Prepare every shared flow once under this actual wrapper's native lifetime. */
  readonly #prepare = async (
    core: IPluginHostCore,
    rootSignal: IAbortSignal,
    context: IRpcFlowSetupContext
  ): Promise<IRpcSharedFlows> => {
    /** Exact opaque identity deduplicates roots and implicit dependencies through native order. */
    const entries = new Map<object, IRpcFlowEntry>()
    for (const feature of this.#ordered) {
      /** Dependency-only native helpers never acquire flow installation state. */
      const metadata = readRpcDefinition(feature)
      if (metadata?.kind !== RpcDefinitionKind.feature) continue
      entries.set(
        feature,
        await prepareEntry(core, this.#aliases.get(feature)!, feature, rootSignal, context)
      )
    }
    return Object.freeze({ selection: this.#selection, entries })
  }
}

/** Ordinary native hosts install the same shared wrapper before their transport batch. */
export function rpcFlowPlugin(
  plugins: readonly IRpcHostPlugin[]
): IDefinedPluginConstraint<Record<never, never>, never, Record<never, never>> {
  return new RpcFlowProgram(plugins).plugin()
}
