import {
  RpcAuthenticationError,
  RpcLifecycleError,
  RpcSerializationError,
  RpcTransportError
} from '../errors.js'
import type {
  IRpcAuthenticationCapability,
  IRpcAuthenticationContext,
  IRpcPlatform,
  ISendOptions
} from '../typing.js'
import type { IRpcSendOptions, IRpcTransport } from '../transport.js'
import { isUint8Array } from './safe-value.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcSelectedComponents } from './endpoint-options.js'
import type { IRpcEnvelope } from '../../contract/index.js'
import type { IRpcOutboundAdmission, IRpcOutboundGate } from './outbound-gate.js'

/** Minimal canonical send port consumed by the outbound owner. */
export type IRpcOutboundTransport = {
  readonly platform: IRpcPlatform
  readonly encodedType?: IRpcTransport['encodedType']
  send(message: unknown, options?: IRpcSendOptions): void | Promise<void>
} & Partial<Omit<IRpcTransport, 'send' | 'platform' | 'encodedType'>>

/** Optional kernel lifecycle surface used to reject frames captured before endpoint close. */
type IRpcOutboundLifecycle = Readonly<{
  readonly generation: number
  assertActive(generation?: number): void
}>

/** Owns outbound protocol encoding, chunk framing, and transport error classification. */
export class RpcOutboundSender {
  readonly transport: IRpcOutboundTransport
  readonly id: string
  readonly components: IRpcSelectedComponents
  readonly authentication: IRpcAuthenticationCapability | undefined
  /** Captures the validated transport payload discriminant for every outbound frame. */
  readonly #transportEncodedType: IRpcTransport['encodedType']
  /** Captures the kernel lifecycle once so every asynchronous send phase shares one generation. */
  readonly #lifecycle: IRpcOutboundLifecycle | undefined
  /** Optional whole-envelope admission keeps plugin capacity outside the core codec pipeline. */
  readonly #gate: IRpcOutboundGate | undefined

