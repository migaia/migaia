import {
  WebRpcAuthenticationError,
  WebRpcErrorCode,
  WebRpcError,
  WebRpcSerializationError,
  WebRpcTransportError
} from '../errors.js'
import type {
  IWebRpcAuthenticationCapability,
  IWebRpcAuthenticationContext,
  IWebRpcChunkCapability,
  IWebRpcPlatform,
  IWebRpcProtocolCapability,
  ISendOptions
} from '../typing.js'
import type { IWebRpcSendOptions, IWebRpcTransport } from '../transport.js'
import { isUint8Array } from './safe-value.js'
import { utf8ByteLength } from './utf8.js'
import { WebRpcMessageKind } from '../protocol-constants.js'
import { WebRpcErrorText } from '../error-text.js'

/** Minimal canonical send port consumed by the outbound owner. */
export type IWebRpcOutboundTransport = {
  readonly platform: IWebRpcPlatform
  readonly encodedType?: IWebRpcTransport['encodedType']
  send(message: unknown, options?: IWebRpcSendOptions): void | Promise<void>
} & Partial<Omit<IWebRpcTransport, 'send' | 'platform' | 'encodedType'>>

/** Owns outbound protocol encoding, chunk framing, and transport error classification. */
export class WebRpcOutboundSender<TTargetId extends string> {
  readonly transport: IWebRpcOutboundTransport
  readonly id: string
  readonly protocol: IWebRpcProtocolCapability
  readonly chunk: IWebRpcChunkCapability
  readonly authentication: IWebRpcAuthenticationCapability | undefined
  readonly onVariationFailure: (code: string, error: unknown) => void
  /** Releases a chunk message id after every frame has settled. */
  readonly #releaseMessageId: (id: string) => void
  /** Captures the validated transport payload discriminant for every outbound frame. */
  readonly #transportEncodedType: IWebRpcTransport['encodedType']

