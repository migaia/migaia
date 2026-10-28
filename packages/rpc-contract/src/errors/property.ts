/** Pure guarded property admission preserves native coded failures and their original causes. */
import { tryString } from '@migaia/utils/string'
import { attachErrorIdentity, tryReadProperty } from '@migaia/utils/error'
import { RPC_ENDPOINT_ERROR_SOURCE as ERROR_SOURCE, RpcCoreErrorCode } from '../error-code.ts'
import { RpcCoreErrorText } from './text.ts'

/** Synchronous sink for a property-read failure; Promise-returning callbacks are rejected. */
export type IRpcPropertyReadReporter = (
  failure: Readonly<{ key: PropertyKey; error: unknown }>
) => undefined

/** Read once; a caught trap is reported or thrown with its original value as cause. */
export function safeRead<T>(
  value: unknown,
  key: PropertyKey,
  report?: IRpcPropertyReadReporter
): T | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  /** The guarded read only captures the failure; this function owns its reporting policy. */
  const read = tryReadProperty(value as Record<PropertyKey, T>, key)
  if (!read.threw) return read.value
  const error = read.error
  /** The original read error stays first if the reporter also fails. */
  let cause: unknown = error
  if (report) {
    try {
      report({ key, error })
    } catch (reportError) {
      cause = new AggregateError([error, reportError], RpcCoreErrorText.propertyReadFailed)
    }
    if (cause === error) return undefined
  }
  throw attachErrorIdentity(new TypeError(RpcCoreErrorText.propertyReadFailed, { cause }), {
    source: ERROR_SOURCE,
    code: RpcCoreErrorCode.propertyReadFailed
  })
}

/**
 * Converts an untrusted value once. A throwing conversion is reported synchronously or rethrown as
 * a coded TypeError with the original value preserved as its cause.
 */
export function safeString(
  value: unknown,
  fallback: string = RpcCoreErrorText.unknownError,
  report?: (failure: Readonly<{ error: unknown }>) => undefined
): string {
  /** Utils owns conversion; Core owns its synchronous reporting and original error identity. */
  const conversion = tryString(value)
  if (!conversion.threw) return conversion.value
  /** The exact thrown value remains the primary failure in Core's reporting boundary. */
  const error = conversion.error
  /** A failing reporter must keep the conversion failure first in the cause graph. */
  let cause: unknown = error
  if (report) {
    try {
      report({ error })
    } catch (reportError) {
      cause = new AggregateError([error, reportError], RpcCoreErrorText.stringConversionFailed)
    }
    if (cause === error) return fallback
  }
  throw attachErrorIdentity(new TypeError(RpcCoreErrorText.stringConversionFailed, { cause }), {
    source: ERROR_SOURCE,
    code: RpcCoreErrorCode.stringConversionFailed
  })
}
