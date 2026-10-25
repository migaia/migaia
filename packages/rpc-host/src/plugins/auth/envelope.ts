/**
 * Defines the signed nonce/counter envelope and its bounded replay-window operations. Nonce
 * acquisition borrows native crypto; replay checks mutate only the explicit source-window argument
 * supplied by the authentication flow, which owns its lifetime and admission.
 */
import {
  createRpcAuthenticationError,
  createRpcConfigurationError
} from '../../host/error-owner.js'
import { RpcAuthenticationText as Text } from './text.js'
import { RpcAuthenticationEnvelope as Format } from './constants.js'
import type { IAuthenticationEnvelope, IAuthenticationCounterWindow } from './types.js'

/** One canonical lowercase 128-bit spelling is shared by counter nonces and receiver challenges. */
const authenticationNoncePattern = /^[0-9a-f]{32}$/u

/** Check an auth nonce without allocating another decoded representation or accepting weak entropy. */
export function isAuthenticationNonce(value: unknown): value is string {
  return typeof value === 'string' && authenticationNoncePattern.test(value)
}

/** Allocate the original cryptographic 128-bit nonce; never substitute weak entropy on failure. */
export function createAuthenticationNonce(): string {
  /** Native entropy is obtained structurally without importing a specific runtime or DOM types. */
  const crypto = (
    globalThis as unknown as { crypto?: { getRandomValues(value: Uint8Array): Uint8Array } }
  ).crypto
  if (!crypto?.getRandomValues)
    throw createRpcConfigurationError(Text.authenticationNonceUnavailable)
  try {
    /** Original nonce spelling is canonical lowercase hex. */
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch (error) {
    throw createRpcConfigurationError(Text.authenticationNonceFailed, error)
  }
}

/** Bind one original counter before any asynchronous encryption/signing callback runs. */
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
  /** Each original replay binding field is captured exactly once before arithmetic. */
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

/** Commit the original fixed window synchronously after verification and native integrity finish. */
export function admitAuthenticationCounter(
  state: IAuthenticationCounterWindow,
  sequence: bigint
): void {
  if (sequence > state.high) {
    /** Advancing beyond the complete bitmap discards only the original out-of-window history. */
    const advance = sequence - state.high
    state.bits[0] = (advance >= 64n ? 0n : state.bits[0]! << advance) | 1n
    state.high = sequence
  } else {
    /** Bit 63 remains admissible once; bit 64 and already committed bits are original replays. */
    const distance = state.high - sequence
    if (distance >= 64n || (state.bits[0]! & (1n << distance)) !== 0n)
      throw createRpcAuthenticationError(Text.authenticationFrameReplayed)
    state.bits[0] = state.bits[0]! | (1n << distance)
  }
}
