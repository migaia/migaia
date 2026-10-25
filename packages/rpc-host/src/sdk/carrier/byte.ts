/**
 * Composes an acquired byte IO resource with bounded length framing, fatal UTF-8 and the message
 * carrier. Owns partial-frame/reusable-write storage while the native source keeps reader
 * acquisition and backpressure; the common codec and Session retain semantic admission and
 * identity.
 */
import { jsonParser } from '@migaia/serialize/plugins'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'
import { createContractError } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import type {
  IRpcCarrier,
  IRpcDispose,
  IRpcCarrierWriteOptions
} from '@migaia/rpc-contract/interfaces'
import { createRpcStreamFrameDecoder, encodeRpcStreamTextFrame } from '../wire/physical-stream.js'
import type { IRpcByteIO } from '../wire/byte-pump.js'
import { RpcUtf8 } from './utf8.js'
import { createRpcMessageCarrier } from './message.js'
import { decodeRpcCarrierText } from './json.js'
import { RPC_CARRIER_RETAINED_FRAME_BYTES } from './constants.js'
import type {
  IRpcMessageIO,
  IRpcMessageCarrierOptions,
  IRpcUtf8Options,
  IRpcJsonTextParser
} from './types.js'

/** Native byte IO remains acquired by the platform, including its original reader/write-drain owner. */
export type IRpcByteCarrierOptions = Omit<IRpcMessageCarrierOptions, 'io' | 'nativeBinary'> &
  Readonly<{
    io: IRpcByteIO
    utf8?: IRpcUtf8Options
  }>

/**
 * The actual length-framing owner converts physical bytes once and lends only drained small
 * storage.
 */
class RpcByteMessageIO implements IRpcMessageIO {
  /** One original native stream owns actual read/write and physical-close settlement. */
  readonly #options: IRpcByteCarrierOptions
  /** A genuine fatal UTF-8 decoder is captured once for this physical stream. */
  readonly #utf8: RpcUtf8
  /**
   * Native JSON parse/stringify preserves own-key order without a portable reprojection or key
   * sort.
   */
  readonly #json = jsonParser() as unknown as IRpcJsonTextParser
  /** Partial frame bytes remain with the existing bounded decoder until end or explicit close. */
  readonly #decoder
  /** Only the physical message carrier's exact receiver is held here. */
  #receive: ((value: unknown) => void) | undefined
  /** Framing/UTF-8 failures reach the physical owner's existing failure channel. */
  #error: ((error: unknown) => void) | undefined
  /** Native subscription can synchronously fail before the original error remover is acquired. */
  #pendingError: unknown
  /** Occupancy preserves even a supported thrown undefined through that synchronous handoff. */
  #failed = false
  /** Completed backing can be lent again only after its original native write really drains. */
  #available: Uint8Array | undefined
  /** Intentional close drops partial bytes without synthesizing a truncated-tail error. */
  #closed = false

  /** Capture codec capabilities and bounded length state without starting a new native read loop. */
  constructor(options: IRpcByteCarrierOptions) {
    this.#options = options
    this.#utf8 = new RpcUtf8(options.utf8)
    this.#decoder = createRpcStreamFrameDecoder({
      onFrame: this.#frame,
      onError: this.#fail,
      errorMetadata: options.errorMetadata
    })
  }
  /** Decode native UTF-8 and JSON exactly once; ordinary bytes carry semantic JSON directly. */
  readonly #frame = (bytes: Uint8Array): void => {
    try {
      /** The canonical JSON parser supplies actual native JSON semantics without a sorting codec. */
      const value = decodeRpcCarrierText(
        this.#utf8.decode(bytes, this.#options.errorMetadata),
        this.#json,
        this.#options.errorMetadata
      )
      this.#receive?.(
        value &&
          typeof value === 'object' &&
          Object.getOwnPropertyDescriptor(value, 'kind')?.value === RpcCarrierFrameKind.extension
          ? value
          : { kind: RpcCarrierFrameKind.message, data: value }
      )
    } catch (error) {
      this.#fail(error)
    }
  }
  /** The physical carrier alone reports and retires a framing/decode failure. */
  readonly #fail = (error: unknown): void => {
    if (this.#error) this.#error(error)
    else if (!this.#failed) {
      this.#failed = true
      this.#pendingError = error
    }
  }
  /**
   * Capture the current original receiver before native subscription can synchronously deliver
   * bytes.
   */
  onMessage(listener: (value: unknown) => void): IRpcDispose {
    this.#receive = listener
    /** Native byte subscription is removed by the same whole-message carrier close owner. */
    const remove = this.#options.io.onData((chunk) => {
      try {
        this.#decoder.push(chunk)
      } catch (error) {
        this.#fail(error)
      }
    })
    return () => {
      remove()
      if (this.#receive === listener) this.#receive = undefined
    }
  }
  /** Native EOF validates a partial tail before publishing the same physical close reason. */
  onClose(listener: (reason?: unknown) => void): IRpcDispose {
    return this.#options.io.onClose((reason) => {
      if (!this.#closed) this.#decoder.finish()
      listener(reason)
    })
  }
  /** Register the sole framing failure port without allocating a second observer table. */
  onError(listener: (error: unknown) => void): IRpcDispose {
    this.#error = listener
    if (this.#failed) {
      /** Clear before arbitrary receiver code can synchronously close and reenter this source. */
      const error = this.#pendingError
      this.#pendingError = undefined
      this.#failed = false
      listener(error)
    }
    return () => {
      if (this.#error === listener) this.#error = undefined
    }
  }
  /** Serialize extension wrappers only; ordinary messages preserve their exact selected JSON text. */
  send(
    value: unknown,
    _transfer?: readonly ArrayBuffer[],
    options?: IRpcCarrierWriteOptions
  ): Promise<void> {
    /** Only this carrier's held write path constructs the outer message/extension record. */
    const frame = value as { kind: string; data: unknown; sidecars?: readonly ArrayBuffer[] }
    if (frame.sidecars?.length)
      throw createContractError(
        RpcContractErrorCode.invalidFrame,
        undefined,
        this.#options.errorMetadata
      )
    /** Extension records remain opaque plugin-owned data until the peer's fixed frame hook. */
    const encoded =
      frame.kind === RpcCarrierFrameKind.message && typeof frame.data === 'string'
        ? frame.data
        : (this.#json.encode(frame)[1] as string)
    /** Borrowing clears the slot immediately so concurrent writes always own independent storage. */
    const available = this.#available
    this.#available = undefined
    /** One UTF-8 pass writes into the final native length frame. */
    const bytes = encodeRpcStreamTextFrame(
      encoded,
      this.#utf8.encoder,
      available,
      this.#options.errorMetadata
    )
    return this.#options.io.write(bytes, options).finally(() => {
      if (
        !this.#closed &&
        this.#available === undefined &&
        bytes.buffer.byteLength <= RPC_CARRIER_RETAINED_FRAME_BYTES
      )
        this.#available = new Uint8Array(bytes.buffer)
    })
  }
  /**
   * Whole-message carrier guarantees shared close identity while this media owner drops retained
   * bytes.
   */
  close(reason?: unknown): Promise<void> {
    this.#closed = true
    this.#available = undefined
    this.#decoder.close()
    this.#pendingError = undefined
    this.#failed = false
    return this.#options.io.close(reason)
  }
}

/** Hold the real byte stream under the same message lifecycle, without bootstrap/ACK/old profiles. */
export function createRpcByteCarrier(options: IRpcByteCarrierOptions): IRpcCarrier {
  return createRpcMessageCarrier({
    ...options,
    io: new RpcByteMessageIO(options),
    nativeBinary: false
  })
}
