/**
 * Owns one captured encoder and fatal UTF-8 decoder for an acquired carrier. Native decode failure
 * keeps its original cause under the canonical handshake error; IO acquisition and length framing
 * stay with their separate native/SDK owners.
 */
import { createContractError, type IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCarrierEncoding } from './constants.js'
import type { IRpcUtf8Options } from './types.js'

/** Held fatal UTF-8 capability preserves the real native decoder exception on handshake cause. */
export class RpcUtf8 {
  /** One original encoder is shared by the drained physical-frame path. */
  readonly encoder: NonNullable<IRpcUtf8Options['encoder']>
  /** The original fatal decoder is captured once, before any byte delivery can occur. */
  readonly #decoder: NonNullable<IRpcUtf8Options['decoder']>
  /** Obtain standard host capabilities structurally, without importing DOM or native runtime code. */
  constructor(options: IRpcUtf8Options = {}) {
    /** Platform constructors are read only when no explicit capability was supplied. */
    const host = globalThis as unknown as {
      TextEncoder: new () => NonNullable<IRpcUtf8Options['encoder']>
      TextDecoder: new (
        encoding: string,
        options: { fatal: boolean }
      ) => NonNullable<IRpcUtf8Options['decoder']>
    }
    try {
      this.encoder = options.encoder ?? new host.TextEncoder()
      this.#decoder = options.decoder ?? new host.TextDecoder(RpcCarrierEncoding, { fatal: true })
    } catch (cause) {
      throw createContractError(RpcContractErrorCode.handshakeInvalid, cause)
    }
  }
  /** Malformed wire text keeps HANDSHAKE_INVALID and the exact native failure instance on cause. */
  decode(value: Uint8Array, metadata?: IRpcErrorWireMetadata): string {
    try {
      return this.#decoder.decode(value)
    } catch (cause) {
      throw createContractError(RpcContractErrorCode.handshakeInvalid, cause, metadata)
    }
  }
}
