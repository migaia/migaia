// Keep the internal compatibility path while preserving the canonical utility function identity.
export { isUint8Array } from '@migaia/utils/bytes'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, RpcCoreErrorCode } from '../error-code.js'
import { RpcCoreErrorText } from '../error-text.js'

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
  try {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
      return undefined
    return (value as Record<PropertyKey, T>)[key]
  } catch (error) {
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
}

/** Accepts only finite safe integer values from an untrusted boundary. */
export function isSafeIntegerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** Converts an untrusted value to text without invoking a hostile conversion twice. */
export function safeString(value: unknown, fallback = 'Unknown error'): string {
  try {
    return typeof value === 'string' ? value : String(value)
  } catch {
    return fallback
  }
}

/** Builds an injective key for attacker-controlled tuple components. */
export function tupleKey(...parts: readonly string[]): string {
  return JSON.stringify(parts)
}

/** Creates a dictionary that cannot interpret attacker-controlled keys as properties. */
export function createSafeRecord<T>(): Partial<Record<string, T>> {
  return Object.create(null) as Partial<Record<string, T>>
}

/**
 * Creates the canonical tagged key for one fanout delivery, matching the legacy
 * `#fanoutDeliveryKey` shape exactly: an anonymous per-target delivery is tagged `["target", id]`,
 * and a delivery resolved (or pinned) to a specific receiver is tagged `["receiver", id,
 * receiverId]`. Both `sendAll` and `pingAll` share this one definition so neither owner can drift
 * from the other or from an attacker-controlled `__proto__`-shaped target/receiver id landing on a
 * plain-object accumulator.
 */
export function fanoutDeliveryKey(targetId: string, receiverId?: string): string {
  return receiverId === undefined
    ? tupleKey('target', targetId)
    : tupleKey('receiver', targetId, receiverId)
}
