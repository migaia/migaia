import { RpcAuthenticationError, RpcConfigurationError } from '../errors.js'
import { RpcMiddlewareErrorText } from './error-text.js'
import type { IAuthenticationChallengeFields } from '../internal/authentication-replay.js'

/** Stable inner framing distinguishes authenticated replay bindings in every supported category. */
export const RpcAuthenticationEnvelope = {
  /** Object discriminator and string prefix identify the r12 signed inner protocol. */
  kind: 'rpc-authentication-replay',
  /** Prefix remains inside encryption/signing, never in an unauthenticated outer header. */
  prefix: '\u001erpc-authentication-v1:',
  /** Binding grammar is versioned independently of RPC handshake and semantic envelope versions. */
  version: 1,
  /** Counters have exactly the uint64 domain; allocation must fail before wrapping to zero. */
  maximumCounter: 0xffffffffffffffffn
} as const

/** The signed inner envelope is private and restores the original transform value category. */
export type IAuthenticationEnvelope = IAuthenticationChallengeFields & {
  readonly authentication: typeof RpcAuthenticationEnvelope.kind
  readonly version: typeof RpcAuthenticationEnvelope.version
  readonly nonce: string
  readonly counter: string
  readonly payload: unknown
}

/** Allocates a 128-bit cryptographic nonce or rejects configuration without weak fallback. */
export function createAuthenticationNonce(): string {
  if (!globalThis.crypto?.getRandomValues)
    throw new RpcConfigurationError(RpcMiddlewareErrorText.authenticationNonceUnavailable)
  try {
    /** Sixteen secure bytes become canonical lowercase hex inside the signed wrapper. */
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch (error) {
    throw new RpcConfigurationError(RpcMiddlewareErrorText.authenticationNonceFailed, error)
  }
}

/** Encloses binding before encryption; strings and bytes retain their public transform category. */
export function wrapAuthenticationEnvelope(
  value: unknown,
  nonce: string,
  counter: bigint,
  fields?: IAuthenticationChallengeFields
): unknown {
  /** Byte payloads are represented portably inside JSON and reconstructed only after validation. */
  const envelope: IAuthenticationEnvelope = {
    authentication: RpcAuthenticationEnvelope.kind,
    version: RpcAuthenticationEnvelope.version,
    nonce,
    counter: counter.toString(),
    ...fields,
    payload: value instanceof Uint8Array ? Array.from(value) : value
  }
  if (typeof value !== 'string' && !(value instanceof Uint8Array)) return envelope
  /** The marker and every binding field are covered by both configured transforms. */
  const text = RpcAuthenticationEnvelope.prefix + JSON.stringify(envelope)
  return value instanceof Uint8Array ? new TextEncoder().encode(text) : text
}

/** Rejects old/unknown/malformed bindings after verify/decrypt, before physical counter admission. */
export function readAuthenticationEnvelope(value: unknown): IAuthenticationEnvelope {
  /** Bytes are restored only when the incoming protected category was bytes. */
  const bytes = value instanceof Uint8Array
  /** Decoded transform output is never treated as trusted merely because verification succeeded. */
  let decoded = bytes ? new TextDecoder('utf-8', { fatal: true }).decode(value) : value
  if (typeof decoded === 'string') {
    if (!decoded.startsWith(RpcAuthenticationEnvelope.prefix))
      throw new RpcAuthenticationError(RpcMiddlewareErrorText.authenticationReplayBindingInvalid)
    decoded = JSON.parse(decoded.slice(RpcAuthenticationEnvelope.prefix.length))
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
    throw new RpcAuthenticationError(RpcMiddlewareErrorText.authenticationReplayBindingInvalid)
  /** Each binding field is read once before grammar checks or counter arithmetic. */
  const { authentication, version, nonce, counter, payload, ...fields } =
    decoded as IAuthenticationEnvelope
  if (
    authentication !== RpcAuthenticationEnvelope.kind ||
    version !== RpcAuthenticationEnvelope.version ||
    typeof nonce !== 'string' ||
    !/^[0-9a-f]{32}$/u.test(nonce) ||
    typeof counter !== 'string' ||
    !/^[1-9][0-9]{0,19}$/u.test(counter) ||
    BigInt(counter) > RpcAuthenticationEnvelope.maximumCounter
  )
    throw new RpcAuthenticationError(RpcMiddlewareErrorText.authenticationReplayBindingInvalid)
  if (
    bytes &&
    (!Array.isArray(payload) ||
      !payload.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255))
  )
    throw new RpcAuthenticationError(RpcMiddlewareErrorText.authenticationReplayBindingInvalid)
  return {
    authentication,
    version,
    nonce,
    counter,
    ...fields,
    payload: bytes ? new Uint8Array(payload as number[]) : payload
  }
}
