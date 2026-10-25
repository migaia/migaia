import type {
  IRpcProviderMethodDeclaration,
  IRpcProviderFeatureDeclaration,
  IRpcProviderDeclaration,
  IRpcShapeCheck,
  IRpcMethodSchema,
  RpcProviderMode,
  RpcShapeReason,
  IRpcMethodDescription,
  IRpcDirectory,
  RuntimeApiMode,
  RuntimeApiModeSource
} from '@migaia/rpc-contract/protocol'

/** Every retained declaration and directory shape is reachable through the sole protocol entry. */
export type IRemoteShapeTypeConsumer = [
  IRpcProviderMethodDeclaration,
  IRpcProviderFeatureDeclaration,
  IRpcProviderDeclaration,
  IRpcShapeCheck<IRpcProviderDeclaration>,
  IRpcMethodSchema,
  RpcProviderMode,
  RpcShapeReason,
  IRpcMethodDescription,
  IRpcDirectory,
  RuntimeApiMode,
  RuntimeApiModeSource
]

/** Provider declarations accept the same recursive schema fields as received directories. */
export const schemaMethod: IRpcProviderMethodDeclaration = {
  mode: 'request',
  idempotent: false,
  input: { $defs: { size: { type: 'number' } }, $ref: '#/$defs/size' },
  output: { type: ['string', 'null'] },
  yield: { items: { enum: [1, 2] } }
}

/** Unregistered keywords remain a type error at a directly authored declaration. */
export const unsupportedSchema: IRpcMethodSchema = {
  // @ts-expect-error This keyword is outside the registered data-only subset.
  additionalProperties: false
}

/** New schemas do not remove the original mandatory idempotency declaration. */
// @ts-expect-error An advanced method still declares its replay behavior.
export const incompleteMethod: IRpcProviderMethodDeclaration = { mode: 'request', input: {} }

/** Diagnostic data narrows without unsafe casts or a runtime error dependency. */
export function reason(
  result: IRpcShapeCheck<IRpcProviderDeclaration>
): RpcShapeReason | undefined {
  return result.ok ? undefined : result.reason
}