  constructor(
    transport: IWebRpcOutboundTransport,
    id: string,
    protocol: IWebRpcProtocolCapability,
    chunk: IWebRpcChunkCapability,
    onVariationFailure: (code: string, error: unknown) => void,
    authentication?: IWebRpcAuthenticationCapability,
    platform: IWebRpcPlatform = transport.platform,
    releaseMessageId: (id: string) => void = () => undefined
  ) {
    this.transport = transport
    this.id = id
    this.protocol = protocol
    this.chunk = chunk
    this.authentication = authentication
    this.onVariationFailure = onVariationFailure
    this.#releaseMessageId = releaseMessageId
    this.#transportEncodedType = transport.encodedType
    this.#authenticationContext = Object.freeze({
      direction: 'outbound',
      endpointId: id,
      platform
    })
  }

  /** Stable context passed to every outbound authentication transform. */
  readonly #authenticationContext: IWebRpcAuthenticationContext

  /** Encodes and sends a contract message, optionally framing it into chunks. */
  send(
    message: unknown,
    createMessageId: (targetId: TTargetId) => string,
    options?: ISendOptions
  ): void | Promise<void> {
    const transfer = this.#snapshotTransfer(options)
    const hasTransfer = transfer !== undefined && transfer.length > 0
    let encoded: unknown
    try {
      encoded = this.protocol.encode(message)
      this.assertProtocolEncodedType(encoded)
    } catch (cause) {
      throw new WebRpcSerializationError(WebRpcErrorText.protocolEncodeFailed, cause)
    }
    try {
      const chunkSize = this.chunk.chunkSize ?? 0
      const byteLength = (value: string): number => {
        const canonical = utf8ByteLength(value)
        const measured = this.chunk.byteLength(value)
        if (!Number.isSafeInteger(measured) || measured < canonical || measured < 0)
          throw new WebRpcSerializationError(WebRpcErrorText.invalidByteLengthMeasurement)
        return measured
      }
      if (this.chunk.maxMessageBytes) {
        const size =
          typeof encoded === 'string'
            ? byteLength(encoded)
            : isUint8Array(encoded)
              ? encoded.byteLength
              : undefined
        if (size === undefined || size > this.chunk.maxMessageBytes)
          throw new WebRpcSerializationError(WebRpcErrorText.encodedMessageTooLarge)
      }
      if (chunkSize > 0 && typeof encoded === 'string' && byteLength(encoded) > chunkSize) {
        if (hasTransfer)
          throw new WebRpcSerializationError(WebRpcErrorText.transferUnsupportedForChunking)
        const targetId = (message as { targetId: TTargetId }).targetId
        const receiverId = (message as { receiverId?: string }).receiverId
        const maxChunks = this.chunk.maxChunksPerMessage ?? 4096
        if (!Number.isSafeInteger(maxChunks) || maxChunks <= 0)
          throw new WebRpcSerializationError(WebRpcErrorText.invalidChunkFrames)
        const splitResult = this.chunk.split(encoded, chunkSize)
        let partCount: number
        try {
          if (!Array.isArray(splitResult))
            throw new WebRpcSerializationError(WebRpcErrorText.invalidChunkFrames)
          partCount = splitResult.length
        } catch (cause) {
          if (cause instanceof WebRpcSerializationError) throw cause
          throw new WebRpcSerializationError(WebRpcErrorText.invalidChunkFrames, cause)
        }
        if (!Number.isSafeInteger(partCount) || partCount === 0 || partCount > maxChunks)
          throw new WebRpcSerializationError(WebRpcErrorText.invalidChunkFrames)
        const parts: string[] = []
        const maxChunkBytes = this.chunk.maxChunkBytes ?? 4 * 1024 * 1024
        try {
          for (let index = 0; index < partCount; index += 1) {
            const part = splitResult[index]
            if (typeof part !== 'string' || part.length === 0) {
              throw new WebRpcSerializationError(WebRpcErrorText.invalidChunkFrames)
            }
            const partBytes = byteLength(part)
            if (partBytes > chunkSize || partBytes > maxChunkBytes)
              throw new WebRpcSerializationError(WebRpcErrorText.invalidChunkFrames)
            parts.push(part)
          }
        } catch (cause) {
          if (cause instanceof WebRpcSerializationError) throw cause
          throw new WebRpcSerializationError(WebRpcErrorText.invalidChunkFrames, cause)
        }
        if (parts.join('') !== encoded)
          throw new WebRpcSerializationError(WebRpcErrorText.invalidChunkFrames)
        let messageId: string
        try {
          messageId = createMessageId(targetId)
        } catch (cause) {
          // ID admission is not a transport operation. Preserve a typed capacity,
          // lifecycle, or configuration error so callers can apply the right policy.
          if (cause instanceof WebRpcError) throw cause
          throw new WebRpcTransportError(WebRpcErrorText.transportSendFailed, cause)
        }
        const frames: unknown[] = []
        try {
          for (let index = 0; index < parts.length; index += 1) {
            const data = parts[index]
            frames.push(
              this.encodeFrame({
                kind: WebRpcMessageKind.chunk,
                messageId,
                index,
                total: parts.length,
                data,
                senderId: this.id,
                targetId,
                ...(receiverId === undefined ? {} : { receiverId })
              })
            )
          }
        } catch (cause) {
          let releaseError: unknown
          let releaseFailed = false
          try {
            this.#releaseMessageId(messageId)
          } catch (error) {
            releaseFailed = true
            releaseError = error
          }
          if (releaseFailed) {
            throw new WebRpcSerializationError(
              WebRpcErrorText.protocolEncodeFailed,
              new AggregateError([cause, releaseError], WebRpcErrorText.protocolEncodeFailed, {
                cause
              })
            )
          }
          if (cause instanceof WebRpcSerializationError) throw cause
          throw new WebRpcSerializationError(WebRpcErrorText.protocolEncodeFailed, cause)
        }
        const preparedFrames: unknown[] = []
        let hasPreprocessingFailure = false
        let preprocessingFailure: unknown
        const observedPreprocessing = frames.map(async (frame, index) => {
          try {
            preparedFrames[index] = await this.#prepareTransportValue(frame)
          } catch (cause) {
            hasPreprocessingFailure = true
            preprocessingFailure ??= cause
          }
        })
        return Promise.all(observedPreprocessing).then(() => {
          if (hasPreprocessingFailure) {
            let releaseError: unknown
            let releaseFailed = false
            try {
              this.#releaseMessageId(messageId)
            } catch (error) {
              releaseFailed = true
              releaseError = error
            }
            if (releaseFailed) {
              const primary = preprocessingFailure
              if (primary instanceof WebRpcAuthenticationError)
                throw new WebRpcAuthenticationError(
                  WebRpcErrorText.transportSendFailed,
                  new AggregateError([primary, releaseError], WebRpcErrorText.transportSendFailed, {
                    cause: primary
                  })
                )
              throw new WebRpcTransportError(
                WebRpcErrorText.transportSendFailed,
                new AggregateError([primary, releaseError], WebRpcErrorText.transportSendFailed, {
                  cause: primary
                })
              )
            }
            throw preprocessingFailure
          }

          let hasFailure = false
          let firstFailure: unknown
          const observedSends = preparedFrames.map((frame) =>
            this.#sendPreparedTransport(frame).catch((cause) => {
              if (!hasFailure) {
                hasFailure = true
                firstFailure = cause
              }
            })
          )
          return Promise.all(observedSends).then(() => {
            let releaseError: unknown
            let releaseFailed = false
            try {
              this.#releaseMessageId(messageId)
            } catch (error) {
              releaseFailed = true
              releaseError = error
            }
            if (hasFailure) {
              if (releaseFailed)
                throw new WebRpcTransportError(
                  WebRpcErrorText.transportSendFailed,
                  new AggregateError(
                    [firstFailure, releaseError],
                    WebRpcErrorText.transportSendFailed,
                    {
                      cause: firstFailure
                    }
                  )
                )
              throw firstFailure
            }
            if (releaseFailed) throw releaseError
          })
        })
      }
      return this.#sendTransport(encoded, transfer, hasTransfer)
    } catch (cause) {
      if (cause instanceof WebRpcError) throw cause
      throw new WebRpcTransportError(WebRpcErrorText.transportSendFailed, cause)
    }
  }

  /** Encodes and sends a variation without chunking it. */
  sendVariation(message: unknown, rejectOnFailure = false): Promise<void> {
    let encoded: unknown
    try {
      encoded = this.protocol.encode(message)
      this.assertProtocolEncodedType(encoded)
    } catch (error) {
      this.onVariationFailure(WebRpcErrorCode.internal, error)
      return rejectOnFailure ? Promise.reject(error) : Promise.resolve()
    }
    return this.#sendTransport(encoded).catch((error) => {
      const code =
        error instanceof WebRpcAuthenticationError
          ? WebRpcErrorCode.authenticationFailed
          : WebRpcErrorCode.transport
      this.onVariationFailure(code, error)
      if (rejectOnFailure) throw error
    })
  }

  /** Validates codec output before it reaches a typed transport boundary. */
  private assertProtocolEncodedType(value: unknown): void {
    const encodedType = this.protocol.encodedType
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw new WebRpcSerializationError(WebRpcErrorText.protocolEncodedType(encodedType))
  }

  /** Validates protected output against transport payload requirements. */
  private assertTransportEncodedType(value: unknown): void {
    const encodedType = this.#transportEncodedType
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw new WebRpcAuthenticationError(WebRpcErrorText.protectedEncodedType(encodedType))
  }

  /** Captures one owned, immutable transfer-list snapshot before any encoding or framing work. */
  #snapshotTransfer(options: ISendOptions | undefined): readonly unknown[] | undefined {
    let transfer: unknown
    try {
      transfer = options?.transfer
    } catch (cause) {
      throw new WebRpcSerializationError(WebRpcErrorText.invalidTransferList, cause)
    }
    if (transfer === undefined) return undefined
    try {
      if (!Array.isArray(transfer))
        throw new WebRpcSerializationError(WebRpcErrorText.invalidTransferList)
      const transferLength = transfer.length
      if (!Number.isSafeInteger(transferLength))
        throw new WebRpcSerializationError(WebRpcErrorText.invalidTransferList)
      const snapshot: unknown[] = []
      for (let index = 0; index < transferLength; index += 1) snapshot.push(transfer[index])
      return Object.freeze(snapshot)
    } catch (cause) {
      if (cause instanceof WebRpcSerializationError) throw cause
      throw new WebRpcSerializationError(WebRpcErrorText.invalidTransferList, cause)
    }
  }

  /** Encodes and validates one internally generated chunk frame. */
  private encodeFrame(value: unknown): unknown {
    const encoded = this.protocol.encode(value)
    this.assertProtocolEncodedType(encoded)
    return encoded
  }

  /** Normalizes synchronous and asynchronous transport failures without changing send ordering. */
  #sendTransport(
    value: unknown,
    transfer?: readonly unknown[],
    hasTransfer = transfer !== undefined && transfer.length > 0
  ): Promise<void> {
    if (this.authentication && hasTransfer)
      return Promise.reject(
        new WebRpcAuthenticationError(WebRpcErrorText.transferUnsupportedWithAuthentication)
      )
    return this.#prepareTransportValue(value).then((protectedValue) =>
      this.#sendPreparedTransport(protectedValue, transfer)
    )
  }

  /** Applies authentication and transport-type validation without touching the transport. */
  #prepareTransportValue(value: unknown): Promise<unknown> {
    const authentication = this.authentication
    if (!authentication)
      return Promise.resolve().then(() => {
        try {
          this.assertTransportEncodedType(value)
          return value
        } catch (cause) {
          throw new WebRpcTransportError(WebRpcErrorText.transportSendFailed, cause)
        }
      })

    return Promise.resolve()
      .then(() => authentication.protect(value, this.#authenticationContext))
      .catch((cause) => {
        if (cause instanceof WebRpcAuthenticationError) throw cause
        throw new WebRpcAuthenticationError(WebRpcErrorText.authenticationFailed, cause)
      })
      .then((protectedValue) => {
        try {
          this.assertTransportEncodedType(protectedValue)
          return protectedValue
        } catch (cause) {
          if (cause instanceof WebRpcAuthenticationError) throw cause
          throw new WebRpcAuthenticationError(
            WebRpcErrorText.protectedEncodedType(this.#transportEncodedType ?? 'any'),
            cause
          )
        }
      })
  }

  /** Sends a fully prepared value while preserving the transport method receiver. */
  #sendPreparedTransport(value: unknown, transfer?: readonly unknown[]): Promise<void> {
    return Promise.resolve()
      .then(() => this.transport.send(value, { transfer }))
      .then(() => undefined)
      .catch((cause) => {
        if (cause instanceof WebRpcAuthenticationError) throw cause
        throw new WebRpcTransportError(WebRpcErrorText.transportSendFailed, cause)
      })
  }
}
