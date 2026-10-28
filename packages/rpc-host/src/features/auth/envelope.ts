/**
 * Use native entropy for signed envelopes; replay checks mutate only the source window owned by the
 * installed flow.
 */
import {
  createRpcAuthenticationError,
  createRpcConfigurationError
} from '../../host/error-owner.ts'
import { RpcAuthenticationText as Text } from './text.ts'
import { RpcAuthenticationEnvelope as Format } from './constants.ts'
import type { IAuthenticationEnvelope, IAuthenticationCounterWindow } from './types.ts'

/** One canonical lowercase 128-bit spelling is shared by counter nonces and receiver challenges. */
const authenticationNoncePattern = /^[0-9a-f]{32}$/u

/** Check an auth nonce without allocating another decoded representation or accepting weak entropy. */
export function isAuthenticationNonce(value: unknown): value is string {
  return typeof value === 'string' && authenticationNoncePattern.test(value)
}

/** Require cryptographic 128-bit entropy; never substitute weak randomness on failure. */
export function createAuthenticationNonce(): string {
  /** Native entropy is obtained structurally without importing a specific runtime or DOM types. */
  const crypto = (
    globalThis as unknown as { crypto?: { getRandomValues(value: Uint8Array): Uint8Array } }
  ).crypto
  if (!crypto?.getRandomValues)
    throw createRpcConfigurationError(Text.authenticationNonceUnavailable)
  try {
    /** Keep nonce spelling canonical across signed bindings and challenges. */
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch (error) {
    throw createRpcConfigurationError(Text.authenticationNonceFailed, error)
  }
}

/** Allocate the counter before asynchronous transforms can reorder completion. */
export function wrapAuthenticationEnvelope(
  value: unknown,
  nonce: string,
  counter: bigint
): IAuthenticationEnvelope {
  return {
    authentication: Format.kind,
    version: Format.version,
    nonce,
    counter: counter.toString(),
    payload: value
  }
}

/** Read signed metadata only after verify/decrypt; malformed binding never reaches bitmap state. */
export function readAuthenticationEnvelope(value: unknown): IAuthenticationEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
  /** Snapshot signed fields before validation and counter arithmetic. */
  const { authentication, version, nonce, counter, payload } = value as IAuthenticationEnvelope
  if (
    authentication !== Format.kind ||
    version !== Format.version ||
    !isAuthenticationNonce(nonce) ||
    typeof counter !== 'string' ||
    !/^[1-9][0-9]{0,19}$/u.test(counter) ||
    BigInt(counter) > Format.maximumCounter
  )
    throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
  return { authentication, version, nonce, counter, payload }
}

/** Commit the window synchronously after signature and native integrity checks pass. */
export function admitAuthenticationCounter(
  state: IAuthenticationCounterWindow,
  sequence: bigint
): void {
  if (sequence > state.high) {
    /** Discard bitmap history only when its counters leave the window. */
    const advance = sequence - state.high
    state.bits[0] = (advance >= 64n ? 0n : state.bits[0]! << advance) | 1n
    state.high = sequence
  } else {
    /** Admit bit 63 once; reject bit 64 and previously committed bits as replays. */
    const distance = state.high - sequence
    if (distance >= 64n || (state.bits[0]! & (1n << distance)) !== 0n)
      throw createRpcAuthenticationError(Text.authenticationFrameReplayed)
    state.bits[0] = state.bits[0]! | (1n << distance)
  }
}
