/** Cold native Feature definitions share one SDK adapter; no feature runs while being defined. */
import { defineFeature } from '@migaia/plugin-host'
import type { IRpcFlowDefinition, IRpcFlowFeature } from './types.js'
import { registerRpcDefinition, RpcDefinitionKind } from './metadata.js'

/** Private capability identities prevent a third-party display name from impersonating a builtin. */
export const RpcBuiltinFeature = {
  auth: Symbol('rpc.auth'),
  chunk: Symbol('rpc.chunk'),
  batch: Symbol('rpc.batch'),
  idempotency: Symbol('rpc.idempotency'),
  limits: Symbol('rpc.limits'),
  schema: Symbol('rpc.schema')
} as const

/** Package factories alone select these identifiers; stage positions remain in FlowRegistry. */
export type IRpcBuiltinFeature = keyof typeof RpcBuiltinFeature

/** Snapshot a reusable definition without constructing its timers, stores or flow state. */
function flowFeature<E extends object, N extends string>(
  definition: IRpcFlowDefinition<E> & Readonly<{ namespaces?: readonly N[] }>,
  builtin?: IRpcBuiltinFeature
): IRpcFlowFeature<E, N> {
  /** The native constructor snapshots direct dependencies; the remaining configuration is immutable. */
  const captured = Object.freeze({
    ...definition,
    namespaces:
      definition.namespaces === undefined ? undefined : Object.freeze([...definition.namespaces])
  })
  /** One registration later constructs this same cold output through the real native Feature graph. */
  const feature = defineFeature({
    dependencies: captured.dependencies,
    install: () => captured
  })
  registerRpcDefinition(feature, { kind: RpcDefinitionKind.feature, definition: captured, builtin })
  return feature as IRpcFlowFeature<E, N>
}

/** Third-party information flow uses the same opaque Feature and the default plaintext position. */
export function defineFlowFeature<
  E extends object = Record<never, never>,
  const N extends string = string
>(
  definition: IRpcFlowDefinition<E> & Readonly<{ namespaces?: readonly N[] }>
): IRpcFlowFeature<E, N> {
  return flowFeature(definition)
}

/** Internal factories supply only capability identity; this is not part of the public SDK entry. */
export function defineBuiltinFlowFeature<
  E extends object = Record<never, never>,
  const N extends string = string
>(
  builtin: IRpcBuiltinFeature,
  definition: IRpcFlowDefinition<E> & Readonly<{ namespaces?: readonly N[] }>
): IRpcFlowFeature<E, N> {
  return flowFeature(definition, builtin)
}
