import {
  WebRpcAuthenticationError,
  WebRpcErrorCode,
  WebRpcLifecycleError,
  WebRpcSerializationError,
  WebRpcTransportError
} from '../errors.js'
import type {
  IWebRpcAuthenticationCapability,
  IWebRpcAuthenticationContext,
  IWebRpcPlatform,
  ISendOptions
} from '../typing.js'
import type { IWebRpcSendOptions, IWebRpcTransport } from '../transport.js'
import { isUint8Array } from './safe-value.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcSelectedComponents } from './endpoint-options.js'
import type { IRpcEnvelope } from '@migaia/rpc-contract'

/** Minimal canonical send port consumed by the outbound owner. */
export type IWebRpcOutboundTransport = {
  readonly platform: IWebRpcPlatform
  readonly encodedType?: IWebRpcTransport['encodedType']
  send(message: unknown, options?: IWebRpcSendOptions): void | Promise<void>
} & Partial<Omit<IWebRpcTransport, 'send' | 'platform' | 'encodedType'>>

/** Optional kernel lifecycle surface used to reject frames captured before endpoint close. */
type IWebRpcOutboundLifecycle = Readonly<{
  readonly generation: number
  assertActive(generation?: number): void
}>

/** Owns outbound protocol encoding, chunk framing, and transport error classification. */
export class WebRpcOutboundSender {
  readonly transport: IWebRpcOutboundTransport
  readonly id: string
  readonly components: IWebRpcSelectedComponents
  readonly authentication: IWebRpcAuthenticationCapability | undefined
  readonly onVariationFailure: (code: string, error: unknown) => void
  /** Captures the validated transport payload discriminant for every outbound frame. */
  readonly #transportEncodedType: IWebRpcTransport['encodedType']
  /** Captures the kernel lifecycle once so every asynchronous send phase shares one generation. */
  readonly #lifecycle: IWebRpcOutboundLifecycle | undefined

