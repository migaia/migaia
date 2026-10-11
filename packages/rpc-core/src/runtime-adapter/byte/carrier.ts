import { hostRethrowReporter } from '@migaia/utils/promise'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { RpcCapability } from '@migaia/rpc-contract'
import {
  createRpcStreamFrameDecoderWithLimit,
  createRpcHandshakeFrameReceiver
} from '@migaia/rpc-contract/framing/stream'
import { encodeRpcStreamTextFrame } from '@migaia/rpc-contract/framing/stream'
import {
  RPC_STREAM_MAX_FRAME_BYTES,
  type IRpcStreamFrameDecoder
} from '@migaia/rpc-contract/framing/stream'
import { RpcCoreErrorCode } from '../../core/index.js'
import { tagRpcError } from '../../core/errors.js'
import type { IRpcTransport } from '../../core/index.js'
import {
  RpcTransportEncoding,
  RpcTransportOwnership,
  RpcTransportTopology
} from '../../core/transport-constants.js'
import { createRuntimeDiagnosticError, asRuntimeString } from './diagnostics.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type {
  IRuntimeByteIO,
  IRuntimeConnectionOptions,
  IRuntimeMessageIO,
  IRuntimeByteDiagnostics
} from './types.js'

/** Control frames use the existing bounded pre-negotiation receive size. */
export const RUNTIME_HANDSHAKE_MAX_FRAME_BYTES = 64 * 1024

/** Prevent a second adapter from installing another physical reader on the same channel. */
const boundChannels = new WeakSet<object>()

/** Bound early frames until the endpoint installs its first business subscriber. */
const MAX_EARLY_BUSINESS_FRAMES = 256
/** Bound retained UTF-8 payloads even when every early frame is individually valid. */
const MAX_EARLY_BUSINESS_BYTES = 1024 * 1024

/** A child adapter may consume bootstrap with the decoder later owned by the wire. */
export type IRuntimeByteFrameSource = Readonly<{
  decoder: IRpcStreamFrameDecoder
  attach(onFrame: (frame: Uint8Array) => void, onError: (error: Error) => void): () => void
  activate?(): void
}>

/** Registration is internal to the carrier owner and never changes the byte-port contract. */
const frameSources = new WeakMap<IRuntimeByteIO, IRuntimeByteFrameSource>()

/** Opt-in runtime bootstrap defers business subscriptions while preserving the original byte queue. */
const deferredReceivers = new WeakSet<IRuntimeByteIO>()

/** Register a cold handoff before the canonical wire claims the physical channel. */
export function deferRuntimeByteReceive(channel: IRuntimeByteIO): void {
  deferredReceivers.add(channel)
}

/** Transfer one bootstrap decoder to the ordinary handshake without replaying raw bytes. */
export function registerRuntimeByteFrameSource(
  channel: IRuntimeByteIO,
  source: IRuntimeByteFrameSource
): void {
  frameSources.set(channel, source)
}

/** One unsettled byte write is rejected promptly when its channel closes. */
type IPendingWrite = {
  settled: boolean
  reject(error: unknown): void
}

/** The physical wire stays below handshake and endpoint assembly. */
export type IRuntimeByteWire = Readonly<{
  transport: IRpcTransport
  readHandshakeFrame(): Promise<string>
  beginAccept?(): void
  activateReceive?(): void
  activate(capabilities?: readonly string[], peerId?: string): void
  writeText(value: string): Promise<void>
  close(reason?: unknown): Promise<void>
  readonly closed: boolean
}>

/** Reject duplicate ownership before subscribing to a physical channel. */
function claim(channel: object, diagnostics: IRuntimeByteDiagnostics): void {
  if (boundChannels.has(channel))
    throw tagRpcError(new TypeError(diagnostics.duplicateBinding), RpcCoreErrorCode.invalidConfig)
  boundChannels.add(channel)
}

