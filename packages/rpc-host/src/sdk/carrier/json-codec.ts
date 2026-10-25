/**
 * Owns the executing prepare/encode/decode/restore chain for the common JSON media codec. Binary
 * capture and canonical protocol validators are reused once; a private prepared-root WeakMap joins
 * restore/digest work, while native IO, authentication policy and Session identity stay outside.
 */
import { jsonParser } from '@migaia/serialize/plugins'
import {
  normalizeRpcFrame,
  isRpcOperationalFrame,
  RpcWireBinaryStorage,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import type {
  IRpcCarrierCodec,
  IRpcPreparedMessage,
  IRpcCodecContext,
  IRpcCarrierFrame
} from '@migaia/rpc-contract/interfaces'
import { createContractError } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { captureRpcBinary } from '../wire/binary-capture.js'
import { encodeBytes, finishRpcBinaryCapture, restoreRpcBinary } from '../wire/binary.js'
import { BinaryShape, RPC_BINARY_MAX_BYTES } from '../wire/binary-shape.js'
import type { IRpcBinaryDigest } from '../wire/binary-types.js'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'
import type { IRpcJsonTextParser } from './types.js'
import { splitRpcPreparedMetadata, joinRpcPreparedMetadata } from './prepared.js'
import { decodeRpcCarrierText } from './json.js'
import { captureRpcWirePortableRecord } from '@migaia/rpc-contract/portable'

/** Native media may retain its registered syntax diagnostic after the one parser's privacy policy. */
type IRpcJsonCarrierCodecOptions = Readonly<{
  digest?: IRpcBinaryDigest
  /** Translate only the already-redacted parser cause to this media's registered diagnostic. */
  projectDecodeFailure?(safeCause: unknown): Error
}>

/** One real media codec owns the sole prepare/encode/decode/restore execution chain. */
export class RpcJsonCarrierCodec implements IRpcCarrierCodec {
  /** Native JSON stringify preserves serialize's original insertion order and exact text bytes. */
  readonly #json = jsonParser() as unknown as IRpcJsonTextParser
  /** Whole-backing hashing remains the actual platform crypto operation supplied by its carrier. */
  readonly #options: IRpcJsonCarrierCodecOptions
  /**
   * Authentication and Session join one original admission/digest execution for this exact prepared
   * root.
   */
  readonly #restored = new WeakMap<IRpcPreparedMessage, Promise<IRpcSemanticFrame>>()
  /** Capture only actual capability configuration, without creating a second graph/pending owner. */
  constructor(options: IRpcJsonCarrierCodecOptions = {}) {
    this.#options = options
  }

  /** Capture native/ordinary slot alternatives in one original graph walk before envelope hooks. */
  async prepare(
    message: IRpcSemanticFrame,
    context: IRpcCodecContext
  ): Promise<IRpcPreparedMessage> {
    if (!isRpcOperationalFrame(message))
      return { message: normalizeRpcFrame(message, context.errorMetadata), sidecars: [] }
    /** Physical capability selects native storage; caller transfer options cannot manufacture it. */
    const options = {
      storage: context.nativeBinary ? RpcWireBinaryStorage.native : RpcWireBinaryStorage.inline,
      limit: context.maxFrameBytes,
      digest: this.#options.digest,
      errorMetadata: context.errorMetadata
    }
    /** Metadata admission and both output builders share the sole BinaryCapture traversal. */
    const capture = captureRpcBinary(
      message,
      options.storage,
      Math.min(context.maxFrameBytes, RPC_BINARY_MAX_BYTES),
      options.digest,
      undefined,
      encodeBytes,
      context.errorMetadata,
      context.nativeBinary ? undefined : captureRpcWirePortableRecord
    )
    if (!capture.hasBinary) return { message: capture.semanticEnvelope, sidecars: [] }
    /** Actual hash suspension never rereads the original business graph or replaces its backings. */
    const prepared = await finishRpcBinaryCapture(
      capture,
      options,
      new BinaryShape(options.limit, options.errorMetadata)
    )
    return {
      message: prepared.manifest.envelope,
      manifest: prepared.manifest,
      sidecars: prepared.sidecars
    }
  }
  /** Consume the same prepared metadata after hooks; no business projection or key sorting occurs. */
  encode(value: IRpcPreparedMessage, _context: IRpcCodecContext): IRpcCarrierFrame {
    /** Hook-produced metadata is the exact message embedded in this operation's protected manifest. */
    const selected = joinRpcPreparedMetadata(value)
    return {
      kind: RpcCarrierFrameKind.message,
      data: this.#json.encode(selected)[1],
      ...(value.sidecars.length ? { sidecars: value.sidecars } : {})
    }
  }
  /** Parse text once; byte carriers already supply their once-parsed ordinary JSON value. */
  decode(frame: IRpcCarrierFrame, context: IRpcCodecContext): IRpcPreparedMessage {
    if (frame.kind !== RpcCarrierFrameKind.message)
      throw createContractError(RpcContractErrorCode.invalidFrame, undefined, context.errorMetadata)
    /** Only the explicit manifest discriminator selects deferred native restoration. */
    const value =
      typeof frame.data === 'string'
        ? decodeRpcCarrierText(
            frame.data,
            this.#json,
            context.errorMetadata,
            this.#options.projectDecodeFailure,
            context.maxFrameBytes
          )
        : frame.data
    return splitRpcPreparedMetadata(value, frame.sidecars ?? [])
  }

  /** Authenticate prepared metadata first; only then admit native data and restore actual backings. */
  restore(value: IRpcPreparedMessage, context: IRpcCodecContext): Promise<IRpcSemanticFrame> {
    /** Publish the original operation before any native digest can suspend or reenter. */
    let result = this.#restored.get(value)
    if (!result) {
      /** The operation keeps the two exact restore inputs under one explicit callback context. */
      const operation = { value, context }
      result = Promise.resolve().then(() => this.#restoreValue(operation.value, operation.context))
      this.#restored.set(value, result)
    }
    return result
  }
  /**
   * One actual restore owns shape admission and original-backing integrity for the cached
   * operation.
   */
  #restoreValue(
    value: IRpcPreparedMessage,
    context: IRpcCodecContext
  ): IRpcSemanticFrame | Promise<IRpcSemanticFrame> {
    if (!value.manifest) {
      if (value.sidecars.length)
        throw createContractError(
          RpcContractErrorCode.invalidFrame,
          undefined,
          context.errorMetadata
        )
      return normalizeRpcFrame(value.message, context.errorMetadata)
    }
    if (
      value.manifest.storage !== RpcWireBinaryStorage.native &&
      value.manifest.storage !== RpcWireBinaryStorage.inline
    )
      throw createContractError(RpcContractErrorCode.invalidFrame, undefined, context.errorMetadata)
    if (value.manifest.storage === RpcWireBinaryStorage.native && !context.nativeBinary)
      throw createContractError(RpcContractErrorCode.invalidFrame, undefined, context.errorMetadata)
    return restoreRpcBinary(
      { ...value.manifest, envelope: value.message },
      {
        storage: value.manifest.storage,
        sidecars: value.sidecars,
        limit: context.maxFrameBytes,
        digest: this.#options.digest,
        errorMetadata: context.errorMetadata
      }
    )
  }
}
