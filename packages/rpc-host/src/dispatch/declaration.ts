/** Map pure local provider declarations through the original native remote-error boundary. */
import {
  checkRpcProviderDeclaration,
  RpcProviderDeclarationLimit,
  RpcShapeReason,
  type IRpcProviderDeclaration,
  type IRpcShapeCheck
} from '@migaia/rpc-contract/protocol'
import { RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { createRemoteLayerError } from '../host/remote-error-owner.ts'
import { hostErrorWireMetadata } from '../host/error-wire-metadata.ts'

/**
 * Original locally constructed contract errors retain identity when another input getter throws
 * them.
 */
const contractErrors = new WeakSet<Error>()

/** Each former count failure maps to its existing bounded detail field and maximum. */
const reasonLimits: Partial<Record<RpcShapeReason, keyof typeof RpcProviderDeclarationLimit>> = {
  [RpcShapeReason['plugins-limit']]: 'pluginsPerCatalog',
  [RpcShapeReason['features-limit']]: 'featuresPerContract',
  [RpcShapeReason['methods-limit']]: 'methodsPerFeature',
  [RpcShapeReason['catalog-methods-limit']]: 'methodsPerCatalog'
}

/** All shape reasons retain the original native TypeError, code, text and cause owner. */
export function acceptRpcProviderDeclaration<T>(result: IRpcShapeCheck<T>): T {
  if (result.ok) return result.value
  if (result.cause instanceof Error && contractErrors.has(result.cause)) throw result.cause
  /** Only limit diagnostics add the original limit/max pair; every other reason uses path/cause. */
  const limit = reasonLimits[result.reason]
  /** The checker supplies the first bounded path and captured cause without rereading user input. */
  const error = createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid, result.cause, {
    path: result.path,
    ...(limit === undefined ? {} : { limit, max: RpcProviderDeclarationLimit[limit] })
  })
  contractErrors.add(error)
  throw error
}

/** Normalize inert local schema metadata without running schema or application validation. */
export function normalizeRpcProviderDeclaration(input: unknown): IRpcProviderDeclaration {
  return acceptRpcProviderDeclaration(checkRpcProviderDeclaration(input, hostErrorWireMetadata))
}
