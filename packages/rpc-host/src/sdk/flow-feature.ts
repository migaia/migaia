/** Cold native Feature definitions share one SDK adapter; no feature runs while being defined. */
import { defineFeature } from '@migaia/plugin-host'
import type { IRpcFlowDefinition, IRpcFlowFeature } from './types.ts'
import { registerRpcDefinition, RpcDefinitionKind } from './metadata.ts'

/** Private capability identities prevent a third-party display name from impersonating a builtin. */
export const RpcBuiltinFeature = {
  auth: Symbol('rpc.auth'),
  chunk: Symbol('rpc.chunk'),
  batch: Symbol('rpc.batch'),
  idempotency: Symbol('rpc.idempotency'),
  limits: Symbol('rpc.limits'),
  errorMap: Symbol('rpc.error-map'),
  schema: Symbol('rpc.schema')
} as const

/** Package factories alone select these identifiers; stage positions remain in FlowRegistry. */
export type IRpcBuiltinFeature = keyof typeof RpcBuiltinFeature

/** Snapshot a reusable definition without constructing its timers, stores or flow state. */
function flowFeature<E extends object>(
  definition: IRpcFlowDefinition<E>,
  builtin?: IRpcBuiltinFeature
): IRpcFlowFeature<E> {
  /** The native constructor snapshots direct dependencies; the remaining configuration is immutable. */
  const captured = Object.freeze({ ...definition })
  /** One registration later constructs this same cold output through the real native Feature graph. */
  const feature = defineFeature({
    dependencies: captured.dependencies,
    install: () => captured
  })
  registerRpcDefinition(feature, { kind: RpcDefinitionKind.feature, definition: captured, builtin })
  return feature as IRpcFlowFeature<E>
}

/** Third-party information flow uses the same opaque Feature and the default plaintext position. */
export function defineFlowFeature<E extends object = Record<never, never>>(
  definition: IRpcFlowDefinition<E>
): IRpcFlowFeature<E> {
  return flowFeature(definition)
}

/** Internal factories supply only capability identity; this is not part of the public SDK entry. */
export function defineBuiltinFlowFeature<E extends object = Record<never, never>>(
  builtin: IRpcBuiltinFeature,
  definition: IRpcFlowDefinition<E>
): IRpcFlowFeature<E> {
  return flowFeature(definition, builtin)
}
