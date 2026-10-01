import { createContractError } from '../contract/contract-error.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { RpcContractErrorCode } from '../contract/error-code.js'
import { createRpcStreamFrameDecoder, encodeRpcStreamFrame } from '../contract/framing/stream.js'
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

/** Establish one byte reader and decoder, with a single pre-ready handshake frame. */
export function bindProcessByteWire(
  channel: IProcessByteChannel,
  options: Pick<IProcessCommonOptions, 'peerId' | 'report' | 'signal'>
): IProcessByteWire {
  claim(channel)
  /** The strict decoder rejects invalid UTF-8 rather than replacing bytes. */
  const textDecoder = new TextDecoder('utf-8', { fatal: true })
  /** Frame writes each allocate one prefix plus UTF-8 payload. */
  const textEncoder = new TextEncoder()
  /** Business listeners become active only after the control handshake completes. */
  const listeners = new Set<(message: { data: unknown; peerId: string }) => void>()
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

  /** Each complete byte payload is an independent UTF-8 text message. */
  const decoder = createRpcStreamFrameDecoder({
    onFrame(frame) {
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
          void terminate(createContractError(RpcContractErrorCode.handshakeInvalid))
          return
        }
        handshakeReceived = true
        if (handshakeWaiter) {
          handshakeWaiter.resolve(text)
          handshakeWaiter = undefined
        } else handshakeFrame = text
        return
      }
      for (const listener of listeners) {
        try {
          listener({ data: text, peerId: options.peerId })
        } catch (error) {
          report(error)
        }
      }
    },
    onError(error) {
      void terminate(error)
    }
  })

  /** One data subscription owns the decoder for this physical channel. */
  removeData = channel.onData((chunk) => {
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
