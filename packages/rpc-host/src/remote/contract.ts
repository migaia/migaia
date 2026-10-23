import {
  checkRemoteContract,
  checkRemoteHostCatalog,
  checkRemoteControlShape,
  RemoteCatalogLimit,
  RpcShapeReason,
  type IRemoteContract,
  type IRemoteHostCatalog,
  type IRemoteControlDefinition,
  type IRpcShapeCheck
} from '@migaia/rpc-contract/remote'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'

/** Existing callers keep their declarations while the pure contract owner holds their definitions. */
export {
  RemoteCatalogLimit,
  RemoteMethodMode,
  REMOTE_NAME_PATTERN,
  REMOTE_METHOD_MAX_LENGTH,
  REMOTE_SCHEMA_VERSION,
  REMOTE_METHOD_MODES,
  sameRemoteContract,
  type IRemoteMethodContract,
  type IRemoteFeatureContract,
  type IRemoteContract,
  type IRemoteHostCatalog,
  type IRemoteControlDefinition
} from '@migaia/rpc-contract/remote'

/**
 * Original locally constructed contract errors retain identity when another input getter throws
 * them.
 */
const contractErrors = new WeakSet<Error>()

/** Each former count failure maps to its existing bounded detail field and maximum. */
const reasonLimits: Partial<Record<RpcShapeReason, keyof typeof RemoteCatalogLimit>> = {
  [RpcShapeReason['plugins-limit']]: 'pluginsPerCatalog',
  [RpcShapeReason['features-limit']]: 'featuresPerContract',
  [RpcShapeReason['methods-limit']]: 'methodsPerFeature',
  [RpcShapeReason['catalog-methods-limit']]: 'methodsPerCatalog'
}

/** All shape reasons retain the original native TypeError, code, text and cause owner. */
function accepted<T>(result: IRpcShapeCheck<T>): T {
  if (result.ok) return result.value
  if (result.cause instanceof Error && contractErrors.has(result.cause)) throw result.cause
  /** Only limit diagnostics add the original limit/max pair; every other reason uses path/cause. */
  const limit = reasonLimits[result.reason]
  /** The checker supplies the first bounded path and captured cause without rereading user input. */
  const error = createRemoteLayerError(RpcRemoteLayerErrorCode.contractInvalid, result.cause, {
    path: result.path,
    ...(limit === undefined ? {} : { limit, max: RemoteCatalogLimit[limit] })
  })
  contractErrors.add(error)
  throw error
}

/** Normalize before feature publication while keeping the original remote-layer error boundary. */
export function normalizeRemoteContract(input: unknown): IRemoteContract {
  return accepted(checkRemoteContract(input))
}

/** Normalize the bounded catalog through the same pure contract and original error mapping. */
export function normalizeRemoteHostCatalog(input: unknown): IRemoteHostCatalog {
  return accepted(checkRemoteHostCatalog(input))
}

/** Reserved control payloads retain their original remote-layer TypeError and bounded details. */
export function normalizeRemoteControlShape(
  definition: IRemoteControlDefinition,
  input: unknown
): IRpcPortableValue {
  return accepted(checkRemoteControlShape(definition, input))
}
