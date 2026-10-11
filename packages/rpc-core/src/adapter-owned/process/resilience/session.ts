import { ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE } from '../error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { createRpcIdempotencyStore, type IRpcIdempotencyStore } from '../../../core/index.js'
import type { IRpcIdempotencyConfig, IRpcProviderLimits } from '../../../core/index.js'
import { defaultRpcId } from '../../../core/internal/id.js'
import { RpcProcessErrorCode } from '../error-code.js'

import { RpcProcessErrorText } from '../error-text.js'
import {
  DEFAULT_MAX_CALLS_PER_MINUTE,
  DEFAULT_MAX_CONCURRENT_CALLS,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_MAX_CONSECUTIVE_TIMEOUTS,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_DRAIN_MS,
  DEFAULT_REPORT_AT_MS,
  DEFAULT_UNHANDLED_LIMIT
} from './constants.js'
import type { IProcessResilienceOptions, IProcessSessionIdentity } from './types.js'
import { retainRuntimeIdempotencyScope } from '../../../core/internal/provider.js'
import {
  createProviderAdmissionScope,
  type IProviderAdmissionScope
} from '../../../core/features/provider.js'

/** One admitted physical connection is released exactly once after transfer or rollback. */
export type IProcessConnectionLease = Readonly<{ release(): void }>

/** The session manager owns only quotas, the shared store, and per-principal scope derivation. */
export type IProcessSessionManager = Readonly<{
  readonly options: IRequiredProcessResilienceOptions
  /** New runtime sessions share the final provider's existing admission class, not per-socket FIFOs. */
  readonly runtimeAdmission: IProviderAdmissionScope
  claimConnection(): IProcessConnectionLease
  sessionOptions(identity: IProcessSessionIdentity): Readonly<{
    idempotency: IRpcIdempotencyConfig
    limits: IRpcProviderLimits
  }>
  close(): void
}>

/** Validated option values have no remaining undefined capacity or policy fields. */
export type IRequiredProcessResilienceOptions = IProcessResilienceOptions &
  Readonly<{
    maxConnections: number
    maxConcurrentCallsPerConnection: number
    maxCallsPerMinute: number
    maxPayloadBytes: number
    maxConsecutiveTimeouts: number
    idleTimeoutMs: number
    drainMs: number
    reportAtMs: readonly number[]
    unhandledLimit: number
    liquidation: Readonly<{ cascade: boolean }>
  }>

/** Rejects a malformed capacity at construction, before listener or launcher side effects. */
function positive(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0)
    throw attachErrorIdentity(new RangeError(RpcProcessErrorText.resilienceInvalidOption), {
      source: RPC_PROCESS_ERROR_SOURCE,
      code: RpcProcessErrorCode.resilienceInvalidOption,
      detail: { field: field }
    })
  return value
}

/** A report schedule has a zero origin and positive, strictly increasing later offsets. */
function reportOffsets(value: readonly number[] | undefined): readonly number[] {
  if (value === undefined) return DEFAULT_REPORT_AT_MS
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value[0] !== 0 ||
    value.some(
      (offset, index) =>
        !Number.isSafeInteger(offset) || offset < 0 || (index > 0 && offset <= value[index - 1]!)
    )
  )
    throw attachErrorIdentity(new RangeError(RpcProcessErrorText.resilienceInvalidOption), {
      source: RPC_PROCESS_ERROR_SOURCE,
      code: RpcProcessErrorCode.resilienceInvalidOption,
      detail: { field: RpcProcessErrorText.resilienceReportOffsetsField }
    })
  return Object.freeze([...value])
}

/** Normalize finite options once so all later admission paths share the same policy. */
export function normalizeProcessResilienceOptions(
  input: IProcessResilienceOptions
): IRequiredProcessResilienceOptions {
  if (!input || typeof input.scheduler?.now !== 'function' || typeof input.report !== 'function')
    throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
      attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
        source: RPC_PROCESS_ERROR_SOURCE,
        code: RpcProcessErrorCode.resilienceInvalidOption,
        ...(originalDetail ? { detail: originalDetail } : {})
      }))({
      field: 'scheduler/report'
    })
  if (input.liquidation?.cascade !== undefined && typeof input.liquidation.cascade !== 'boolean')
    throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
      attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
        source: RPC_PROCESS_ERROR_SOURCE,
        code: RpcProcessErrorCode.resilienceInvalidOption,
        ...(originalDetail ? { detail: originalDetail } : {})
      }))({
      field: 'liquidation.cascade'
    })
  return Object.freeze({
    ...input,
    maxConnections: positive(input.maxConnections, DEFAULT_MAX_CONNECTIONS, 'maxConnections'),
    maxConcurrentCallsPerConnection: positive(
      input.maxConcurrentCallsPerConnection,
      DEFAULT_MAX_CONCURRENT_CALLS,
      'maxConcurrentCallsPerConnection'
    ),
    maxCallsPerMinute: positive(
      input.maxCallsPerMinute,
      DEFAULT_MAX_CALLS_PER_MINUTE,
      'maxCallsPerMinute'
    ),
    maxPayloadBytes: positive(input.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, 'maxPayloadBytes'),
    maxConsecutiveTimeouts: positive(
      input.maxConsecutiveTimeouts,
      DEFAULT_MAX_CONSECUTIVE_TIMEOUTS,
      'maxConsecutiveTimeouts'
    ),
    idleTimeoutMs: positive(input.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 'idleTimeoutMs'),
    drainMs: positive(input.drainMs, DEFAULT_DRAIN_MS, 'drainMs'),
    reportAtMs: reportOffsets(input.reportAtMs),
    unhandledLimit: positive(input.unhandledLimit, DEFAULT_UNHANDLED_LIMIT, 'unhandledLimit'),
    liquidation: Object.freeze({ cascade: input.liquidation?.cascade === true })
  })
}

/** A registration's random prefix prevents reuse of a principal scope by another owner. */
export function createProcessSessionManager(
  input: IProcessResilienceOptions
): IProcessSessionManager {
  const options = normalizeProcessResilienceOptions(input)
  const store: IRpcIdempotencyStore = input.idempotencyStore ?? createRpcIdempotencyStore()
  const scopePrefix = defaultRpcId()
  /** The same service manager owns cold cross-session preparation alongside its existing store. */
  const runtimeAdmission = createProviderAdmissionScope()
  let active = 0
  let closed = false
  return Object.freeze({
    options,
    runtimeAdmission,
    claimConnection(): IProcessConnectionLease {
      if (closed)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      if (active >= options.maxConnections)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.connectionLimit), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.connectionLimit
        })
      active += 1
      let released = false
      return Object.freeze({
        release(): void {
          if (released) return
          released = true
          active -= 1
        }
      })
    },
    sessionOptions(identity: IProcessSessionIdentity) {
      if (typeof identity.principalId !== 'string' || identity.principalId.length === 0)
        throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
          attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
            source: RPC_PROCESS_ERROR_SOURCE,
            code: RpcProcessErrorCode.resilienceInvalidOption,
            ...(originalDetail ? { detail: originalDetail } : {})
          }))({
          field: 'identity.principalId'
        })
      return Object.freeze({
        idempotency: Object.freeze({
          store,
          scope: retainRuntimeIdempotencyScope(
            () => `${scopePrefix}:${identity.principalId}`,
            identity.principalId
          )
        }),
        limits: Object.freeze({
          maxGlobal: options.maxConcurrentCallsPerConnection,
          maxPerPeer: options.maxConcurrentCallsPerConnection
        })
      })
    },
    close(): void {
      closed = true
      runtimeAdmission.clear()
    }
  })
}
