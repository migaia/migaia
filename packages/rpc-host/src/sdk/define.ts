/** Build genuine native definitions; their install hooks join the receiving host's single RPC owner. */
import {
  definePlugin,
  type IFeatureRecord,
  type IPluginHostCore,
  type IPluginBeforeReleaseContext
} from '@migaia/plugin-host'
import type { IRpcTransportDefinition } from '@migaia/rpc-contract/interfaces'
import {
  registerRpcDefinition,
  RpcDefinitionKind,
  type IRpcDefinitionMetadata
} from './metadata.ts'
import { RpcFlowSetup } from './flow-setup.ts'
import { RpcFeatureProgram, RpcTransportFlowProgram } from './flow-program.ts'
import { RpcFlowPipelines } from './flow-pipelines.ts'
import type {
  IRpcFlowDefinition,
  IRpcFlowPlugin,
  IRpcFlowPluginDefinition,
  IRpcTransportPlugin,
  IRpcTransportFeatureExtensions,
  IRpcTransportSetupContext
} from './types.ts'
import { closeRpcTransport, installRpcDefinition } from '../host/installation.ts'
export { defineFlowFeature } from './flow-feature.ts'

/** One cold definition owns its install callback; installation state belongs to the receiving host. */
export class RpcDefinition {
  /** This immutable record retains configuration and setup factories, never a running host. */
  readonly #metadata: IRpcDefinitionMetadata

  /** Native definition admission captures the exact install callback on this explicit owner. */
  constructor(metadata: IRpcDefinitionMetadata) {
    this.#metadata = metadata
  }

  /** Native installation owns failure and reverse rollback through the genuine receiving core. */
  readonly install = (core: IPluginHostCore): Promise<Record<never, never>> =>
    installRpcDefinition(core, this.#metadata)

  /** Transport Sessions finish their existing grace before native stages are retired. */
  readonly beforeRelease = (context: IPluginBeforeReleaseContext): Promise<void> | undefined =>
    closeRpcTransport(context.signal)
}

/** Define one cold transport with its actual codec/carrier acquisition and plugin-owned features. */
export function defineTransportPlugin<
  const N extends string,
  const F extends IFeatureRecord = Record<never, never>,
  E extends object = Record<never, never>,
  A extends boolean = false
>(
  definition: IRpcTransportDefinition<F, E, IRpcTransportSetupContext> &
    Readonly<{ namespace: N; closingWrites?: A }>
): IRpcTransportPlugin<N, E & IRpcTransportFeatureExtensions<F>, A> {
  /** Capture only the generic local policy; native token and acquisition objects never enter it. */
  const { connect, ...configuration } = definition
  /** Native inspection snapshots original root aliases and rejects arrays before copying input. */
  const program = new RpcTransportFlowProgram(definition.features ?? {})
  /** Capture caller configuration once; installed feature instances retain their original identity. */
  const captured = Object.freeze({
    ...configuration,
    connect: connect === undefined ? undefined : Object.freeze({ retain: connect.retain }),
    expose: definition.expose === undefined ? undefined : Object.freeze([...definition.expose]),
    features: program.roots
  })
  /** The native object alone receives metadata; a declaration-only marker adds no runtime property. */
  const metadata: IRpcDefinitionMetadata = {
    kind: RpcDefinitionKind.transport,
    definition: captured,
    flows: program
  }
  /** Native admission determines definition identity and public metadata semantics. */
  const owner = new RpcDefinition(metadata)
  /** The native name is the namespace and owns its canonical seven pipeline declarations. */
  const plugin = definePlugin({
    name: captured.namespace,
    pipelines: RpcFlowPipelines,
    features: metadata.flows.features,
    install: owner.install,
    beforeRelease: owner.beforeRelease
  })
  registerRpcDefinition(plugin, metadata)
  return plugin as unknown as IRpcTransportPlugin<N, E & IRpcTransportFeatureExtensions<F>, A>
}

/**
 * Define the one host-level flow plugin. `setup` installs a readonly observer anew for each host;
 * `features` carries shared flow placements and timeout/retry call defaults. A plugin with
 * `features` must be installed before the first transport commits; an observer-only plugin may be
 * installed later. An empty `features` record counts as absent. With neither field the plugin
 * installs and does nothing.
 */
export function defineFlowPlugin<
  const F extends IFeatureRecord = Record<never, never>,
  E extends object = Record<never, never>
>(
  definition: IRpcFlowPluginDefinition<F, E>
): IRpcFlowPlugin<E & IRpcTransportFeatureExtensions<F>> {
  /** The record goes to the native plugin; only observer configuration is captured here. */
  const { features, ...observer } = definition
  /** Observer configuration is cold; native installation owns every per-host setup output. */
  const captured = Object.freeze(observer)
  /** Native inspection snapshots the record and compiles dependency-first shared setup. */
  const program = features === undefined ? undefined : new RpcFeatureProgram(features)
  /** Only this native definition identity receives RPC's private kind metadata. */
  const registration: IRpcDefinitionMetadata = {
    kind: RpcDefinitionKind.flow,
    prepare:
      captured.setup === undefined
        ? undefined
        : new RpcFlowSetup(captured as IRpcFlowDefinition<object>).prepare,
    // An empty record carries no Feature, so the plugin stays a plain late-installable observer.
    shared:
      program && Object.keys(program.roots).length > 0
        ? { features: program.roots, prepare: program.prepare }
        : undefined
  }
  /** Thin definitions omit arbitrary metadata fields; callers keep domain owners explicitly. */
  const plugin = definePlugin({
    name: captured.name,
    features: program?.features,
    install: new RpcDefinition(registration).install
  })
  registerRpcDefinition(plugin, registration)
  return plugin as unknown as IRpcFlowPlugin<E & IRpcTransportFeatureExtensions<F>>
}
