import { RpcConfigurationError } from '../errors.js'
import type { IRpcUuidConfig } from '../typing.js'
import { NativeDefaultIdText } from './native-default-id-text.js'
import { bytesToBase64 } from '@migaia/utils/bytes'

/** Exact local exhaustion identity cannot be imitated by a caller-supplied generator error. */
const exhaustionErrors = new WeakSet<object>()

/** Canonical ID allocation preserves only the native generator's genuine no-reuse exhaustion. */
export function isNativeDefaultCounterExhaustion(error: unknown): boolean {
  return typeof error === 'object' && error !== null && exhaustionErrors.has(error)
}

/**
 * Selects only the native endpoint's default generator; unavailable secure nonce source keeps
 * legacy.
 */
export function createNativeDefaultAllocator(
  config: IRpcUuidConfig,
  startCounter = 0n,
  report: (error: unknown) => void = () => undefined
): (() => string) | undefined {
  if (config.generate !== undefined || !globalThis.crypto?.getRandomValues) return undefined
  /** Entropy is acquired at construction so a failing native claim rolls back immediately. */
  let bytes: Uint8Array
  try {
    bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  } catch (error) {
    throw new RpcConfigurationError(NativeDefaultIdText.nonceFailed, error)
  }
  /** Unpadded base64url represents the fixed 16-byte nonce in exactly 22 characters. */
  const nonce = bytesToBase64(bytes).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
  /** One sequence spans request, one-way and stream; failed or cancelled sends do not roll it back. */
  let counter = startCounter
  return () => {
    if (counter === 0xffffffffffffffffn) {
      /** Reporting occurs before rejection through the existing endpoint diagnostic owner. */
      const error = new RpcConfigurationError(NativeDefaultIdText.counterExhausted)
      exhaustionErrors.add(error)
      report(error)
      throw error
    }
    return `${nonce}_${(++counter).toString(36).padStart(13, '0')}`
  }
}
