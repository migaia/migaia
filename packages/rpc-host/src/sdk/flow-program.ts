/** Compile cold placements and lend their actual native Feature outputs to one common adapter. */
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
import { RpcCallFeatureKind } from '@migaia/rpc-contract/interfaces'
import { HostErrorText } from '../host/error-text.js'
import { installRpcDefinition } from '../host/installation.js'
import { RpcFlowSetup } from './flow-setup.js'
import { RpcNativeFeatureKind } from './native-feature-types.js'
import { RpcBuiltinFeature } from './flow-feature.js'
import {
  readRpcDefinition,
  registerRpcDefinition,
  RpcDefinitionKind,
  type IRpcFlowEntry
} from './metadata.js'
import type {
  IRpcFlowDefinition,
  IRpcFlowFeature,
  IRpcFlowSetupContext,
  IRpcHostPlugin,
  IRpcFlowPlugin,
  IRpcTransportPlugin
} from './types.js'

/** The single SDK registration name is stable across hosts; each install has independent state. */
const flowPluginName = 'rpc-flow-features'

/** Each placement shares a host instance or owns one namespace-local override instance. */
type IFlowPlacement = Readonly<{ feature: IRpcFlowFeature<object>; scope?: string }>

/** Reject invalid configuration before a transport can acquire native resources. */
function invalidFeature(): never {
  throw tagRpcError(new TypeError(HostErrorText.pluginInvalid), RpcCoreErrorCode.invalidConfig)
}

/** Read only authenticated Feature configuration; names cannot impersonate a built-in capability. */
function featureKey(feature: IRpcFlowFeature<object>): PropertyKey {
  /** SDK metadata is private and was attached only to the original native identity. */
  const metadata = readRpcDefinition(feature)
  if (metadata?.kind !== RpcDefinitionKind.feature) return invalidFeature()
  return metadata.builtin ? RpcBuiltinFeature[metadata.builtin] : metadata.definition.name
}

