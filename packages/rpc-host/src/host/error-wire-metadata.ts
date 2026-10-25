/** Host-owned exact-reference wire presentation; contract receives metadata explicitly. */
import {
  serializeRpcError as serializeProtocolError,
  deserializeRpcError as deserializeProtocolError,
  type IRpcErrorWireSummary,
  type IRpcSerializedError,
  type IRpcSerializeErrorOptions,
  type IRpcWireErrorOptions
} from '@migaia/rpc-contract/errors'
import { RuntimeApiErrorText, identifyRpcBoundaryFailure } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { createRpcSerializationError, localRpcErrorCode } from './error-owner.js'

/** Core and Remote retain presentation only for Error references they actually construct. */
const summaries = new WeakMap<Error, IRpcErrorWireSummary>()
/** Admitted node routes remain attached to the actual local or restored Error reference. */
const routes = new WeakMap<Error, readonly string[]>()
/** The protocol operation receives actual owned data maps, never a registration callback or claim. */
export const hostErrorWireMetadata = Object.freeze({ summaries, routes })

/** Retain admitted route data without reading the held Error's properties. */
export function registerLocalErrorWireRoute(error: Error, route: readonly string[]): void {
  routes.set(error, route)
}

/** Read only the local owner's route without invoking business error getters. */
export function localErrorWireRoute(error: unknown): readonly string[] | undefined {
  return (typeof error === 'object' && error !== null) || typeof error === 'function'
    ? routes.get(error as Error)
    : undefined
}

/** Keep the original cause while selecting the same bounded wire presentation for this node. */
export function registerLocalErrorWireSummary(
  error: Error,
  code: string,
  message: string,
  options?: Readonly<{ preserveSerializedError?: true }>
): void {
  summaries.set(
    error,
    Object.freeze({
      code,
      message,
      ...(options?.preserveSerializedError === true
        ? { preserveSerializedError: true as const }
        : {})
    })
  )
}

/** Unrelated user values receive no presentation state or property reads. */
export function localErrorWireSummary(error: unknown): IRpcErrorWireSummary | undefined {
  return (typeof error === 'object' && error !== null) || typeof error === 'function'
    ? summaries.get(error as Error)
    : undefined
}

/** Serialize held Core/Remote errors using their private redaction and forwarding-route policy. */
export function serializeRpcError(
  value: unknown,
  options: IRpcSerializeErrorOptions
): IRpcSerializedError {
  return serializeProtocolError(value, options, hostErrorWireMetadata)
}

/** Restore a wire error and retain its route for subsequent Core forwarding and re-serialization. */
export function deserializeRpcError(value: unknown, options?: IRpcWireErrorOptions): Error {
  return deserializeProtocolError(value, options, hostErrorWireMetadata)
}

import {
  serializeRpcWireError,
  deserializeRpcWireError,
  RpcWireField,
  type IRpcWireError
} from '@migaia/rpc-contract/protocol'

/** Flat projection borrows the existing private presentation owner and original reporting policy. */
export function serializeHostWireError(
  value: unknown,
  options: IRpcSerializeErrorOptions
): IRpcWireError {
  return serializeRpcWireError(
    value,
    {
      ...options,
      /** Report the Host payload domain while retaining the pure Contract failure on cause. */
      report: (failure) =>
        options.report({
          ...failure,
          error:
            localRpcErrorCode(value) === RpcCoreErrorCode.schemaInvalid &&
            failure.pointer === '' &&
            (failure.field === RpcWireField.message || failure.field === RpcWireField.stack)
              ? identifyRpcBoundaryFailure(
                  failure.error,
                  RpcCoreErrorCode.schemaInvalid,
                  RuntimeApiErrorText.errorDataInvalid
                )
              : createRpcSerializationError(RuntimeApiErrorText.errorDataInvalid, failure.error)
        })
    },
    hostErrorWireMetadata
  )
}

/** Restore flat native errors and retain admitted routes by exact restored identity. */
export function deserializeHostWireError(value: unknown): Error {
  return deserializeRpcWireError(value, hostErrorWireMetadata)
}
