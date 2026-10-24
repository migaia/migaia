import { deferred, hostRethrowReporter } from '@migaia/utils/promise'
import { createDisposeTransaction, DisposeTransactionKind } from '@migaia/lifecycle'
import { drainListenerFailures } from '../../core/internal/listener-safety.js'
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
import { RpcCoreErrorCode } from '../../core/errors.js'
import { tagRpcError } from '../../core/errors.js'
import { createRpcTransportError } from '../../core/errors.js'
import { RpcAdapterErrorText } from '../../core/adapters/error-text.js'
import { RpcCarrierDetailKey } from '../../core/adapters/probe-detail.js'
import { carrierSizeBytes } from '../../core/adapters/probe-content.js'
import { RpcProbeDirection } from '../../core/probe/constants.js'
import type { IRpcCarrierProbe } from '../../core/probe/types.js'
import type { IRpcTransport } from '../../core/transport.js'
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
function claim(
  channel: object,
  diagnostics: Pick<IRuntimeByteDiagnostics, 'duplicateBinding'>
): void {
  if (boundChannels.has(channel))
    throw tagRpcError(new TypeError(diagnostics.duplicateBinding), RpcCoreErrorCode.invalidConfig)
  boundChannels.add(channel)
}

/** Establish one byte reader and decoder, with a single pre-ready handshake frame. */
class RuntimeByteWire {
  /** Original channel resource retained by this single adapter owner. */
  #channel: IRuntimeByteIO

  /** Original options resource retained by this single adapter owner. */
  #options: Pick<
    IRuntimeConnectionOptions,
    'platform' | 'expectedStringText' | 'peerId' | 'report' | 'signal'
  > &
    Readonly<{ role?: 'initiator' | 'responder' }>

  /** Original diagnostics resource retained by this single adapter owner. */
  #diagnostics: IRuntimeByteDiagnostics

  /** Authentication replaces a listener's pre-hello routing placeholder at activation. */
  #peerId

  /** The strict decoder rejects invalid UTF-8 rather than replacing bytes. */
  #receiver

  /** The byte text encoder writes UTF-8 directly behind the frame prefix. */
  #textEncoder

  /** One small backing can be reused only after its previous physical writer completed. */
  #drainedFrame: Uint8Array | undefined

  /** Large frames remain supported; this cap bounds only the connection's retained backing. */
  #MAX_RETAINED_FRAME_BYTES

  /** Business listeners become active only after the control handshake completes. */
  #listeners

  /** Default byte wires never enter this additional cold subscription phase. */
  #deferred

  /** One temporary set holds original endpoint callbacks until its provider/stream commit. */
  #pendingListeners

  /** Existing startup FIFO uses text/frame pairs, retaining the original physical span without rows. */
  #earlyBusiness: (string | Uint8Array)[]

  /** The queue's byte total is released with its frames on delivery or close. */
  #earlyBusinessBytes

  /** Core observes the first physical terminal reason. */
  #errorListeners

  /** All writes remain owned by this connection until drain or close. */
  #pendingWrites

  /** Business messages may be delivered only after explicit activation. */
  #ready

  /** Completed negotiation alone permits synchronous invocation of the physical byte writer. */
  #batch

  /** Closed is monotonic and its reason is replayed to late core subscribers. */
  /** Physical retirement is monotonic even when close and abort arrive together. */
  #closed

  /** The byte carrier owns one observation installation and its raw writer subscription. */
  #probe: IRpcCarrierProbe | undefined

  /** Each installation owns its disposer even when the same probe object is reused. */
  #probeGeneration

  /**
   * The canonical raw writer reports actual drain while this carrier retains installation
   * ownership.
   */
  #removeWrite: (() => void) | undefined

  /** Borrowed direction-local details avoid allocating an object for each physical observation. */
  #outboundDetail

  /** Receive facts are independent from an outstanding outbound native drain. */
  #inboundDetail

  /** Late subscribers receive the same first terminal object rather than a reconstructed error. */
  #terminalError: unknown

