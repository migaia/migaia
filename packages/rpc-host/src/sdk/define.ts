/** Build genuine native definitions; their install hooks join the receiving host's single RPC owner. */
import { definePlugin, type IPluginHostCore } from '@migaia/plugin-host'
import type { IRpcTransportDefinition } from '@migaia/rpc-contract/interfaces'
import { registerRpcDefinition, type IRpcDefinitionMetadata } from './metadata.js'
import { RpcFlowSetup } from './flow-setup.js'
import type {
  IRpcFlowDefinition,
  IRpcFlowPlugin,
  IRpcLinkPolicyDefinition,
  IRpcTransportPlugin,
  IRpcTransportSetupContext
} from './types.js'
import { installRpcDefinition } from '../host/installation.js'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { HostErrorText } from '../host/error-text.js'

/** One cold definition owns its install callback; installation state belongs to the receiving host. */
class RpcDefinition {
  /** This immutable record retains configuration and setup factories, never a running host. */
  readonly #metadata: IRpcDefinitionMetadata

  /** Native definition admission captures the exact install callback on this explicit owner. */
  constructor(metadata: IRpcDefinitionMetadata) {
    this.#metadata = metadata
  }

  /** Native installation owns failure and reverse rollback through the genuine receiving core. */
  readonly install = (core: IPluginHostCore): Promise<Record<never, never>> =>
    installRpcDefinition(core, this.#metadata)
}

/** Define one cold transport with its actual codec/carrier acquisition and plugin-owned features. */
export function defineTransportPlugin<
  const N extends string,
  F,
  E extends object = Record<never, never>,
  A extends boolean = false
>(
  definition: IRpcTransportDefinition<F, E, IRpcTransportSetupContext> &
    Readonly<{ namespace: N; closingWrites?: A }>
): IRpcTransportPlugin<N, E, A> {
  /** Capture the caller's array once; installed feature instances retain their original identity. */
  const captured = Object.freeze({
    ...definition,
    expose: definition.expose === undefined ? undefined : Object.freeze([...definition.expose]),
    features:
      definition.features === undefined ? undefined : Object.freeze([...definition.features])
  })
  /** The native object alone receives metadata; a declaration-only marker adds no runtime property. */
  const metadata: IRpcDefinitionMetadata = { kind: 'transport', definition: captured }
  /** Native admission determines definition identity and public metadata semantics. */
  const plugin = definePlugin({ name: captured.name, install: new RpcDefinition(metadata).install })
  registerRpcDefinition(plugin, metadata)
  return plugin as unknown as IRpcTransportPlugin<N, E, A>
}

/** Each native flow install invokes setup anew, preventing cross-host sharing of optional state. */
export function defineFlowPlugin<
  E extends object = Record<never, never>,
  const N extends string = string,
  M extends object = Record<never, never>
>(
  definition: IRpcFlowDefinition<E> & Readonly<{ namespaces?: readonly N[] }>,
  metadata?: M
): IRpcFlowPlugin<E, N> & Readonly<M> {
  /** Namespace membership is configuration; hooks are produced later by the per-host setup. */
  const captured = Object.freeze({
    ...definition,
    namespaces:
      definition.namespaces === undefined ? undefined : Object.freeze([...definition.namespaces])
  })
  /** Only the actual admitted definition object is recognized by createRpcHost. */
  const registration: IRpcDefinitionMetadata = {
    kind: 'flow',
    definition: captured,
    prepare: new RpcFlowSetup(captured).prepare
  }
  /** Caller-owned collector metadata cannot replace the actual native registration authority. */
  if (metadata && (Object.hasOwn(metadata, 'name') || Object.hasOwn(metadata, 'install')))
    throw tagRpcError(new TypeError(HostErrorText.pluginInvalid), RpcCoreErrorCode.invalidConfig)
  /** Preserve descriptors so native own-data admission rejects accessors without executing them. */
  const native = Object.defineProperties(
    { name: captured.name, install: new RpcDefinition(registration).install },
    Object.getOwnPropertyDescriptors(metadata ?? {})
  )
  /** The shared native transaction calls this install in its real dependency order. */
  const plugin = definePlugin(native)
  registerRpcDefinition(plugin, registration)
  return plugin as unknown as IRpcFlowPlugin<E, N> & Readonly<M>
}

/** Link policy composes complete feature behavior without introducing another intervention stage. */
export function defineLinkPolicy(definition: IRpcLinkPolicyDefinition): IRpcFlowPlugin {
  /** One captured list is read by FeatureScope during native installation. */
  const captured = Object.freeze({
    ...definition,
    features: Object.freeze([...definition.features])
  })
  /** Policy metadata is cold; no timers, retries or host scopes are created by the factory. */
  const metadata: IRpcDefinitionMetadata = { kind: 'policy', definition: captured }
  /** The actual native install supplies the policy to the receiving runtime. */
  const plugin = definePlugin({ name: captured.name, install: new RpcDefinition(metadata).install })
  registerRpcDefinition(plugin, metadata)
  return plugin as unknown as IRpcFlowPlugin
}
