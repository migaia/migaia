/** Host-owned exact-reference wire presentation; contract receives metadata explicitly. */
import {
  serializeRpcError as serializeProtocolError,
  deserializeRpcError as deserializeProtocolError,
  type IRpcErrorWireSummary,
  type IRpcErrorWireMetadata,
  type IRpcSerializedError,
  type IRpcSerializeErrorOptions,
  type IRpcWireErrorOptions
} from '@migaia/rpc-contract/errors'
import {
  RpcCoreErrorText,
  RuntimeApiErrorText,
  identifyRpcBoundaryFailure
} from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { createRpcSerializationError, localRpcErrorCode } from './error-owner.js'

/** Core and Remote retain presentation only for Error references they actually construct. */
const summaries = new WeakMap<Error, IRpcErrorWireSummary>()
/** Admitted node routes remain attached to the actual local or restored Error reference. */
const routes = new WeakMap<Error, readonly string[]>()
/** The protocol operation receives actual owned data maps, never a registration callback or claim. */
export const hostErrorWireMetadata = Object.freeze({ summaries, routes })
/** Ordinary wire failures preserve every original cause while retaining admitted forwarding routes. */
const hostErrorWireRoutes = Object.freeze({ routes })
/** A live outbound graph retains its exact local failure without modifying the immutable wire data. */
const originals = new WeakMap<IRpcWireError, unknown>()

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

/** Downstream diagnostics take precedence; a missing route borrows this admitted hop once. */
export function admitLocalErrorWireRoute(error: Error, route: readonly string[]): void {
  if (localErrorWireRoute(error) !== undefined) return
  /** Error diagnostics outlive the original frame without retaining its mutable route array. */
  const snapshot = Object.freeze([...route])
  Object.defineProperty(error, RpcWireField.route, { value: snapshot, enumerable: true })
  registerLocalErrorWireRoute(error, snapshot)
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

/** One flat projection owns the original reporting policy regardless of its presentation metadata. */
function serializeHostError(
  value: unknown,
  options: IRpcSerializeErrorOptions,
  metadata: IRpcErrorWireMetadata
): IRpcWireError {
  /** The same graph is passed through actual codec preparation, preserving this local association. */
  const graph = serializeRpcWireError(
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
    metadata
  )
  originals.set(graph, value)
  return graph
}

/** Ordinary and explicitly mapped failures retain complete causes, never private wire summaries. */
export function serializeHostWireError(
  value: unknown,
  options: IRpcSerializeErrorOptions
): IRpcWireError {
  return serializeHostError(value, options, hostErrorWireRoutes)
}

/** Only a trusted local authentication root receives the default preauthentication summary. */
export function serializeHostHandshakeError(
  value: unknown,
  options: IRpcSerializeErrorOptions
): IRpcWireError {
  if (localRpcErrorCode(value) !== RpcCoreErrorCode.authenticationFailed)
    return serializeHostError(value, options, hostErrorWireMetadata)
  /** This operation hides descendants without changing the original Error or global summaries. */
  const authenticationSummary = new WeakMap<Error, IRpcErrorWireSummary>()
  authenticationSummary.set(
    value as Error,
    Object.freeze({
      code: RpcCoreErrorCode.authenticationFailed,
      message: RpcCoreErrorText.authenticationFailed
    })
  )
  return serializeHostError(value, options, { summaries: authenticationSummary, routes })
}

/** Persisted/restored graphs have no local identity association and use the canonical deserializer. */
export function originalHostWireError(value: IRpcWireError): unknown {
  return originals.has(value) ? originals.get(value) : deserializeHostWireError(value)
}

/** Restore once; downstream error routes take precedence over the admitted reply's hop header. */
export function deserializeHostWireError(value: unknown, admittedRoute?: readonly string[]): Error {
  /** Native identity and the entire restored graph remain owned by the canonical deserializer. */
  const error = deserializeRpcWireError(value, hostErrorWireMetadata)
  /** A restored route already has its canonical descriptor and may exceed the upstream header. */
  if (admittedRoute !== undefined) admitLocalErrorWireRoute(error, admittedRoute)
  return error
}
