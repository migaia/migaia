import { createContractError } from '../contract/contract-error.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { RpcContractErrorCode } from '../contract/error-code.js'
import { RpcHandshakeStep, RpcReservedKind } from '../contract/wire-constants.js'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame,
  type IRpcStreamFrameDecoder
} from '../contract/framing/stream.js'
import { RpcCoreErrorCode, tagRpcError } from '../core/errors.js'
import type { IRpcTransport } from '../core/transport.js'
import {
  RpcPlatform,
  RpcTransportEncoding,
  RpcTransportOwnership,
  RpcTransportTopology
} from '../core/transport-constants.js'
import { RpcProcessErrorCode } from './error-code.js'
import { createProcessError } from './error.js'
import { RpcProcessErrorText } from './error-text.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { asProcessString } from './string-framer.js'
import type { IProcessByteChannel, IProcessCommonOptions, IProcessMessageChannel } from './types.js'

/** Prevent a second adapter from installing another physical reader on the same channel. */
const boundChannels = new WeakSet<object>()

/** Bound early frames until the endpoint installs its first business subscriber. */
const MAX_EARLY_BUSINESS_FRAMES = 256
/** Bound retained UTF-8 payloads even when every early frame is individually valid. */
const MAX_EARLY_BUSINESS_BYTES = 1024 * 1024

/** A child adapter may consume bootstrap with the decoder later owned by the wire. */
export type IProcessFrameSource = Readonly<{
  decoder: IRpcStreamFrameDecoder
  attach(onFrame: (frame: Uint8Array) => void, onError: (error: Error) => void): () => void
}>

/** Registration is internal to the process package and never changes the byte-port contract. */
const frameSources = new WeakMap<IProcessByteChannel, IProcessFrameSource>()

/** Transfer one bootstrap decoder to the ordinary handshake without replaying raw bytes. */
export function registerProcessFrameSource(
  channel: IProcessByteChannel,
  source: IProcessFrameSource
): void {
  frameSources.set(channel, source)
}

/** One unsettled byte write is rejected promptly when its channel closes. */
type IPendingWrite = {
  settled: boolean
  reject(error: unknown): void
}

/** The physical wire stays below handshake and endpoint assembly. */
export type IProcessByteWire = Readonly<{
  transport: IRpcTransport
  readHandshakeFrame(): Promise<string>
  activate(): void
  writeText(value: string): Promise<void>
  close(reason?: unknown): Promise<void>
  readonly closed: boolean
}>

/** Reject duplicate ownership before subscribing to a physical channel. */
function claim(channel: object): void {
  if (boundChannels.has(channel))
    throw tagRpcError(
      new TypeError(RpcProcessErrorText.duplicateBinding),
      RpcCoreErrorCode.invalidConfig
    )
  boundChannels.add(channel)
}

/** Classify a control frame without leaking parser diagnostics or its contents. */
function isHandshakeControl(text: string, step?: RpcHandshakeStep): boolean {
  try {
    const value: unknown = JSON.parse(text)
    return (
      value !== null &&
      typeof value === 'object' &&
      'kind' in value &&
      value.kind === RpcReservedKind.handshake &&
      (step === undefined || ('step' in value && value.step === step))
    )
  } catch {
    return false
  }
}