  constructor(
    transport: IWebRpcOutboundTransport,
    id: string,
    components: IWebRpcSelectedComponents,
    onVariationFailure: (code: string, error: unknown) => void,
    authentication?: IWebRpcAuthenticationCapability,
    platform: IWebRpcPlatform = transport.platform
  ) {
    this.transport = transport
    this.id = id
    this.components = components
    this.authentication = authentication
    this.onVariationFailure = onVariationFailure
    this.#transportEncodedType = transport.encodedType
    const lifecycle = transport as Partial<IWebRpcOutboundLifecycle>
    this.#lifecycle =
      typeof lifecycle.assertActive === 'function' && typeof lifecycle.generation === 'number'
        ? (lifecycle as IWebRpcOutboundLifecycle)
        : undefined
    this.#authenticationContext = Object.freeze({
      direction: 'outbound',
      endpointId: id,
      platform
    })
  }

  /** Stable context passed to every outbound authentication transform. */
  readonly #authenticationContext: IWebRpcAuthenticationContext

  /** Encodes one semantic envelope once, then protects and sends each selected physical frame. */
  send(message: IRpcEnvelope, options?: ISendOptions): void | Promise<void> {
    const generation = this.#lifecycle?.generation
    this.#lifecycle?.assertActive(generation)
    const transfer = this.#snapshotTransfer(options)
    const hasTransfer = transfer !== undefined && transfer.length > 0
    let encoded: unknown
    try {
      encoded = this.components.codec.encode(message)
      this.assertProtocolEncodedType(encoded)
    } catch (cause) {
      throw new WebRpcSerializationError(WebRpcErrorText.protocolEncodeFailed, cause)
    }
    let frames: readonly unknown[]
    try {
      frames = this.components.framer.frame(encoded, {
        source: this.id,
        messageId: message.id
      })
    } catch (cause) {
      throw new WebRpcSerializationError(WebRpcErrorText.protocolEncodeFailed, cause)
    }
    this.#lifecycle?.assertActive(generation)
    if (hasTransfer && frames.length !== 1)
      throw new WebRpcSerializationError(WebRpcErrorText.transferUnsupportedForChunking)
    return this.#prepareFrames(frames, transfer, hasTransfer, generation).then((preparedFrames) => {
      this.#lifecycle?.assertActive(generation)
      return this.#sendPreparedFrames(preparedFrames, transfer, generation)
    })
  }

  /** Encodes and sends a variation through the same selected framing path as every envelope. */
  sendVariation(message: IRpcEnvelope, rejectOnFailure = false): Promise<void> {
    try {
      return Promise.resolve(this.send(message)).catch((error) => {
        const code =
          error instanceof WebRpcAuthenticationError
            ? WebRpcErrorCode.authenticationFailed
            : WebRpcErrorCode.transport
        this.onVariationFailure(code, error)
        if (rejectOnFailure) throw error
      })
    } catch (error) {
      this.onVariationFailure(WebRpcErrorCode.internal, error)
      return rejectOnFailure ? Promise.reject(error) : Promise.resolve()
    }
  }

  /** Validates codec output before it reaches a typed transport boundary. */
  private assertProtocolEncodedType(value: unknown): void {
    const encodedType = this.components.codec.encodedType
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

  /** Protects every frame before any transport send and preserves the first observed failure. */
  #prepareFrames(
    frames: readonly unknown[],
    transfer: readonly unknown[] | undefined,
    hasTransfer: boolean,
    generation: number | undefined
  ): Promise<readonly unknown[]> {
    let hasFailure = false
    let firstFailure: unknown
    const preparations = frames.map((frame) =>
      this.#prepareTransportValue(frame, transfer, hasTransfer, generation).catch(
        (error: unknown) => {
          if (!hasFailure) {
            hasFailure = true
            firstFailure = error
          }
          throw error
        }
      )
    )
    return Promise.all(
      preparations.map((preparation) =>
        preparation.then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error })
        )
      )
    ).then((results) => {
      if (hasFailure) throw firstFailure
      const prepared: unknown[] = []
      for (const result of results) {
        if (result.ok) prepared.push(result.value)
      }
      return prepared
    })
  }

  /** Starts all transport sends only after protection succeeded, while retaining first failure. */
  #sendPreparedFrames(
    frames: readonly unknown[],
    transfer: readonly unknown[] | undefined,
    generation: number | undefined
  ): Promise<void> {
    let hasFailure = false
    let firstFailure: unknown
    const sends = frames.map((frame) =>
      this.#sendPreparedTransport(frame, transfer, generation).catch((error: unknown) => {
        if (!hasFailure) {
          hasFailure = true
          firstFailure = error
        }
        throw error
      })
    )
    return Promise.all(
      sends.map((send) =>
        send.then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error })
        )
      )
    ).then(() => {
      if (hasFailure) throw firstFailure
    })
  }

  /** Normalizes synchronous and asynchronous transport failures without changing send ordering. */
  #prepareTransportValue(
    value: unknown,
    transfer?: readonly unknown[],
    hasTransfer = transfer !== undefined && transfer.length > 0,
    generation?: number
  ): Promise<unknown> {
    if (this.authentication && hasTransfer)
      return Promise.reject(
        new WebRpcAuthenticationError(WebRpcErrorText.transferUnsupportedWithAuthentication)
      )
    const authentication = this.authentication
    if (!authentication)
      return Promise.resolve().then(() => {
        try {
          this.#lifecycle?.assertActive(generation)
          this.assertTransportEncodedType(value)
          return value
        } catch (cause) {
          if (cause instanceof WebRpcLifecycleError) throw cause
          throw new WebRpcTransportError(WebRpcErrorText.transportSendFailed, cause)
        }
      })

    return Promise.resolve()
      .then(() => {
        this.#lifecycle?.assertActive(generation)
        return authentication.protect(value, this.#authenticationContext)
      })
      .catch((cause) => {
        if (cause instanceof WebRpcAuthenticationError) throw cause
        if (cause instanceof WebRpcLifecycleError) throw cause
        throw new WebRpcAuthenticationError(WebRpcErrorText.authenticationFailed, cause)
      })
      .then((protectedValue) => {
        try {
          this.#lifecycle?.assertActive(generation)
          this.assertTransportEncodedType(protectedValue)
          return protectedValue
        } catch (cause) {
          if (cause instanceof WebRpcAuthenticationError) throw cause
          if (cause instanceof WebRpcLifecycleError) throw cause
          throw new WebRpcAuthenticationError(
            WebRpcErrorText.protectedEncodedType(this.#transportEncodedType ?? 'any'),
            cause
          )
        }
      })
  }

  /** Sends a fully prepared value while preserving the transport method receiver. */
  #sendPreparedTransport(
    value: unknown,
    transfer: readonly unknown[] | undefined,
    generation: number | undefined
  ): Promise<void> {
    return Promise.resolve()
      .then(() => {
        this.#lifecycle?.assertActive(generation)
        return this.transport.send(value, { transfer })
      })
      .then(() => {
        this.#lifecycle?.assertActive(generation)
      })
      .then(() => undefined)
      .catch((cause) => {
        if (cause instanceof WebRpcAuthenticationError) throw cause
        if (cause instanceof WebRpcLifecycleError) throw cause
        throw new WebRpcTransportError(WebRpcErrorText.transportSendFailed, cause)
      })
  }
}