/** Establish one byte reader and decoder, with a single pre-ready handshake frame. */
export function bindRuntimeByteWire(
  channel: IRuntimeByteIO,
  options: Pick<
    IRuntimeConnectionOptions,
    'platform' | 'expectedStringText' | 'peerId' | 'report' | 'signal'
  > &
    Readonly<{ role?: 'initiator' | 'responder' }>,
  diagnostics: IRuntimeByteDiagnostics
): IRuntimeByteWire {
  claim(channel, diagnostics)
  /** Authentication replaces a listener's pre-hello routing placeholder at activation. */
  let peerId = options.peerId
  /** The strict decoder rejects invalid UTF-8 rather than replacing bytes. */
  const receiver = createRpcHandshakeFrameReceiver(options)
  /** The byte text encoder writes UTF-8 directly behind the frame prefix. */
  const textEncoder = new TextEncoder()
  /** One small backing can be reused only after its previous physical writer completed. */
  let drainedFrame: Uint8Array | undefined
  /** Large frames remain supported; this cap bounds only the connection's retained backing. */
  const MAX_RETAINED_FRAME_BYTES = 64 * 1024
  /** Business listeners become active only after the control handshake completes. */
  const listeners = new Set<(message: { data: unknown; peerId: string }) => void>()
  /** Default byte wires never enter this additional cold subscription phase. */
  const deferred = deferredReceivers.delete(channel)
  if (deferred) receiver.deferActivation()
  /** One temporary set holds original endpoint callbacks until its provider/stream commit. */
  const pendingListeners = deferred
    ? new Set<(message: { data: unknown; peerId: string }) => void>()
    : undefined
  /** Frames received after activation wait for the first endpoint subscriber. */
  const earlyBusiness: string[] = []
  /** The queue's byte total is released with its frames on delivery or close. */
  let earlyBusinessBytes = 0
  /** Core observes the first physical terminal reason. */
  const errorListeners = new Set<(error: unknown) => void>()
  /** All writes remain owned by this connection until drain or close. */
  const pendingWrites = new Set<IPendingWrite>()
  /** Business messages may be delivered only after explicit activation. */
  let ready = false
  /** Completed negotiation alone permits synchronous invocation of the physical byte writer. */
  let batch = false
  /** Closed is monotonic and its reason is replayed to late core subscribers. */
  /** Physical retirement is monotonic even when close and abort arrive together. */
  let closed = false
  /** Late subscribers receive the same first terminal object rather than a reconstructed error. */
  let terminalError: unknown
  /** Closing shares a single physical teardown Promise. */
  /** Every close caller shares the original physical teardown settlement. */
  let closing: Promise<void> | undefined
  /** Listener removers start as no-ops because a port may invoke a callback during registration. */
  let removeData: () => void = () => undefined
  /** Physical terminal observation is released by the one connection close owner. */
  let removeClose: () => void = () => undefined
  /** Keep the exact installed abort listener for symmetric removal. */
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
    drainedFrame = undefined
    terminalError = reason ?? createRuntimeDiagnosticError(diagnostics.closed)
    decoder.close()
    receiver.close(terminalError)
    earlyBusiness.length = 0
    earlyBusinessBytes = 0
    pendingListeners?.clear()
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
        listener({ data: text, peerId })
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
      const error = createRuntimeDiagnosticError(diagnostics.closed)
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

  /** Contract owns receive grammar; Core retains the original physical error/queue boundary. */
  const onFrame = (frame: Uint8Array): void => {
    if (closed) return
    /** Role getter exceptions remain outside a catch, following the original decoder boundary. */
    const received = receiver.accept(frame)
    if (received === undefined) return
    if (typeof received !== 'string') {
      void terminate(received)
      return
    }
    if (!receiver.ready || listeners.size === 0) queueBusiness(received, frame.byteLength)
    else deliverBusiness(received)
  }
  /** A bootstrap reader can hand its existing decoder to this wire. */
  const frameSource = frameSources.get(channel)
  frameSources.delete(channel)
  const decoder =
    frameSource?.decoder ??
    createRpcStreamFrameDecoderWithLimit(
      {
        onFrame,
        onError(error) {
          void terminate(error)
        }
      },
      () => (ready ? RPC_STREAM_MAX_FRAME_BYTES : RUNTIME_HANDSHAKE_MAX_FRAME_BYTES)
    )

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
      reason === undefined ? undefined : createRuntimeDiagnosticError(diagnostics.closed, reason)
    )
  })
  /** Caller cancellation closes only this connection. */
  onAbort = (): void => {
    void terminate(
      createRuntimeDiagnosticError(
        diagnostics.closed,
        options.signal === undefined ? undefined : resolveAbortReason(options.signal)
      )
    )
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()

  /** A byte write settles on physical drain; later rejection is still observed and reported. */
  const writeText = (value: string): Promise<void> => {
    if (closed) return Promise.reject(terminalError)
    /** Taking the sole drained backing gives concurrent writes independent storage. */
    const available = drainedFrame
    drainedFrame = undefined
    /** Invalid runtime values are rejected before any physical frame is sent. */
    const bytes = encodeRpcStreamTextFrame(
      asRuntimeString(value, options.expectedStringText),
      textEncoder,
      available
    )
    /** Actual write settlement is the sole release point, including late settlement after close. */
    const releaseFrame = (): void => {
      if (
        !closed &&
        drainedFrame === undefined &&
        bytes.buffer.byteLength <= MAX_RETAINED_FRAME_BYTES
      )
        drainedFrame = new Uint8Array(bytes.buffer)
    }
    return new Promise<void>((resolve, reject) => {
      /** The record lets close reject even if a physical writer never drains. */
      const pending: IPendingWrite = { settled: false, reject }
      pendingWrites.add(pending)
      /** Negotiated grouping preserves FIFO by the actual synchronous writer invocation. */
      const invoke = () => {
        if (closed) throw terminalError
        return channel.write(bytes)
      }
      let result: void | Promise<void>
      if (batch) {
        try {
          result = invoke()
        } catch (error) {
          result = Promise.reject(error)
        }
      } else result = Promise.resolve().then(invoke)
      void Promise.resolve(result).then(
        () => {
          releaseFrame()
          pendingWrites.delete(pending)
          if (pending.settled) return
          pending.settled = true
          resolve()
        },
        (error: unknown) => {
          releaseFrame()
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
    platform: options.platform,
    topology: RpcTransportTopology.exclusive,
    ownership: RpcTransportOwnership.owned,
    encodedType: RpcTransportEncoding.string,
    get peerId() {
      return peerId
    },
    send: (value) => writeText(asRuntimeString(value, options.expectedStringText)),
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

  /** Activation restores the exact existing subscribe function, leaving no hot receive wrapper. */
  let activateReceive: (() => void) | undefined
  if (pendingListeners) {
    /** Preserve the canonical transport subscription rather than permanently wrapping dispatch. */
    const subscribe = transport.subscribe
    transport.subscribe = (listener) => {
      pendingListeners.add(listener)
      return () => {
        pendingListeners.delete(listener)
        listeners.delete(listener)
      }
    }
    activateReceive = () => {
      if (closed) throw terminalError
      transport.subscribe = subscribe
      for (const listener of pendingListeners) listeners.add(listener)
      pendingListeners.clear()
      flushBusiness()
    }
  }

  return Object.freeze({
    transport,
    ...(activateReceive
      ? {
          activateReceive,
          /** Called only after authentication, immediately before writing the responder accept. */
          beginAccept() {
            if (closed) throw terminalError
            receiver.beginAccept()
          }
        }
      : {}),
    readHandshakeFrame: () => receiver.readHandshakeFrame(),
    activate(capabilities, acceptedPeerId) {
      if (closed) throw terminalError
      receiver.activate()
      if (acceptedPeerId !== undefined) peerId = acceptedPeerId
      ready = true
      batch = capabilities?.includes(RpcCapability.batch) === true
      frameSource?.activate?.()
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
export function bindRuntimeMessageTransport(
  channel: IRuntimeMessageIO,
  options: Pick<
    IRuntimeConnectionOptions,
    'platform' | 'expectedStringText' | 'peerId' | 'report' | 'signal'
  >,
  diagnostics: IRuntimeByteDiagnostics
): IRpcTransport {
  claim(channel, diagnostics)
  /** Message listeners are scoped to this single physical channel. */
  const listeners = new Set<(message: { data: unknown; peerId: string }) => void>()
  /** A closed channel replays the terminal error to late core subscribers. */
  const errorListeners = new Set<(error: unknown) => void>()
  /** Physical retirement is monotonic even when close and abort arrive together. */
  let closed = false
  /** Late subscribers receive the same first terminal object rather than a reconstructed error. */
  let terminalError: unknown
  /** Every close caller shares the original physical teardown settlement. */
  let closing: Promise<void> | undefined
  /** Close releases both listener registrations before the underlying port. */
  const close = (reason?: unknown): Promise<void> => {
    if (closing) return closing
    closed = true
    terminalError = reason ?? createRuntimeDiagnosticError(diagnostics.closed)
    for (const listener of errorListeners) listener(terminalError)
    closing = (async () => {
      removeMessage()
      removeClose()
      options.signal?.removeEventListener('abort', onAbort)
      await channel.close()
    })()
    return closing
  }
  /** This adapter owns exactly one physical whole-message subscription. */
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
  /** Observe physical terminal once, independently of business listener registration. */
  const removeClose = channel.onClose((reason) => {
    void close(
      reason === undefined ? undefined : createRuntimeDiagnosticError(diagnostics.closed, reason)
    )
  })
  /** Cancellation retains the original signal reason on this connection only. */
  const onAbort = (): void => {
    void close(
      createRuntimeDiagnosticError(
        diagnostics.closed,
        options.signal === undefined ? undefined : resolveAbortReason(options.signal)
      )
    )
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()
  return {
    platform: options.platform,
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