  constructor(
    transport: IRpcOutboundTransport,
    id: string,
    components: IRpcSelectedComponents,
    authentication?: IRpcAuthenticationCapability,
    platform: IRpcPlatform = transport.platform,
    gate?: IRpcOutboundGate
  ) {
    this.transport = transport
    this.id = id
    this.components = components
    this.authentication = authentication
    this.#transportEncodedType = transport.encodedType
    this.#gate = gate
    const lifecycle = transport as Partial<IRpcOutboundLifecycle>
    this.#lifecycle =
      typeof lifecycle.assertActive === 'function' && typeof lifecycle.generation === 'number'
        ? (lifecycle as IRpcOutboundLifecycle)
        : undefined
    this.#authenticationContext = Object.freeze({
      direction: 'outbound',
      endpointId: id,
      platform
    })
  }

  /** Stable context passed to every outbound authentication transform. */
  readonly #authenticationContext: IRpcAuthenticationContext

  /** Encodes one semantic envelope once, then protects and sends each selected physical frame. */
  send(
    message: IRpcEnvelope,
    options?: ISendOptions,
    admission?: IRpcOutboundAdmission,
    beforeWrite?: () => IRpcEnvelope,
    onStarted?: () => void
  ): void | Promise<void> {
    if (this.#gate)
      return this.#gate.run(
        message,
        () => this.#sendEnvelope(beforeWrite?.() ?? message, options, true, admission, onStarted),
        admission
      )
    return this.#sendEnvelope(message, options, false)
  }

  /** Retains the original synchronous encode/framing path when no IPC gate was selected. */
  #sendEnvelope(
    message: IRpcEnvelope,
    options?: ISendOptions,
    gated = false,
    admission?: IRpcOutboundAdmission,
    onStarted?: () => void
  ): void | Promise<void> {
    const generation = this.#lifecycle?.generation
    this.#lifecycle?.assertActive(generation)
    const transfer = this.#snapshotTransfer(options)
    const hasTransfer = transfer !== undefined && transfer.length > 0
    let encoded: unknown
    try {
      encoded = this.components.codec.encode(message)
      this.assertProtocolEncodedType(encoded)
    } catch (cause) {
      throw new RpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    let frames: readonly unknown[]
    try {
      frames = this.components.framer.frame(encoded, {
        source: this.id,
        messageId: message.id
      })
    } catch (cause) {
      throw new RpcSerializationError(RpcCoreErrorText.protocolEncodeFailed, cause)
    }
    this.#lifecycle?.assertActive(generation)
    if (hasTransfer && frames.length !== 1)
      throw new RpcSerializationError(RpcCoreErrorText.transferUnsupportedForChunking)
    return this.#prepareFrames(frames, transfer, hasTransfer, generation).then((preparedFrames) => {
      this.#lifecycle?.assertActive(generation)
      return gated
        ? this.#sendPreparedFramesGated(preparedFrames, transfer, generation, admission, onStarted)
        : this.#sendPreparedFrames(preparedFrames, transfer, generation)
    })
  }

  /** Validates codec output before it reaches a typed transport boundary. */
  private assertProtocolEncodedType(value: unknown): void {
    const encodedType = this.components.codec.encodedType
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw new RpcSerializationError(RpcCoreErrorText.protocolEncodedType(encodedType))
  }

  /** Validates protected output against transport payload requirements. */
  private assertTransportEncodedType(value: unknown): void {
    const encodedType = this.#transportEncodedType
    if (
      (encodedType === 'string' && typeof value !== 'string') ||
      (encodedType === 'uint8array' && !isUint8Array(value))
    )
      throw new RpcAuthenticationError(RpcCoreErrorText.protectedEncodedType(encodedType))
  }

  /** Captures one owned, immutable transfer-list snapshot before any encoding or framing work. */
  #snapshotTransfer(options: ISendOptions | undefined): readonly unknown[] | undefined {
    let transfer: unknown
    try {
      transfer = options?.transfer
    } catch (cause) {
      throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList, cause)
    }
    if (transfer === undefined) return undefined
    try {
      if (!Array.isArray(transfer))
        throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList)
      const transferLength = transfer.length
      if (!Number.isSafeInteger(transferLength))
        throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList)
      const snapshot: unknown[] = []
      for (let index = 0; index < transferLength; index += 1) snapshot.push(transfer[index])
      return Object.freeze(snapshot)
    } catch (cause) {
      if (cause instanceof RpcSerializationError) throw cause
      throw new RpcSerializationError(RpcCoreErrorText.invalidTransferList, cause)
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

  /** Awaits real adapter writability between frames while committing the first frame atomically. */
  async #sendPreparedFramesGated(
    frames: readonly unknown[],
    transfer: readonly unknown[] | undefined,
    generation: number | undefined,
    admission?: IRpcOutboundAdmission,
    onStarted?: () => void
  ): Promise<void> {
    let first = true
    for (const frame of frames) {
      const beforeSend = first
        ? () => {
            admission?.assertCanSend()
            onStarted?.()
          }
        : undefined
      first = false
      await this.#sendPreparedTransport(frame, transfer, generation, beforeSend)
    }
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
        new RpcAuthenticationError(RpcCoreErrorText.transferUnsupportedWithAuthentication)
      )
    const authentication = this.authentication
    if (!authentication)
      return Promise.resolve().then(() => {
        try {
          this.#lifecycle?.assertActive(generation)
          this.assertTransportEncodedType(value)
          return value
        } catch (cause) {
          if (cause instanceof RpcLifecycleError) throw cause
          throw new RpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
        }
      })

    return Promise.resolve()
      .then(() => {
        this.#lifecycle?.assertActive(generation)
        return authentication.protect(value, this.#authenticationContext)
      })
      .catch((cause) => {
        if (cause instanceof RpcAuthenticationError) throw cause
        if (cause instanceof RpcLifecycleError) throw cause
        throw new RpcAuthenticationError(RpcCoreErrorText.authenticationFailed, cause)
      })
      .then((protectedValue) => {
        try {
          this.#lifecycle?.assertActive(generation)
          this.assertTransportEncodedType(protectedValue)
          return protectedValue
        } catch (cause) {
          if (cause instanceof RpcAuthenticationError) throw cause
          if (cause instanceof RpcLifecycleError) throw cause
          throw new RpcAuthenticationError(
            RpcCoreErrorText.protectedEncodedType(this.#transportEncodedType ?? 'any'),
            cause
          )
        }
      })
  }

  /** Sends a fully prepared value while preserving the transport method receiver. */
  #sendPreparedTransport(
    value: unknown,
    transfer: readonly unknown[] | undefined,
    generation: number | undefined,
    beforeSend?: () => void
  ): Promise<void> {
    let admissionFailure: unknown
    return Promise.resolve()
      .then(() => {
        this.#lifecycle?.assertActive(generation)
        try {
          beforeSend?.()
        } catch (error) {
          admissionFailure = error
          throw error
        }
        return this.transport.send(value, { transfer })
      })
      .then(() => {
        this.#lifecycle?.assertActive(generation)
      })
      .then(() => undefined)
      .catch((cause) => {
        if (cause === admissionFailure && beforeSend) throw cause
        if (cause instanceof RpcAuthenticationError) throw cause
        if (cause instanceof RpcLifecycleError) throw cause
        throw new RpcTransportError(RpcCoreErrorText.transportSendFailed, cause)
      })
  }
}
