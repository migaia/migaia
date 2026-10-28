/** Contract owns wire error policy; the shared Utils walker owns bounded graph traversal. */
import {
  serializeErrorChain,
  deserializeErrorChain,
  normalizeSerializedErrorChain,
  reachErrorChain,
  sanitizeErrorText,
  type IErrorChainStrategy
} from '@migaia/utils/error'
import { createContractError } from './contract-error.ts'
import { RpcContractErrorCode } from '../error-code.ts'
import { RpcWireLimit } from '../wire/limits.ts'
import { normalizePortable } from '../portable/normalize.ts'
import type {
  IRpcSerializedError,
  IRpcSerializeErrorOptions,
  IRpcWireErrorOptions,
  IRpcErrorWireMetadata,
  IRpcErrorWireSummary
} from './types.ts'
import {
  RpcErrorReachLimit,
  RpcWireErrorFallback,
  RpcWireErrorField,
  RpcWireErrorLimit,
  RpcWireErrorViolation
} from './wire-error-constants.ts'

/** Read exact-reference presentation before ordinary error getters, preserving reentrant order. */
function readWireSummary(
  input: unknown,
  metadata?: IRpcErrorWireMetadata
): IRpcErrorWireSummary | undefined {
  if ((typeof input === 'object' && input !== null) || typeof input === 'function')
    return metadata?.summaries?.get(input as Error)
  return undefined
}

/** Read held routes after the fixed getters, preserving updates made during reentrant reads. */
function readWireRoute(
  input: object,
  metadata?: IRpcErrorWireMetadata
): readonly string[] | undefined {
  return metadata?.routes?.get(input as Error)
}

/** Error routes retain the same origin/forward-node allowance as actual forwarded calls. */
function invalidErrorRouteNode(id: unknown): boolean {
  return typeof id !== 'string' || !/^[0-9a-f]{32}$/u.test(id)
}

/** Attach the RPC violation identity and pointer without replacing the native TypeError or cause. */
export function createInvalidWireError(
  cause: unknown,
  pointer: string,
  violation: RpcWireErrorViolation,
  metadata?: IRpcErrorWireMetadata
): Error {
  /** Contract-owned failure retains the original input through its cause. */
  const error = createContractError(RpcContractErrorCode.invalidWireError, cause, metadata)
  Object.defineProperty(error, 'pointer', { value: pointer })
  Object.defineProperty(error, 'violation', { value: violation })
  return error
}

/**
 * Keep wire vocabulary, portable values and exact-reference presentation in Contract. The generic
 * owner supplies traversal, budgets, scalar sanitization, validation and native restoration.
 */
function rpcErrorStrategy(
  metadata?: IRpcErrorWireMetadata,
  causeProjector?: (cause: unknown) => unknown
): IErrorChainStrategy {
  return {
    fields: RpcWireErrorField,
    limits: { ...RpcWireErrorLimit, ...RpcErrorReachLimit },
    fallback: RpcWireErrorFallback,
    presentation: (input) => readWireSummary(input, metadata),
    normalizeData: (raw, depth) => normalizePortable(raw, 16 + depth + 1),
    /** RPC's canonical binary record counts only its Base64URL payload, not marker keys. */
    dataTextLeaf: (record) =>
      record.$rpc === 'bytes' && typeof record.base64url === 'string'
        ? { text: record.base64url, key: 'base64url' }
        : undefined,
    createViolation: (cause, pointer, violation) =>
      createInvalidWireError(
        causeProjector ? causeProjector(cause) : cause,
        pointer,
        violation,
        metadata
      ),
    extensions: [
      {
        field: 'route',
        read: (input) => readWireRoute(input, metadata),
        /** Validate the node-only grammar at the original portable normalization boundary. */
        normalize: (raw, pointer) => {
          /** Only admitted node ids may cross the error diagnostic boundary. */
          const route = normalizePortable(raw)
          if (
            !Array.isArray(route) ||
            route.length < 1 ||
            route.length > RpcWireLimit.maxForwardRouteNodes ||
            route.some(invalidErrorRouteNode)
          )
            throw createInvalidWireError(
              causeProjector ? causeProjector(raw) : raw,
              pointer,
              RpcWireErrorViolation.type,
              metadata
            )
          return { value: route, bytes: route.length * 32 }
        },
        /** Registration retains route diagnostics only; it never mints a local control identity. */
        restore: (error, value) => {
          /** The generic validator has admitted this extension through its route grammar. */
          const route = value as readonly string[]
          metadata?.routes?.set(error, route)
        }
      }
    ]
  }
}

/**
 * Project a thrown value into a bounded frozen wire-error tree while retaining native text, stack,
 * semantic identity and reachable cause/aggregate structure where admitted. Unclassified values use
 * UNKNOWN; cycles and over-budget branches are truncated. The required report hook observes failed
 * inspection, while exact-reference metadata can supply safe local presentation only.
 */
export function serializeRpcError(
  value: unknown,
  options: IRpcSerializeErrorOptions,
  metadata?: IRpcErrorWireMetadata
): IRpcSerializedError {
  return serializeErrorChain(value, rpcErrorStrategy(metadata), options) as IRpcSerializedError
}

/**
 * Yield original values reachable through causes, aggregate entries and cleanup failures, with a
 * bounded identity-aware graph walk. The required report hook observes read failures; no error is
 * deserialized, replaced or given remote execution authority by this diagnostic traversal.
 */
export function* reachRpcError(
  value: unknown,
  options: IRpcSerializeErrorOptions,
  metadata?: IRpcErrorWireMetadata
): Generator<unknown> {
  yield* reachErrorChain(value, rpcErrorStrategy(metadata), options)
}

/** Retain the RPC UTF-8 text limit while delegating scalar replacement and prefix selection. */
export function sanitizeText(
  value: string,
  truncate = true
): {
  /** Sanitized text, optionally shortened to the wire UTF-8 limit. */
  value: string
  /** Actual UTF-8 size of the returned text. */
  bytes: number
  /** Whether surrogate replacement or optional truncation changed the input. */
  changed: boolean
} {
  return sanitizeErrorText(value, RpcWireErrorLimit.maxStringBytes, truncate)
}

/**
 * Validate untrusted serialized-error data and return a fresh frozen tree under stable depth, node,
 * string and total-byte budgets. Unknown fields reject by default; ignore mode omits them and
 * optionally reports them. Invalid input throws INVALID_WIRE_ERROR with pointer/violation.
 */
export function normalizeRpcSerializedError(
  value: unknown,
  options: IRpcWireErrorOptions = {},
  metadata?: IRpcErrorWireMetadata,
  causeProjector?: (cause: unknown) => unknown
): IRpcSerializedError {
  return normalizeSerializedErrorChain(
    value,
    rpcErrorStrategy(metadata, causeProjector),
    options
  ) as IRpcSerializedError
}

/**
 * Validate the complete wire tree before restoring native error classes and remote stacks, keeping
 * cause/aggregate structure and semantic source/code. Unknown fields reject unless configured
 * otherwise; invalid input throws INVALID_WIRE_ERROR. Optional route storage records diagnostics
 * only, and restored wire properties do not mint local Contract-error authority.
 */
export function deserializeRpcError(
  value: unknown,
  options?: IRpcWireErrorOptions,
  metadata?: IRpcErrorWireMetadata
): Error {
  return deserializeErrorChain(value, rpcErrorStrategy(metadata), options)
}
