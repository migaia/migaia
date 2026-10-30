/** Compile explicit native feature carriers and transport placements before traffic starts. */
import {
  definePlugin,
  type IPluginHostCore,
  type IFeatureRecord,
  type IFeatureInspection
} from '@migaia/plugin-host'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { IAbortSignal } from '@migaia/utils/promise'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.ts'
import { installRpcDefinition } from '../host/installation.ts'
import { RpcFlowSetup } from './flow-setup.ts'
import {
  readRpcDefinition,
  readRpcFeature,
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
  IRpcTransportPlugin,
  IRpcTransportFeatureExtensions
} from './types.ts'

/** Default identity belongs to the caller-visible native feature carrier. */
const flowPluginName = 'rpc-flow-features'
/** Generated aliases expose dependency outputs only to the owning native install hook. */
const dependencyAliasPrefix = '$rpc-dependency:'

/** Invalid feature placement fails before a transport can acquire native resources. */
function invalidFeature(): never {
  throw tagRpcError(new TypeError(HostErrorText.pluginInvalid), RpcCoreErrorCode.invalidConfig)
}

/**
 * Keep RPC role placement errors in its domain while native inspection owns record shape, opaque
 * identity and graph validation. A call-policy record admits only authenticated call roots.
 */
export function inspectRpcFeatures<F extends IFeatureRecord>(
  features: F,
  callOnly = false
): IFeatureInspection<F> {
  if (features !== null && typeof features === 'object' && !Array.isArray(features)) {
    for (const key of Reflect.ownKeys(features)) {
      if (typeof key !== 'string') continue
      /** Read data descriptors only; accessors and other native record errors stay native-owned. */
      const descriptor = Object.getOwnPropertyDescriptor(features, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) continue
      /** One metadata owner distinguishes known SDK plugins from actual feature-role identities. */
      const definition = readRpcDefinition(descriptor.value)
      /** Unknown identities reach canonical native admission before RPC can interpret their role. */
      const role = readRpcFeature(descriptor.value)
      if (definition && (!role || (callOnly && role.category !== 'call'))) invalidFeature()
    }
  }
  /** Preserve the exact native rejection and graph error without wrapping or replacing it. */
  const inspection = inspectFeatures(features)
  if (callOnly)
    for (const feature of Object.values(inspection.roots))
      if (readRpcFeature(feature)?.category !== 'call') invalidFeature()
  return inspection
}

/** Admit each private role once while retaining the caller's arbitrary local aliases. */
function selectFlows(features: IFeatureRecord): ReadonlyMap<PropertyKey, IRpcFlowFeature<object>> {
  /** Call, flow and transport-native roles share the same scope conflict rule. */
  const roles = {
    call: new Set<PropertyKey>(),
    flow: new Set<PropertyKey>(),
    native: new Set<PropertyKey>()
  }
  /** Only flow roots contribute information-flow placement. */
  const selected = new Map<PropertyKey, IRpcFlowFeature<object>>()
  for (const feature of Object.values(features)) {
    /** Native inspection separately authenticates helpers with no RPC-specific role. */
    const metadata = readRpcFeature(feature)
    if (!metadata) continue
    if (roles[metadata.category].has(metadata.role))
      throw tagRpcError(
        new TypeError(HostErrorText.featureCombinationConflict),
        RpcCoreErrorCode.featureCombinationConflict
      )
    roles[metadata.category].add(metadata.role)
    if (metadata.category === 'flow')
      selected.set(metadata.role, feature as IRpcFlowFeature<object>)
  }
  return selected
}

/** Native inspection determines dependency setup; aliases never determine execution order. */
function inspectSelection(selection: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>) {
  return inspectFeatures(
    Object.fromEntries(
      [...selection.values()].map((feature, index) => [String(index), feature])
    ) as IFeatureRecord
  )
}

/** Read the actual registration's synchronous output, including dependency-only flow outputs. */
function readOutput(core: IPluginHostCore, alias: string): object {
  return (core as IPluginHostCore & Readonly<{ features: Readonly<Record<string, object>> }>)
    .features[alias]!
}

/** Native rollback owns setup and disposal through the original registration core. */
async function prepareEntry(
  core: IPluginHostCore,
  alias: string,
  feature: object,
  rootSignal: IAbortSignal,
  context: IRpcFlowSetupContext
): Promise<IRpcFlowEntry> {
  /** Only a native-built output supplies the setup definition for this exact registration. */
  const definition = readOutput(core, alias) as IRpcFlowDefinition<object>
  /** Private metadata authenticates builtin stage ownership without public feature fields. */
  const metadata = readRpcDefinition(feature)!
  return {
    feature,
    definition,
    installed: await new RpcFlowSetup(definition).prepare(core, rootSignal, context),
    builtin: metadata.kind === RpcDefinitionKind.feature ? metadata.builtin : undefined
  }
}

