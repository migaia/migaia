/** A single nonce/counter owner spans ordinary, one-way and stream calls without id reuse. */
import { bytesToBase64 } from '@migaia/utils/bytes'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcConfigurationError, createRpcError } from '../host/error-owner.js'
import { NativeDefaultIdText } from './id-text.js'

/** Only native entropy acquisition is used; media or public diagnostic fields grant no identity. */
function nonce(): string {
  /** The structural view keeps this runtime-neutral owner free of DOM and Node ambient types. */
  const crypto = (
    globalThis as {
      crypto?: {
        getRandomValues?(bytes: Uint8Array): Uint8Array
        randomUUID?(): string
      }
    }
  ).crypto
  try {
    if (crypto?.getRandomValues)
      return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)))
        .replace(/\+/gu, '-')
        .replace(/\//gu, '_')
        .replace(/=+$/u, '')
    if (crypto?.randomUUID) return crypto.randomUUID()
  } catch (cause) {
    throw createRpcConfigurationError(NativeDefaultIdText.nonceFailed, cause)
  }
  throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.uuidUnavailable)
}

/** Failed and cancelled attempts consume their sequence; no pending-table scan is necessary. */
export class RpcCallIdAllocator {
  /** Native construction entropy isolates this host's counter from other hosts. */
  readonly #nonce: string
  /** One uint64 sequence is shared with StreamChannel; internal starting state stays within uint64. */
  #counter: bigint
  /** Exhaustion reporting belongs to the host, without a second error-class implementation. */
  readonly #report: (error: unknown) => void

  /** Acquire native entropy and the original internal starting state before publishing an owner. */
  constructor(report: (error: unknown) => void = () => undefined, startingCounter = 0n) {
    this.#report = report
    this.#counter = startingCounter
    this.#nonce = nonce()
  }

  /** Allocate once in O(1); the final uint64 value succeeds, its successor rejects and reports. */
  allocate(): string {
    if (this.#counter === 0xffffffffffffffffn) {
      /** Keep the same owned failure instance in the report and thrown result. */
      const error = createRpcConfigurationError(NativeDefaultIdText.counterExhausted)
      this.#report(error)
      throw error
    }
    return `${this.#nonce}_${(++this.#counter).toString(36).padStart(13, '0')}`
  }
}
