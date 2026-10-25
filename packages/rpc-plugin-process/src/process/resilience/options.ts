/**
 * Admits native capacity, drain, diagnostic-offset and liquidation options before resource
 * acquisition. Defaults and validation errors retain their original Process contract.
 */
import { attachErrorIdentity } from '@migaia/utils/error'
import { RPC_PROCESS_ERROR_SOURCE, RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcProcessErrorText } from '../error-text.js'
import {
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_DRAIN_MS,
  DEFAULT_REPORT_AT_MS,
  DEFAULT_UNHANDLED_LIMIT
} from './constants.js'
import type { IProcessResilienceOptions } from './types.js'

/** Validated native options retain the original construction-time error and default behavior. */
export type IRequiredProcessNativeOptions = IProcessResilienceOptions &
  Readonly<{
    maxConnections: number
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
): IRequiredProcessNativeOptions {
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
    drainMs: positive(input.drainMs, DEFAULT_DRAIN_MS, 'drainMs'),
    reportAtMs: reportOffsets(input.reportAtMs),
    unhandledLimit: positive(input.unhandledLimit, DEFAULT_UNHANDLED_LIMIT, 'unhandledLimit'),
    liquidation: Object.freeze({ cascade: input.liquidation?.cascade === true })
  })
}
