/**
 * Owns authentication callback encoding across prepared metadata, text and byte representations.
 * Reuses the canonical JSON privacy and UTF-8 boundaries while preserving original binary sidecars;
 * the codec remains the sole semantic admission and native-backing restoration owner.
 */
import { jsonParser } from '@migaia/serialize/plugins'
import { isUint8Array } from '@migaia/utils/bytes'
import { createRpcAuthenticationError } from '../../host/error-owner.js'
import type { IRpcJsonTextParser } from '../../sdk/carrier/types.js'
import { decodeRpcCarrierText } from '../../sdk/carrier/json.js'
import { RpcUtf8 } from '../../sdk/carrier/utf8.js'
import { hostErrorWireMetadata } from '../../host/error-wire-metadata.js'
import {
  RpcAuthenticationEncoding as Encoding,
  RpcAuthenticationEnvelope as Format
} from './constants.js'
import { RpcAuthenticationText as Text } from './text.js'
import type { IAuthenticationEnvelope, IRpcAuthenticationOptions } from './types.js'

/** Only auth's existing replay representation is adapted to the fixed prepared-metadata stage. */
export class AuthenticationRepresentation {
  /** The original JSON implementation preserves metadata own-key order without a second validator. */
  readonly #json = jsonParser() as unknown as IRpcJsonTextParser
  /** Explicit byte transforms borrow one original fatal UTF-8 capability for their installation. */
  #utf8: RpcUtf8 | undefined
  /** Explicit representation policy is captured once with its original paired transforms. */
  readonly #encoding: NonNullable<IRpcAuthenticationOptions['encodedType']>

  /** Capture one existing representation choice; ordinary object transforms acquire no byte codec. */
  constructor(encoding: IRpcAuthenticationOptions['encodedType']) {
    this.#encoding = encoding ?? Encoding.any
  }

  /** Select the default signing object or the configured text/byte callback representation. */
  bound(value: IAuthenticationEnvelope, signOnly = true): unknown {
    /** Object signing preserves the original native path and leaves canonicalization to callbacks. */
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
    /** Actual output categories, rather than caller fields, choose the one private wire projection. */
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
    /** Byte plaintext returns to the same original prefixed signed JSON category. */
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

  /** Native byte capabilities are obtained only for an actually used byte transform category. */
  #bytes(): RpcUtf8 {
    return (this.#utf8 ??= new RpcUtf8())
  }
}