/** One scope chooses at most one implementation of each capability before native graph inspection. */
function featureSelection(
  features: readonly IRpcFlowFeature<object>[]
): Map<PropertyKey, IRpcFlowFeature<object>> {
  /** Insertion order remains the caller's installation order within each native dependency bucket. */
  const selected = new Map<PropertyKey, IRpcFlowFeature<object>>()
  for (const feature of features) {
    /** The same capability cannot consume two quota owners in a single placement. */
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

/** Select information-flow Features while preserving transport-owned pool and call policies. */
function transportFlows(features: readonly unknown[] = []): IRpcFlowFeature<object>[] {
  /** Only the same genuine opaque handles may join the common native wrapper. */
  const flows: IRpcFlowFeature<object>[] = []
  for (const feature of features) {
    /** A native observer/policy/transport in this list is an explicit invalid placement. */
    const metadata = readRpcDefinition(feature)
    if (metadata) {
      if (metadata.kind !== RpcDefinitionKind.feature) invalidFeature()
      flows.push(feature as IRpcFlowFeature<object>)
      continue
    }
    /** Existing transport policies keep their canonical installers and are not reimplemented here. */
    const kind = feature && typeof feature === 'object' && Reflect.get(feature, 'kind')
    if (
      kind !== RpcCallFeatureKind.timeout &&
      kind !== RpcCallFeatureKind.retry &&
      kind !== RpcNativeFeatureKind.pool
    )
      invalidFeature()
  }
  return flows
}

/**
 * Cold programs contain definitions and placements only; running resources belong to native
 * install.
 */
export class RpcFlowProgram {
  /** Namespace declarations are fixed before defineHost constructs any pipeline. */
  readonly namespaces: readonly string[]
  /** Policy and readonly observer plugins retain their real native registration identities. */
  readonly flows: readonly IRpcFlowPlugin[]
  /** Native transport installation remains a second transaction after flow commit. */
  readonly transports: readonly IRpcTransportPlugin[]
  /** All native local dependencies are roots so their original outputs remain readable on core. */
  readonly #roots: Record<string, IRpcFlowFeature<object>> = Object.create(null)
  /** Each original opaque handle has exactly one native root alias, including implicit dependencies. */
  readonly #aliases = new Map<object, string>()
  /**
   * Native dependency order is projected separately for each namespace's actual selected
   * placements.
   */
  readonly #groups = new Map<string, readonly IFlowPlacement[]>()

  /** Inspect trusted handles without executing any Feature factory or flow setup. */
  constructor(plugins: readonly IRpcHostPlugin[], additionalNamespaces: readonly string[] = []) {
    /** Whole-host placements share one setup result across every group that selects them. */
    const hostFeatures: IRpcFlowFeature<object>[] = []
    /** Namespace-local placements are captured from the original real transport definitions. */
    const locals = new Map<string, readonly IRpcFlowFeature<object>[]>()
    /** Native observers/policies are deliberately outside the information-flow wrapper. */
    const flows: IRpcFlowPlugin[] = []
    /**
     * Transport definitions retain their original object identity for native rollback and
     * replacement.
     */
    const transports: IRpcTransportPlugin[] = []
    for (const plugin of plugins) {
      /** Only SDK-authenticated handles participate in RPC composition. */
      const metadata = readRpcDefinition(plugin)
      if (!metadata) invalidFeature()
      if (metadata.kind === RpcDefinitionKind.feature)
        hostFeatures.push(plugin as IRpcFlowFeature<object>)
      else if (metadata.kind === RpcDefinitionKind.transport) {
        transports.push(plugin as IRpcTransportPlugin)
        locals.set(metadata.definition.namespace, transportFlows(metadata.definition.features))
      } else if (
        metadata.kind === RpcDefinitionKind.flow ||
        metadata.kind === RpcDefinitionKind.policy
      )
        flows.push(plugin as IRpcFlowPlugin)
      else invalidFeature()
    }
    this.namespaces = Object.freeze([...new Set([...additionalNamespaces, ...locals.keys()])])
    this.transports = Object.freeze(transports)
    this.flows = Object.freeze(flows)
    /** Selection precedes graph projection; no namespace performs a hot-path feature scan. */
    const shared = featureSelection(hostFeatures)
    for (const namespace of this.namespaces)
      this.#group(namespace, shared, featureSelection(locals.get(namespace) ?? []))
  }

  /** Wrap every placement in the same genuine native plugin; no per-capability plugin exists. */
  plugin(): IDefinedPluginConstraint<Record<never, never>, never, Record<never, never>> {
    /** Native Feature factories produce cold definitions before this actual install callback runs. */
    const metadata = { kind: RpcDefinitionKind.features, prepare: this.#prepare }
    /**
     * The native graph owns identity deduplication, output construction, stages and rollback
     * leases.
     */
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

  /**
   * Native inspection supplies dependency order; local overrides replace the host capability only
   * here.
   */
  #group(
    namespace: string,
    shared: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>,
    local: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>
  ): void {
    /** Every selected root retains its placement identity independently of its reusable cold handle. */
    const selected = new Map<PropertyKey, IFlowPlacement>()
    for (const [key, feature] of shared) if (!local.has(key)) selected.set(key, { feature })
    for (const [key, feature] of local) selected.set(key, { feature, scope: namespace })
    /** Canonical native topology is reused rather than constructing a second dependency graph. */
    const inspection = inspectFeatures(
      Object.fromEntries(
        [...selected.values()].map((value, index) => [String(index), value.feature])
      ) as IFeatureRecord
    )
    /**
     * Implicit local dependencies share their local placement unless explicitly selected at Host
     * scope.
     */
    const localDependencies = new Set(
      inspectFeatures(
        Object.fromEntries([...local.values()].map((feature, index) => [String(index), feature]))
      ).ordered
    )
    /** Dependency-only helper Features remain native factories but do not acquire flow state. */
    const placements: IFlowPlacement[] = []
    for (const feature of inspection.ordered) {
      if (!this.#aliases.has(feature)) {
        /** This alias only exposes the same native handle's already deduplicated cold output. */
        const alias = String(this.#aliases.size)
        this.#aliases.set(feature, alias)
        this.#roots[alias] = feature as IRpcFlowFeature<object>
      }
      /** Only authenticated flow definitions can contribute stages or negotiation facts. */
      const metadata = readRpcDefinition(feature)
      if (metadata?.kind !== RpcDefinitionKind.feature) continue
      /**
       * Selected overrides suppress the older dependency's flow placement without replacing its
       * native identity.
       */
      const key = metadata.builtin ? RpcBuiltinFeature[metadata.builtin] : metadata.definition.name
      const placement = selected.get(key)
      if (placement && placement.feature !== feature) continue
      placements.push(
        placement ?? {
          feature: feature as IRpcFlowFeature<object>,
          scope: localDependencies.has(feature) ? namespace : undefined
        }
      )
    }
    this.#groups.set(namespace, Object.freeze(placements))
  }

  /** Prepare shared resources once and each local placement independently under the wrapper's lease. */
  readonly #prepare = async (
    core: IPluginHostCore,
    rootSignal: IAbortSignal,
    context: IRpcFlowSetupContext
  ): Promise<ReadonlyMap<string, readonly IRpcFlowEntry[]>> => {
    /** The actual Host wrapper, not a namespace, owns in-progress dispatch stage lifetime. */
    const shared = new Map<object, IRpcFlowEntry>()
    /**
     * Local placements remain independent even when the same cold handle is reused in two
     * transports.
     */
    const local = new Map<string, Map<object, IRpcFlowEntry>>()
    /** All groups register only after setup succeeds, so failure retains native atomic rollback. */
    const groups = new Map<string, readonly IRpcFlowEntry[]>()
    for (const [namespace, placements] of this.#groups) {
      /** One group's entries preserve native dependency/install order without a stage executor. */
      const entries: IRpcFlowEntry[] = []
      for (const placement of placements) {
        /**
         * Local scope selects a distinct instance cache; shared placements reuse the exact host
         * owner.
         */
        let cache = shared
        if (placement.scope !== undefined) {
          if (!local.has(placement.scope)) local.set(placement.scope, new Map())
          cache = local.get(placement.scope)!
        }
        /** The same selected placement can be reached through several native dependencies. */
        let entry = cache.get(placement.feature)
        if (!entry) {
          /** Native core supplies the genuine output; configuration is never evaluated manually. */
          const definition = (
            core as IPluginHostCore &
              Readonly<{ features: Readonly<Record<string, IRpcFlowDefinition<object>>> }>
          ).features[this.#aliases.get(placement.feature)!]!
          /** Private capability identity is unrelated to the public display name. */
          const metadata = readRpcDefinition(placement.feature)!
          entry = {
            definition,
            installed: await new RpcFlowSetup(definition).prepare(core, rootSignal, context),
            builtin: metadata.kind === RpcDefinitionKind.feature ? metadata.builtin : undefined
          }
          cache.set(placement.feature, entry)
        }
        entries.push(entry)
      }
      groups.set(namespace, Object.freeze(entries))
    }
    return groups
  }
}

/** Ordinary native hosts use the same common adapter with their cold namespace declarations. */
export function rpcFlowPlugin(
  plugins: readonly IRpcHostPlugin[],
  namespaces: readonly string[] = []
): IDefinedPluginConstraint<Record<never, never>, never, Record<never, never>> {
  return new RpcFlowProgram(plugins, namespaces).plugin()
}
