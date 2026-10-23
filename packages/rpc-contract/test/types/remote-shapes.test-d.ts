import type {
  IRemoteMethodContract,
  IRemoteFeatureContract,
  IRemoteContract,
  IRemoteHostCatalog,
  IRemoteControlDefinition,
  IRpcShapeCheck,
  IRpcMethodSchema,
  RemoteMethodMode,
  RpcShapeReason
} from '@migaia/rpc-contract/remote'
import type {
  IRuntimePeerIdentity,
  IRuntimeMethodDescription,
  IRuntimePeerDescription,
  IRuntimeDirectoryDiff,
  RuntimeApiMode,
  RuntimeApiModeSource,
  RuntimeSourceKind,
  RuntimeConnectionDirection,
  RuntimeEventName
} from '@migaia/rpc-contract/runtime'

/** Every declared public shape must remain reachable through the owning package subpath. */
export type IRemoteShapeTypeConsumer = [
  IRemoteMethodContract,
  IRemoteFeatureContract,
  IRemoteContract,
  IRemoteHostCatalog,
  IRemoteControlDefinition,
  IRpcShapeCheck<IRemoteContract>,
  IRpcMethodSchema,
  RemoteMethodMode,
  RpcShapeReason,
  IRuntimePeerIdentity,
  IRuntimeMethodDescription,
  IRuntimePeerDescription,
  IRuntimeDirectoryDiff,
  RuntimeApiMode,
  RuntimeApiModeSource,
  RuntimeSourceKind,
  RuntimeConnectionDirection,
  RuntimeEventName
]

/** Provider declarations accept the same recursive schema fields as received directories. */
export const schemaMethod: IRemoteMethodContract = {
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
export const incompleteMethod: IRemoteMethodContract = { mode: 'request', input: {} }

/** Diagnostic data narrows without unsafe casts or a runtime error dependency. */
export function reason(result: IRpcShapeCheck<IRemoteContract>): RpcShapeReason | undefined {
  return result.ok ? undefined : result.reason
}