  /** Closing shares a single physical teardown Promise. */
  /** Every close caller shares the original physical teardown settlement. */
  #closing: Promise<void> | undefined

  /** Listener removers start as no-ops because a port may invoke a callback during registration. */
  #removeData: () => void = () => undefined

  /** Physical terminal observation is released by the one connection close owner. */
  #removeClose: () => void = () => undefined

  /** Keep the exact installed abort listener for symmetric removal. */
  #onAbort: () => void = () => undefined

  /** Report callback failures without changing the channel's primary failure. */
  #report = (error: unknown): void => {
    try {
      this.#options.report(error)
    } catch (reporterError) {
      hostRethrowReporter(reporterError, IpcReporterContext)
    }
  }

  /** Known frame bytes and native drain facts enter the same carrier callback without re-encoding. */
  #observeFrame = (direction: number, frame: Uint8Array, drainMs: number): void => {
    if (this.#probe === undefined || this.#closed) return
    /** A consumer must explicitly snapshot these borrowed details before retaining their values. */
    const detail =
      direction === RpcProbeDirection.outbound ? this.#outboundDetail : this.#inboundDetail
    detail[RpcCarrierDetailKey.frameBytes] = frame.byteLength
    detail[RpcCarrierDetailKey.drainMs] = drainMs
    try {
      this.#probe.emit(
        direction,
        frame.byteLength,
        this.#options.platform,
        detail,
        this.#probe.capturing ? frame : undefined
      )
    } catch (cause) {
      this.#report(createRpcTransportError(RpcAdapterErrorText.probeFailed, cause))
    }
  }

  /** Native settlement updates the borrowed detail without a second asynchronous carrier event. */
  #observeWrite = (_frame: Uint8Array, drainMs: number): void => {
    if (this.#probe !== undefined && !this.#closed)
      this.#outboundDetail[RpcCarrierDetailKey.drainMs] = drainMs
  }

  /** Notify the single transport boundary and reject pending connection work. */
  #terminate = (reason?: unknown): Promise<void> => {
    if (this.#closing) return this.#closing
    this.#closed = true
    this.#probe = undefined
    this.#removeWrite?.()
    this.#removeWrite = undefined
    this.#drainedFrame = undefined
    this.#terminalError = reason ?? createRuntimeDiagnosticError(this.#diagnostics.closed)
    this.#decoder.close()
    this.#receiver.close(this.#terminalError)
    this.#earlyBusiness.length = 0
    this.#earlyBusinessBytes = 0
    this.#pendingListeners?.clear()
    for (const write of this.#pendingWrites) {
      write.settled = true
      write.reject(this.#terminalError)
    }
    this.#pendingWrites.clear()
    for (const listener of this.#errorListeners) {
      try {
        listener(this.#terminalError)
      } catch (error) {
        this.#report(error)
      }
    }
    this.#closing = (async () => {
      this.#removeData()
      this.#removeClose()
      this.#options.signal?.removeEventListener('abort', this.#onAbort)
      await this.#channel.close()
    })()
    return this.#closing
  }

  /** Deliver one frame to current subscribers while isolating callback failures. */
  #deliverBusiness = (text: string, frame: Uint8Array): void => {
    /** This transport receive boundary keeps its carrier sequence adjacent to the Core callback. */
    if (this.#probe !== undefined) this.#observeFrame(RpcProbeDirection.inbound, frame, 0)
    if (this.#closed) return
    for (const listener of this.#listeners) {
      try {
        listener({ data: text, peerId: this.#peerId })
      } catch (error) {
        this.#report(error)
      }
    }
  }

  /** Retain a bounded early frame; overflow is a reported connection failure. */
  #queueBusiness = (text: string, frame: Uint8Array): void => {
    if (
      this.#earlyBusiness.length === MAX_EARLY_BUSINESS_FRAMES * 2 ||
      this.#earlyBusinessBytes + frame.byteLength > MAX_EARLY_BUSINESS_BYTES
    ) {
      const error = createRuntimeDiagnosticError(this.#diagnostics.closed)
      this.#report(error)
      void this.#terminate(error)
      return
    }
    this.#earlyBusiness.push(text, frame)
    this.#earlyBusinessBytes += frame.byteLength
  }

  /** Release queued frames only after both handshake activation and subscription. */
  #flushBusiness = (): void => {
    if (
      !this.#ready ||
      this.#closed ||
      this.#listeners.size === 0 ||
      this.#earlyBusiness.length === 0
    )
      return
    /** Clear before callbacks so reentrant subscriptions cannot replay frames. */
    const queued = this.#earlyBusiness.splice(0)
    this.#earlyBusinessBytes = 0
    for (let index = 0; index < queued.length; index += 2) {
      if (this.#closed) break
      this.#deliverBusiness(queued[index] as string, queued[index + 1] as Uint8Array)
    }
  }

  /** Contract owns receive grammar; Core retains the original physical error/queue boundary. */
  #onFrame = (frame: Uint8Array): void => {
    if (this.#closed) return
    /** Role getter exceptions remain outside a catch, following the original decoder boundary. */
    const received = this.#receiver.accept(frame)
    if (received === undefined) {
      if (this.#probe !== undefined) this.#observeFrame(RpcProbeDirection.inbound, frame, 0)
      return
    }
    if (typeof received !== 'string') {
      if (this.#probe !== undefined) this.#observeFrame(RpcProbeDirection.inbound, frame, 0)
      void this.#terminate(received)
      return
    }
    if (!this.#receiver.ready || this.#listeners.size === 0) this.#queueBusiness(received, frame)
    else this.#deliverBusiness(received, frame)
  }

  /** A bootstrap reader can hand its existing decoder to this wire. */
  #frameSource

  #decoder

  /** A byte write settles on physical drain; later rejection is still observed and reported. */
  #writeText = (value: string): Promise<void> => {
    if (this.#closed) return Promise.reject(this.#terminalError)
    /** Taking the sole drained backing gives concurrent writes independent storage. */
    const available = this.#drainedFrame
    this.#drainedFrame = undefined
    /** Invalid runtime values are rejected before any physical frame is sent. */
    const bytes = encodeRpcStreamTextFrame(
      asRuntimeString(value, this.#options.expectedStringText),
      this.#textEncoder,
      available
    )
    /** Emit before returning, while Core's original synchronous send context remains borrowed. */
    if (this.#probe !== undefined) this.#observeFrame(RpcProbeDirection.outbound, bytes, -1)
    /** Actual write settlement is the sole release point, including late settlement after close. */
    const releaseFrame = (): void => {
      if (
        !this.#closed &&
        this.#drainedFrame === undefined &&
        bytes.buffer.byteLength <= this.#MAX_RETAINED_FRAME_BYTES
      )
        this.#drainedFrame = new Uint8Array(bytes.buffer)
    }
    return new Promise<void>((resolve, reject) => {
      /** The record lets close reject even if a physical writer never drains. */
      const pending: IPendingWrite = { settled: false, reject }
      this.#pendingWrites.add(pending)
      /** Negotiated grouping preserves FIFO by the actual synchronous writer invocation. */
      const invoke = () => {
        if (this.#closed) throw this.#terminalError
        return this.#channel.write(bytes)
      }
      let result: void | Promise<void>
      if (this.#batch) {
        try {
          result = invoke()
        } catch (error) {
          result = Promise.reject(error)
        }
      } else result = Promise.resolve().then(invoke)
      void Promise.resolve(result).then(
        () => {
          releaseFrame()
          this.#pendingWrites.delete(pending)
          if (pending.settled) return
          pending.settled = true
          resolve()
        },
        (error: unknown) => {
          releaseFrame()
          this.#pendingWrites.delete(pending)
          if (pending.settled) {
            this.#report(error)
            return
          }
          pending.settled = true
          reject(error)
        }
      )
    })
  }

  /** Core sees only business frames and no raw handshake bytes. */
  #transport: IRpcTransport

  /** Activation restores the exact existing subscribe function, leaving no hot receive wrapper. */
  #activateReceive: (() => void) | undefined

  /** Frozen operation surface keeps the original transport/resource identity. */
  readonly value: IRuntimeByteWire
  /** Acquire resources and install native observers in the original construction order. */
  constructor(
    channel: IRuntimeByteIO,
    options: Pick<
      IRuntimeConnectionOptions,
      'platform' | 'expectedStringText' | 'peerId' | 'report' | 'signal'
    > &
      Readonly<{ role?: 'initiator' | 'responder' }>,
    diagnostics: IRuntimeByteDiagnostics
  ) {
    this.#channel = channel
    this.#options = options
    this.#diagnostics = diagnostics

    claim(this.#channel, this.#diagnostics)
    this.#peerId = this.#options.peerId
    this.#receiver = createRpcHandshakeFrameReceiver(this.#options)
    this.#textEncoder = new TextEncoder()
    this.#MAX_RETAINED_FRAME_BYTES = 64 * 1024
    this.#listeners = new Set<(message: { data: unknown; peerId: string }) => void>()
    this.#deferred = deferredReceivers.delete(this.#channel)

    if (this.#deferred) this.#receiver.deferActivation()
    this.#pendingListeners = this.#deferred
      ? new Set<(message: { data: unknown; peerId: string }) => void>()
      : undefined
    this.#earlyBusiness = []
    this.#earlyBusinessBytes = 0
    this.#errorListeners = new Set<(error: unknown) => void>()
    this.#pendingWrites = new Set<IPendingWrite>()
    this.#ready = false
    this.#batch = false
    this.#closed = false
    this.#probeGeneration = 0
    this.#outboundDetail = {
      [RpcCarrierDetailKey.frameBytes]: 0,
      [RpcCarrierDetailKey.drainMs]: -1
    }
    this.#inboundDetail = { [RpcCarrierDetailKey.frameBytes]: 0, [RpcCarrierDetailKey.drainMs]: 0 }
    this.#frameSource = frameSources.get(this.#channel)

    frameSources.delete(this.#channel)
    this.#decoder =
      this.#frameSource?.decoder ??
      createRpcStreamFrameDecoderWithLimit(
        {
          onFrame: this.#onFrame,
          onError: (error) => {
            void this.#terminate(error)
          }
        },
        () => (this.#ready ? RPC_STREAM_MAX_FRAME_BYTES : RUNTIME_HANDSHAKE_MAX_FRAME_BYTES)
      )

    this.#attach()
    this.#transport = RuntimeByteWire.#createTransport(this)

    this.#prepareReceive()
    this.value = RuntimeByteWire.#createWire(this)
  }
  /** Install the sole byte reader, terminal observer and abort hook in their original order. */
  #attach(): void {
    /** One data subscription owns the decoder for this physical channel. */
    this.#removeData = this.#frameSource
      ? this.#frameSource.attach(this.#onFrame, (error) => {
          void this.#terminate(error)
        })
      : this.#channel.onData((chunk) => {
          if (this.#closed) return
          try {
            this.#decoder.push(chunk)
          } catch (error) {
            void this.#terminate(error)
          }
        })

    /** Underlying close completes the decoder's EOF check before terminal replay. */
    this.#removeClose = this.#channel.onClose((reason) => {
      if (this.#closed) return
      this.#decoder.finish()
      void this.#terminate(
        reason === undefined
          ? undefined
          : createRuntimeDiagnosticError(this.#diagnostics.closed, reason)
      )
    })

    /** Caller cancellation closes only this connection. */
    this.#onAbort = (): void => {
      void this.#terminate(
        createRuntimeDiagnosticError(
          this.#diagnostics.closed,
          this.#options.signal === undefined ? undefined : resolveAbortReason(this.#options.signal)
        )
      )
    }

    this.#options.signal?.addEventListener('abort', this.#onAbort, { once: true })

    if (this.#options.signal?.aborted) this.#onAbort()
  }

  /** Construct the same operation view while native lifetime stays with this owner. */
  static #createTransport(owner: RuntimeByteWire): IRpcTransport {
    return {
      platform: owner.#options.platform,
      topology: RpcTransportTopology.exclusive,
      ownership: RpcTransportOwnership.owned,
      encodedType: RpcTransportEncoding.string,
      observe(next) {
        /** Generation fences old disposers and pending native backpressure observations. */
        const generation = ++owner.#probeGeneration
        owner.#removeWrite?.()
        if (!owner.#closed) {
          owner.#probe = next
          owner.#removeWrite = owner.#channel.onWrite?.(owner.#observeWrite)
        }
        return () => {
          if (generation !== owner.#probeGeneration) return
          owner.#probe = undefined
          owner.#removeWrite?.()
          owner.#removeWrite = undefined
        }
      },
      get peerId() {
        return owner.#peerId
      },
      send: (value) => owner.#writeText(asRuntimeString(value, owner.#options.expectedStringText)),
      subscribe(listener) {
        owner.#listeners.add(listener)
        owner.#flushBusiness()
        return () => {
          owner.#listeners.delete(listener)
        }
      },
      onTransportError(listener) {
        owner.#errorListeners.add(listener)
        if (owner.#closed) listener(owner.#terminalError)
        return () => {
          owner.#errorListeners.delete(listener)
        }
      },
      close: () => owner.#terminate(),
      get closed() {
        return owner.#closed
      }
    }
  }

  /** Construct the same operation view while native lifetime stays with this owner. */
  static #createWire(owner: RuntimeByteWire): IRuntimeByteWire {
    return Object.freeze({
      transport: owner.#transport,
      ...(owner.#activateReceive
        ? {
            activateReceive: owner.#activateReceive,
            /** Called only after authentication, immediately before writing the responder accept. */
            beginAccept() {
              if (owner.#closed) throw owner.#terminalError
              owner.#receiver.beginAccept()
            }
          }
        : {}),
      readHandshakeFrame: () => owner.#receiver.readHandshakeFrame(),
      activate(capabilities, acceptedPeerId) {
        if (owner.#closed) throw owner.#terminalError
        owner.#receiver.activate()
        if (acceptedPeerId !== undefined) owner.#peerId = acceptedPeerId
        owner.#ready = true
        owner.#batch = capabilities?.includes(RpcCapability.batch) === true
        owner.#frameSource?.activate?.()
        owner.#flushBusiness()
      },
      writeText: owner.#writeText,
      close: owner.#terminate,
      get closed() {
        return owner.#closed
      }
    })
  }
  /** Transfer cold endpoint subscriptions and restore the exact hot subscribe operation. */
  #prepareReceive(): void {
    /** The same cold subscriber set survives activation without another lookup. */
    const pendingListeners = this.#pendingListeners
    if (pendingListeners) {
      /** Preserve the canonical transport subscription rather than permanently wrapping dispatch. */
      const subscribe = this.#transport.subscribe
      this.#transport.subscribe = (listener) => {
        pendingListeners.add(listener)
        return () => {
          pendingListeners.delete(listener)
          this.#listeners.delete(listener)
        }
      }
      this.#activateReceive = () => {
        if (this.#closed) throw this.#terminalError
        this.#transport.subscribe = subscribe
        for (const listener of pendingListeners) this.#listeners.add(listener)
        pendingListeners.clear()
        this.#flushBusiness()
      }
    }
  }
}

/** Bind one physical byte channel and retain its original handshake, writer and close ownership. */
export function bindRuntimeByteWire(
  channel: IRuntimeByteIO,
  options: Pick<
    IRuntimeConnectionOptions,
    'platform' | 'expectedStringText' | 'peerId' | 'report' | 'signal'
  > &
    Readonly<{ role?: 'initiator' | 'responder' }>,
  diagnostics: IRuntimeByteDiagnostics
): IRuntimeByteWire {
  return new RuntimeByteWire(channel, options, diagnostics).value
}

/** Message channels keep their existing whole-message boundary and static codec. */
class RuntimeMessageTransport {
  /** Original channel resource retained by this single adapter owner. */
  #channel: IRuntimeMessageIO

  /** Original options resource retained by this single adapter owner. */
  #options: Pick<
    IRuntimeConnectionOptions,
    'platform' | 'expectedStringText' | 'peerId' | 'report' | 'signal'
  >

  /** Original diagnostics resource retained by this single adapter owner. */
  #diagnostics: Pick<IRuntimeByteDiagnostics, 'closed' | 'duplicateBinding'>

  /** Original receive resource retained by this single adapter owner. */
  #receive:
    | Readonly<{
        subscribe(listener: (value: unknown) => void): void
        unsubscribe(listener: (value: unknown) => void): void
      }>
    | undefined

  /** Message listeners are scoped to this single physical channel. */
  #listeners

  /** A closed channel replays the terminal error to late core subscribers. */
  #errorListeners

  /** Physical retirement is monotonic even when close and abort arrive together. */
  #closed

  /** Whole-message observation belongs to this physical transport, below logical delivery. */
  #probe: IRpcCarrierProbe | undefined

  /** Each installation owns its disposer even when the same probe object is reused. */
  #probeGeneration

  /** Late subscribers receive the same first terminal object rather than a reconstructed error. */
  #terminalError: unknown

  /** Every close caller shares the original physical teardown settlement. */
  #closing: Promise<void> | undefined

  /** Opaque messages retain references and unknown size; the observer never serializes them. */
  #observeMessage = (direction: number, value: unknown): void => {
    if (this.#probe === undefined || this.#closed) return
    try {
      this.#probe.emit(
        direction,
        carrierSizeBytes(value),
        this.#options.platform,
        undefined,
        this.#probe.capturing ? value : undefined
      )
    } catch (cause) {
      try {
        this.#options.report(createRpcTransportError(RpcAdapterErrorText.probeFailed, cause))
      } catch (failure) {
        hostRethrowReporter(failure, IpcReporterContext)
      }
    }
  }

  /** Close releases both listener registrations before the underlying port. */
  #close = (reason?: unknown): Promise<void> => {
    if (this.#closing) return this.#closing
    /** Publish before a terminal listener can synchronously join this physical teardown. */
    const done = deferred<void>()
    this.#closing = done.promise
    this.#closed = true
    this.#probe = undefined
    this.#terminalError = reason ?? createRuntimeDiagnosticError(this.#diagnostics.closed)
    for (const listener of this.#errorListeners) {
      try {
        listener(this.#terminalError)
      } catch (error) {
        try {
          this.#options.report(error)
        } catch (failure) {
          hostRethrowReporter(failure, IpcReporterContext)
        }
      }
    }
    void (async () => {
      try {
        /** The existing lifecycle executor keeps every remover ahead of the physical release. */
        const failures = await createDisposeTransaction(
          { kind: DisposeTransactionKind.plan },
          { errorPolicy: 'collect' }
        ).run(
          [
            this.#removeMessage,
            this.#removeClose,
            () => this.#options.signal?.removeEventListener('abort', this.#onAbort),
            () => this.#channel.close()
          ].map((force, index) => ({ source: String(index), descriptor: { force } }))
        )
        if (failures.length === 1) throw failures[0]!.error
        drainListenerFailures(
          failures.map(({ error }) => error),
          { code: RpcCoreErrorCode.transport }
        )
        done.resolve()
      } catch (error) {
        done.reject(error)
      }
    })()
    return this.#closing
  }

  /** This adapter owns exactly one physical whole-message subscription. */
  #onMessage = (data: unknown): void => {
    if (this.#closed) return
    if (this.#probe !== undefined) this.#observeMessage(RpcProbeDirection.inbound, data)
    for (const listener of this.#listeners) {
      try {
        listener({ data, peerId: this.#options.peerId })
      } catch (error) {
        this.#options.report(error)
      }
    }
  }

  /** Expanded startup transfers the existing cold reader; fixed construction stays direct. */
  #removeMessage

  /** Observe physical terminal once, independently of business listener registration. */
  #removeClose

  /** Cancellation retains the original signal reason on this connection only. */
  #onAbort = (): void => {
    void this.#close(
      createRuntimeDiagnosticError(
        this.#diagnostics.closed,
        this.#options.signal === undefined ? undefined : resolveAbortReason(this.#options.signal)
      )
    )
  }

  /** Frozen operation surface keeps the original transport/resource identity. */
  readonly value: IRpcTransport
  /** Acquire resources and install native observers in the original construction order. */
  constructor(
    channel: IRuntimeMessageIO,
    options: Pick<
      IRuntimeConnectionOptions,
      'platform' | 'expectedStringText' | 'peerId' | 'report' | 'signal'
    >,
    diagnostics: Pick<IRuntimeByteDiagnostics, 'closed' | 'duplicateBinding'>,
    receive?: Readonly<{
      subscribe(listener: (value: unknown) => void): void
      unsubscribe(listener: (value: unknown) => void): void
    }>
  ) {
    this.#channel = channel
    this.#options = options
    this.#diagnostics = diagnostics
    this.#receive = receive

    claim(this.#channel, this.#diagnostics)
    this.#listeners = new Set<(message: { data: unknown; peerId: string }) => void>()
    this.#errorListeners = new Set<(error: unknown) => void>()
    this.#closed = false
    this.#probeGeneration = 0
    this.#removeMessage = receive
      ? () => receive.unsubscribe(this.#onMessage)
      : this.#channel.onMessage(this.#onMessage)

    this.#receive?.subscribe(this.#onMessage)
    this.#removeClose = this.#channel.onClose((reason) => {
      void this.#close(
        reason === undefined
          ? undefined
          : createRuntimeDiagnosticError(this.#diagnostics.closed, reason)
      )
    })

    this.#options.signal?.addEventListener('abort', this.#onAbort, { once: true })

    if (this.#options.signal?.aborted) this.#onAbort()

    this.value = RuntimeMessageTransport.#createTransport(this)
  }
  /** Expose the original whole-message transport operations and receiver-independent state getters. */
  static #createTransport(owner: RuntimeMessageTransport): IRpcTransport {
    return {
      platform: owner.#options.platform,
      topology: RpcTransportTopology.exclusive,
      ownership: RpcTransportOwnership.owned,
      encodedType: RpcTransportEncoding.any,
      peerId: owner.#options.peerId,
      observe(next) {
        /** Reinstalling the same handle cannot give an old release ownership of this installation. */
        const generation = ++owner.#probeGeneration
        if (!owner.#closed) owner.#probe = next
        return () => {
          if (generation === owner.#probeGeneration) owner.#probe = undefined
        }
      },
      send(value) {
        if (owner.#closed) return Promise.reject(owner.#terminalError)
        if (owner.#probe !== undefined) owner.#observeMessage(RpcProbeDirection.outbound, value)
        return owner.#channel.send(value)
      },
      subscribe(listener) {
        owner.#listeners.add(listener)
        return () => {
          owner.#listeners.delete(listener)
        }
      },
      onTransportError(listener) {
        owner.#errorListeners.add(listener)
        if (owner.#closed) listener(owner.#terminalError)
        return () => {
          owner.#errorListeners.delete(listener)
        }
      },
      close: owner.#close,
      get closed() {
        return owner.#closed
      }
    }
  }
}

/** Bind one whole-message channel without changing its native send or close settlement. */
export function bindRuntimeMessageTransport(
  channel: IRuntimeMessageIO,
  options: Pick<
    IRuntimeConnectionOptions,
    'platform' | 'expectedStringText' | 'peerId' | 'report' | 'signal'
  >,
  diagnostics: Pick<IRuntimeByteDiagnostics, 'closed' | 'duplicateBinding'>,
  receive?: Readonly<{
    subscribe(listener: (value: unknown) => void): void
    unsubscribe(listener: (value: unknown) => void): void
  }>
): IRpcTransport {
  return new RuntimeMessageTransport(channel, options, diagnostics, receive).value
}