/** One native record owns its complete closure and preserves original caller aliases. */
class RpcNativeFeatureRecord {
  /** Original caller roots alone define public control names. */
  readonly roots: IFeatureRecord
  /** Original identities map to aliases usable by this registration's actual core. */
  readonly #aliases = new Map<object, string>()
  /** Dependency roots make flow helper outputs readable without evaluating factories twice. */
  readonly features: IFeatureRecord
  /** Dependency-first construction order remains native-owned. */
  readonly ordered: readonly object[]

  /** Snapshot cold native definitions without creating outputs or transport resources. */
  constructor(features: IFeatureRecord) {
    /** Native inspection rejects structural impostors and captures the dependency closure. */
    const inspection = inspectRpcFeatures(features)
    this.roots = inspection.roots
    this.ordered = inspection.ordered
    /** Caller aliases remain intact; only dependency-only identities receive private aliases. */
    const roots: Record<string, IFeatureRecord[string]> = Object.assign(
      Object.create(null),
      this.roots
    )
    for (const [alias, feature] of Object.entries(this.roots))
      if (!this.#aliases.has(feature)) this.#aliases.set(feature, alias)
    /** Cursor allocation skips caller-chosen names in total linear work. */
    let index = 0
    for (const feature of inspection.ordered) {
      if (this.#aliases.has(feature)) continue
      /** This generated alias belongs only to native installation, not public addressing. */
      let alias = `${dependencyAliasPrefix}${index++}`
      while (Object.hasOwn(roots, alias)) alias = `${dependencyAliasPrefix}${index++}`
      roots[alias] = feature
      this.#aliases.set(feature, alias)
    }
    this.features = Object.freeze(roots)
  }

  /** Exact identity lookup runs during installation, never for a call or message. */
  alias(feature: object): string {
    return this.#aliases.get(feature)!
  }

  /** Publish caller-named outputs only, excluding generated dependency aliases. */
  controls(core: IPluginHostCore): Readonly<Record<string, object>> {
    /** Null-prototype storage accepts arbitrary caller names, including **proto**. */
    const controls: Record<string, object> = Object.create(null)
    for (const alias of Object.keys(this.roots)) controls[alias] = readOutput(core, alias)
    return Object.freeze(controls)
  }
}

/** A transport lends its actual native outputs to the one RPC flow registry. */
export class RpcTransportFlowProgram {
  /** Every supplied feature enters the genuine native plugin record. */
  readonly features: IFeatureRecord
  /** Original roots retain caller names without private dependency aliases. */
  readonly roots: IFeatureRecord
  /** Local roles override shared placement without replacing opaque definitions. */
  readonly #selection: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>
  /** Native closure membership identifies dependency-only local placements. */
  readonly #local: ReadonlySet<object>
  /** One native record owns output aliases for this transport registration. */
  readonly #record: RpcNativeFeatureRecord

  /** Capture authentic roots before native acquisition or call admission. */
  constructor(features: IFeatureRecord = {}) {
    this.#record = new RpcNativeFeatureRecord(features)
    this.features = this.#record.features
    this.roots = this.#record.roots
    this.#selection = selectFlows(this.roots)
    this.#local = new Set(this.#record.ordered)
  }

  /** Original controls are projected only while publishing the transport surface. */
  controls(core: IPluginHostCore): Readonly<Record<string, object>> {
    return this.#record.controls(core)
  }

  /** Combine native dependency setup, shared reuse and transport-local role overrides. */
  async prepare(
    core: IPluginHostCore,
    rootSignal: IAbortSignal,
    context: IRpcFlowSetupContext,
    shared: IRpcSharedFlows
  ): Promise<readonly IRpcFlowEntry[]> {
    /** A local role suppresses its shared placement for this namespace only. */
    const selected = new Map<PropertyKey, IRpcFlowFeature<object>>()
    for (const [key, feature] of shared.selection)
      if (!this.#selection.has(key)) selected.set(key, feature)
    for (const [key, feature] of this.#selection) selected.set(key, feature)
    /** Native order controls setup; fixed positions and explicit phases control execution. */
    const entries: IRpcFlowEntry[] = []
    for (const feature of inspectSelection(selected).ordered) {
      /** Helper outputs contribute no RPC stage. */
      const metadata = readRpcFeature(feature)
      if (metadata?.category !== 'flow') continue
      /** Explicit local role selection suppresses an older dependency's same-role stage. */
      const root = selected.get(metadata.role)
      if (root && root !== feature) continue
      /** Explicit shared roots remain owned by their original native carrier. */
      const local = root ? this.#selection.get(metadata.role) === feature : this.#local.has(feature)
      entries.push(
        local
          ? await prepareEntry(core, this.#record.alias(feature), feature, rootSignal, context)
          : shared.entries.get(feature)!
      )
    }
    return Object.freeze(entries)
  }
}

/** Explicit carriers own shared setup through an ordinary native plugin record. */
class RpcFeatureProgram {
  /** Caller roots provide call defaults and public control addressing. */
  readonly #features: IFeatureRecord
  /** Native closure compilation owns aliases and dependency-first setup order. */
  readonly #record: RpcNativeFeatureRecord
  /** Each shared role selects one authentic flow instance. */
  readonly #selection: ReadonlyMap<PropertyKey, IRpcFlowFeature<object>>

  /** Capture a carrier's cold features without installation-local state. */
  constructor(features: IFeatureRecord) {
    this.#record = new RpcNativeFeatureRecord(features)
    this.#features = this.#record.roots
    this.#selection = selectFlows(this.#features)
  }

  /** Create one caller-visible native carrier; the host inserts no wrapper. */
  plugin(name: string): IRpcFlowPlugin {
    /** Private metadata borrows cold preparation; native installation owns outputs. */
    const metadata = {
      kind: RpcDefinitionKind.features,
      features: this.#features,
      prepare: this.#prepare
    }
    /** The native record assembles policies, flows and helper outputs exactly once. */
    const plugin = definePlugin({
      name,
      features: this.#record.features,
      install: (core) => installRpcDefinition(core as unknown as IPluginHostCore, metadata)
    })
    registerRpcDefinition(plugin, metadata)
    return plugin as unknown as IRpcFlowPlugin
  }

  /** Setup remains under native rollback and exact registration-local output identity. */
  readonly #prepare = async (
    core: IPluginHostCore,
    rootSignal: IAbortSignal,
    context: IRpcFlowSetupContext
  ): Promise<IRpcSharedFlows> => {
    /** Shared dependencies are prepared once, independently from namespace count. */
    const entries = new Map<object, IRpcFlowEntry>()
    for (const feature of this.#record.ordered) {
      if (readRpcFeature(feature)?.category !== 'flow') continue
      entries.set(
        feature,
        await prepareEntry(core, this.#record.alias(feature), feature, rootSignal, context)
      )
    }
    return Object.freeze({
      selection: this.#selection,
      entries,
      controls: this.#record.controls(core)
    })
  }
}

/** Cold host classification accepts native plugins only; features need an explicit carrier. */
export class RpcFlowProgram {
  /** Shared carriers, observers and policies install before transports. */
  readonly flows: readonly IRpcFlowPlugin[]
  /** Transports retain their own native feature record and acquisition lifetime. */
  readonly transports: readonly IRpcTransportPlugin[]

  /** Reject Feature-as-plugin syntax before the host acquires resources. */
  constructor(plugins: readonly IRpcHostPlugin[]) {
    /** Genuine shared plugins install in the existing native plugin transaction. */
    const flows: IRpcFlowPlugin[] = []
    /** Namespace startup follows native publication order after shared setup. */
    const transports: IRpcTransportPlugin[] = []
    for (const plugin of plugins) {
      /** The single SDK metadata owner authenticates exact definitions. */
      const metadata = readRpcDefinition(plugin)
      if (metadata?.kind === RpcDefinitionKind.transport)
        transports.push(plugin as IRpcTransportPlugin)
      else if (
        metadata?.kind === RpcDefinitionKind.flow ||
        metadata?.kind === RpcDefinitionKind.policy ||
        metadata?.kind === RpcDefinitionKind.features
      )
        flows.push(plugin as IRpcFlowPlugin)
      else invalidFeature()
    }
    this.flows = Object.freeze(flows)
    this.transports = Object.freeze(transports)
  }
}

/** Assemble shared features explicitly, preserving original record names for installed controls. */
export function rpcFeaturesPlugin<const F extends IFeatureRecord>(
  options: Readonly<{ name?: string; features: F }>
): IRpcFlowPlugin<IRpcTransportFeatureExtensions<F>> {
  return new RpcFeatureProgram(options.features).plugin(
    options.name ?? flowPluginName
  ) as IRpcFlowPlugin<IRpcTransportFeatureExtensions<F>>
}