/** Establish one byte reader and decoder, with a single pre-ready handshake frame. */
export function bindProcessByteWire(
  channel: IProcessByteChannel,
  options: Pick<IProcessCommonOptions, 'peerId' | 'report' | 'signal'> &
    Readonly<{ role?: 'initiator' | 'responder' }>
): IProcessByteWire {
  claim(channel)
  /** The strict decoder rejects invalid UTF-8 rather than replacing bytes. */
  const textDecoder = new TextDecoder('utf-8', { fatal: true })
  /** Frame writes each allocate one prefix plus UTF-8 payload. */
  const textEncoder = new TextEncoder()
  /** Business listeners become active only after the control handshake completes. */
  const listeners = new Set<(message: { data: unknown; peerId: string }) => void>()
  /** Frames received after activation wait for the first endpoint subscriber. */
  const earlyBusiness: string[] = []
  /** The queue's byte total is released with its frames on delivery or close. */
  let earlyBusinessBytes = 0
  /** Core observes the first physical terminal reason. */
  const errorListeners = new Set<(error: unknown) => void>()
  /** All writes remain owned by this connection until drain or close. */
  const pendingWrites = new Set<IPendingWrite>()
  /** Exactly one control frame is retained before ready. */
  let handshakeFrame: string | undefined
  /** A pending handshake reader is settled on the first control frame or close. */
  let handshakeWaiter:
    | Readonly<{ resolve(frame: string): void; reject(error: unknown): void }>
    | undefined
  /** A second handshake frame before ready is a protocol failure. */
  let handshakeReceived = false
  /** Only a validly shaped accept permits initiator business frames before activation. */
  let acceptReceived = false
  /** Business messages may be delivered only after explicit activation. */
  let ready = false
  /** Closed is monotonic and its reason is replayed to late core subscribers. */
  let closed = false
  let terminalError: unknown
  /** Closing shares a single physical teardown Promise. */
  let closing: Promise<void> | undefined
  /** Listener removers start as no-ops because a port may invoke a callback during registration. */
  let removeData: () => void = () => undefined
  let removeClose: () => void = () => undefined
  let onAbort: () => void = () => undefined

  /** Report callback failures without changing the channel's primary failure. */
  const report = (error: unknown): void => {
    try {
      options.report(error)
    } catch (reporterError) {
      hostRethrowReporter(reporterError, IpcReporterContext)
    }
  }

  /** Notify the single transport boundary and reject pending connection work. */
  const terminate = (reason?: unknown): Promise<void> => {
    if (closing) return closing
    closed = true
    terminalError = reason ?? createProcessError(RpcProcessErrorCode.channelClosed)
    decoder.close()
    handshakeWaiter?.reject(terminalError)
    handshakeWaiter = undefined
    handshakeFrame = undefined
    earlyBusiness.length = 0
    earlyBusinessBytes = 0
    for (const write of pendingWrites) {
      write.settled = true
      write.reject(terminalError)
    }
    pendingWrites.clear()
    for (const listener of errorListeners) {
      try {
        listener(terminalError)
      } catch (error) {
        report(error)
      }
    }
    closing = (async () => {
      removeData()
      removeClose()
      options.signal?.removeEventListener('abort', onAbort)
      await channel.close()
    })()
    return closing
  }

  /** Deliver one frame to current subscribers while isolating callback failures. */
  const deliverBusiness = (text: string): void => {
    for (const listener of listeners) {
      try {
        listener({ data: text, peerId: options.peerId })
      } catch (error) {
        report(error)
      }
    }
  }

  /** Retain a bounded early frame; overflow is a reported connection failure. */
  const queueBusiness = (text: string, bytes: number): void => {
    if (
      earlyBusiness.length === MAX_EARLY_BUSINESS_FRAMES ||
      earlyBusinessBytes + bytes > MAX_EARLY_BUSINESS_BYTES
    ) {
      const error = createProcessError(RpcProcessErrorCode.channelClosed)
      report(error)
      void terminate(error)
      return
    }
    earlyBusiness.push(text)
    earlyBusinessBytes += bytes
  }

  /** Release queued frames only after both handshake activation and subscription. */
  const flushBusiness = (): void => {
    if (!ready || closed || listeners.size === 0 || earlyBusiness.length === 0) return
    /** Clear before callbacks so reentrant subscriptions cannot replay frames. */
    const queued = earlyBusiness.splice(0)
    earlyBusinessBytes = 0
    for (const text of queued) {
      if (closed) break
      deliverBusiness(text)
    }
  }

  /** Each complete byte payload is an independent UTF-8 text message. */
  const onFrame = (frame: Uint8Array): void => {
    if (closed) return
    let text: string
    try {
      text = textDecoder.decode(frame)
    } catch {
      void terminate(
        createContractError(
          ready ? RpcContractErrorCode.invalidFrame : RpcContractErrorCode.handshakeInvalid
        )
      )
      return
    }
    if (!ready) {
      if (handshakeReceived) {
        if (options.role === 'initiator' && acceptReceived && !isHandshakeControl(text)) {
          queueBusiness(text, frame.byteLength)
          return
        }
        void terminate(createContractError(RpcContractErrorCode.handshakeInvalid))
        return
      }
      handshakeReceived = true
      acceptReceived =
        options.role === 'initiator' && isHandshakeControl(text, RpcHandshakeStep.accept)
      if (handshakeWaiter) {
        handshakeWaiter.resolve(text)
        handshakeWaiter = undefined
      } else handshakeFrame = text
      return
    }
    if (listeners.size === 0) queueBusiness(text, frame.byteLength)
    else deliverBusiness(text)
  }
  /** A bootstrap reader can hand its existing decoder to this wire. */
  const frameSource = frameSources.get(channel)
  frameSources.delete(channel)
  const decoder =
    frameSource?.decoder ??
    createRpcStreamFrameDecoder({
      onFrame,
      onError(error) {
        void terminate(error)
      }
    })

  /** One data subscription owns the decoder for this physical channel. */
  removeData = frameSource
    ? frameSource.attach(onFrame, (error) => {
        void terminate(error)
      })
    : channel.onData((chunk) => {
        if (closed) return
        try {
          decoder.push(chunk)
        } catch (error) {
          void terminate(error)
        }
      })
  /** Underlying close completes the decoder's EOF check before terminal replay. */
  removeClose = channel.onClose((reason) => {
    if (closed) return
    decoder.finish()
    void terminate(
      reason === undefined
        ? undefined
        : createProcessError(RpcProcessErrorCode.channelClosed, reason)
    )
  })
  /** Caller cancellation closes only this connection. */
  onAbort = (): void => {
    void terminate(
      createProcessError(
        RpcProcessErrorCode.channelClosed,
        options.signal === undefined ? undefined : resolveAbortReason(options.signal)
      )
    )
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()

  /** A byte write settles on physical drain; later rejection is still observed and reported. */
  const writeText = (value: string): Promise<void> => {
    if (closed) return Promise.reject(terminalError)
    /** Invalid runtime values are rejected before any physical frame is sent. */
    const bytes = encodeRpcStreamFrame(textEncoder.encode(asProcessString(value)))
    return new Promise<void>((resolve, reject) => {
      /** The record lets close reject even if a physical writer never drains. */
      const pending: IPendingWrite = { settled: false, reject }
      pendingWrites.add(pending)
      void Promise.resolve()
        .then(() => {
          if (closed) throw terminalError
          return channel.write(bytes)
        })
        .then(
          () => {
            pendingWrites.delete(pending)
            if (pending.settled) return
            pending.settled = true
            resolve()
          },
          (error: unknown) => {
            pendingWrites.delete(pending)
            if (pending.settled) {
              report(error)
              return
            }
            pending.settled = true
            reject(error)
          }
        )
    })
  }

  /** Core sees only business frames and no raw handshake bytes. */
  const transport: IRpcTransport = {
    platform: RpcPlatform.process,
    topology: RpcTransportTopology.exclusive,
    ownership: RpcTransportOwnership.owned,
    encodedType: RpcTransportEncoding.string,
    peerId: options.peerId,
    send: (value) => writeText(asProcessString(value)),
    subscribe(listener) {
      listeners.add(listener)
      flushBusiness()
      return () => {
        listeners.delete(listener)
      }
    },
    onTransportError(listener) {
      errorListeners.add(listener)
      if (closed) listener(terminalError)
      return () => {
        errorListeners.delete(listener)
      }
    },
    close: () => terminate(),
    get closed() {
      return closed
    }
  }

  return Object.freeze({
    transport,
    readHandshakeFrame() {
      if (closed) return Promise.reject(terminalError)
      if (handshakeFrame !== undefined) {
        /** Clearing before return prevents a second read of the same control frame. */
        const frame = handshakeFrame
        handshakeFrame = undefined
        return Promise.resolve(frame)
      }
      if (handshakeWaiter || handshakeReceived)
        return Promise.reject(createContractError(RpcContractErrorCode.handshakeInvalid))
      return new Promise<string>((resolve, reject) => {
        handshakeWaiter = { resolve, reject }
      })
    },
    activate() {
      if (closed) throw terminalError
      if (!handshakeReceived) throw createContractError(RpcContractErrorCode.handshakeInvalid)
      ready = true
      flushBusiness()
    },
    writeText,
    close: terminate,
    get closed() {
      return closed
    }
  })
}

/** Message channels keep their existing whole-message boundary and static codec. */
export function bindProcessMessageTransport(
  channel: IProcessMessageChannel,
  options: Pick<IProcessCommonOptions, 'peerId' | 'report' | 'signal'>
): IRpcTransport {
  claim(channel)
  /** Message listeners are scoped to this single physical channel. */
  const listeners = new Set<(message: { data: unknown; peerId: string }) => void>()
  /** A closed channel replays the terminal error to late core subscribers. */
  const errorListeners = new Set<(error: unknown) => void>()
  let closed = false
  let terminalError: unknown
  let closing: Promise<void> | undefined
  /** Close releases both listener registrations before the underlying port. */
  const close = (reason?: unknown): Promise<void> => {
    if (closing) return closing
    closed = true
    terminalError = reason ?? createProcessError(RpcProcessErrorCode.channelClosed)
    for (const listener of errorListeners) listener(terminalError)
    closing = (async () => {
      removeMessage()
      removeClose()
      options.signal?.removeEventListener('abort', onAbort)
      await channel.close()
    })()
    return closing
  }
  const removeMessage = channel.onMessage((data) => {
    if (closed) return
    for (const listener of listeners) {
      try {
        listener({ data, peerId: options.peerId })
      } catch (error) {
        options.report(error)
      }
    }
  })
  const removeClose = channel.onClose((reason) => {
    void close(
      reason === undefined
        ? undefined
        : createProcessError(RpcProcessErrorCode.channelClosed, reason)
    )
  })
  const onAbort = (): void => {
    void close(
      createProcessError(
        RpcProcessErrorCode.channelClosed,
        options.signal === undefined ? undefined : resolveAbortReason(options.signal)
      )
    )
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()
  return {
    platform: RpcPlatform.process,
    topology: RpcTransportTopology.exclusive,
    ownership: RpcTransportOwnership.owned,
    encodedType: RpcTransportEncoding.any,
    peerId: options.peerId,
    send(value) {
      if (closed) return Promise.reject(terminalError)
      return channel.send(value)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onTransportError(listener) {
      errorListeners.add(listener)
      if (closed) listener(terminalError)
      return () => {
        errorListeners.delete(listener)
      }
    },
    close,
    get closed() {
      return closed
    }
  }
}
