/**
 * Adapt callback representations without replacing the codec's semantic admission, JSON privacy or
 * backing restoration.
 */
import { jsonParser } from '@migaia/serialize/plugins'
import { isUint8Array } from '@migaia/utils/bytes'
import { createRpcAuthenticationError } from '../../host/error-owner.ts'
import type { IRpcJsonTextParser } from '../../sdk/carrier/types.ts'
import { decodeRpcCarrierText } from '../../sdk/carrier/json.ts'
import { RpcUtf8 } from '../../sdk/carrier/utf8.ts'
import { hostErrorWireMetadata } from '../../host/error-wire-metadata.ts'
import {
  RpcAuthenticationEncoding as Encoding,
  RpcAuthenticationEnvelope as Format
} from './constants.ts'
import { RpcAuthenticationText as Text } from './text.ts'
import type { IAuthenticationEnvelope, IRpcAuthenticationOptions } from './types.ts'

/** Adapt the replay binding at the prepared-metadata stage. */
export class AuthenticationRepresentation {
  /** Reuse the JSON codec to preserve metadata key order without another validator. */
  readonly #json = jsonParser() as unknown as IRpcJsonTextParser
  /** Acquire fatal UTF-8 handling only when byte transforms need it. */
  #utf8: RpcUtf8 | undefined
  /** Keep encoding fixed for the lifetime of its paired transforms. */
  readonly #encoding: NonNullable<IRpcAuthenticationOptions['encodedType']>

  /** Capture encoding without acquiring an unused byte codec. */
  constructor(encoding: IRpcAuthenticationOptions['encodedType']) {
    this.#encoding = encoding ?? Encoding.any
  }

  /** Select the default signing object or the configured text/byte callback representation. */
  bound(value: IAuthenticationEnvelope, signOnly = true): unknown {
    /** Let object-signing callbacks choose their canonicalization. */
    if (signOnly && this.#encoding === Encoding.any) return value
    /** Encryption and explicit categories retain the signed prefix with object payload metadata. */
    const text = Format.prefix + this.#json.encode(value)[1]
    return this.#encoding === Encoding.bytes ? this.#bytes().encoder.encode(text) : text
  }

  /** Reuse verified object metadata without a second JSON parse or semantic admission. */
  metadata(value: unknown): unknown {
    if (value !== null && typeof value === 'object') return value
    throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
  }

  /**
   * The opaque prepared root transports byte outputs reversibly instead of JSON numeric-key
   * objects.
   */
  pack(value: unknown): unknown {
    /** Choose the wire projection from the transform's output category. */
    const encoding = isUint8Array(value)
      ? Encoding.bytes
      : typeof value === 'string'
        ? Encoding.string
        : Encoding.any
    if (this.#encoding !== Encoding.any && this.#encoding !== encoding)
      throw createRpcAuthenticationError(Text.outboundFrameAuthenticationFailed)
    return {
      authentication: Format.kind,
      encoding,
      payload: encoding === Encoding.bytes ? Array.from(value as Uint8Array) : value
    }
  }

  /** Reconstruct only the protected callback input; no unverified field enters replay/session state. */
  unpack(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
    /** The private outer category carries no nonce, counter, identity or dispatch authority. */
    const { authentication, encoding, payload } = value as {
      authentication?: unknown
      encoding?: unknown
      payload?: unknown
    }
    if (
      authentication !== Format.kind ||
      !Object.values(Encoding).includes(encoding as never) ||
      (this.#encoding !== Encoding.any && encoding !== this.#encoding)
    )
      throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
    if (encoding === Encoding.bytes) {
      if (
        !Array.isArray(payload) ||
        !payload.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      )
        throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
      return new Uint8Array(payload)
    }
    if (encoding === Encoding.string && typeof payload !== 'string')
      throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
    return payload
  }

  /**
   * Parse signed plaintext only after verify/decrypt, keeping the established credential excerpt
   * policy.
   */
  plaintext(value: unknown): unknown {
    /** Decode byte plaintext into the prefixed signed JSON representation. */
    const decoded = isUint8Array(value) ? this.#bytes().decode(value, hostErrorWireMetadata) : value
    if (typeof decoded !== 'string') return decoded
    if (!decoded.startsWith(Format.prefix))
      throw createRpcAuthenticationError(Text.authenticationReplayBindingInvalid)
    return decodeRpcCarrierText(
      decoded.slice(Format.prefix.length),
      this.#json,
      hostErrorWireMetadata
    )
  }

  /** Acquire byte capabilities lazily for byte transforms. */
  #bytes(): RpcUtf8 {
    return (this.#utf8 ??= new RpcUtf8())
  }
}
