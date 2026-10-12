import { retainRuntimeConnectionIdentity } from '../byte/connection-identity.js'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import type { IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import {
  createBrowserMessagePortTransport,
  createNodeMessagePortTransport,
  type IBrowserMessagePortLike
} from '../../core/adapters/message-port.js'
import { tagRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { registerBatchAgreement } from '../../core/internal/batch-frame.js'
import {
  registerLazyNativeReplayOwner,
  registerNativeReplayOwner,
  bindNativeReplayTransport
} from '../../core/internal/native-replay.js'
import type { IRuntimePeerSourceResult } from '../../remote/index.js'
import { createEventEmitterMessageHandoff, createEventTargetMessageHandoff } from './handoff.js'
import type {
  IAdapterEventEmitterMessagePort,
  IAdapterEventTargetMessagePort,
  IAdapterLaunchHandle,
  IAdapterMessageOpenOptions,
  IAdapterMessageResource,
  IAdapterStaticMessageOptions,
  IAdapterInitialMessageResource
} from './types.js'

/** The original identity/message component pair remains canonical and has no runtime dependency. */
const messagePipeline = Object.freeze({ codec: identityCodecV1, framer: messageFramerV1 })

/** The canonical parser's admitted initial metadata stays private to its actual held resource. */
type IAdapterMessageInitial = Extract<
  ReturnType<typeof rpcMessageCapabilityControl.readInitial>,
  { valid: true }
>['value']['metadata']

/** Core reads preparation only from exact resource/channel identities, never copied public fields. */
const preparations = new WeakMap<object, IAdapterMessagePreparation>()

/** Internal metadata feeds the existing Peer owner without publishing a claim/receipt DTO. */
export type IAdapterMessagePreparation = Readonly<{
  readonly rawBootstrap: unknown
  readonly readyBootstrap: Promise<unknown>
  readonly initial: IAdapterMessageInitial | undefined
  readonly generation: IRpcRuntimeGeneration | undefined
  activateReceive(): void
  fail(cause?: unknown): void
  close(): void
}>

/** The ordinary resource and its exact channel share Core's private preparation identity. */
export function readAdapterMessagePreparation(
  value: object
): IAdapterMessagePreparation | undefined {
  return preparations.get(value)
}

/** Preserve original native TypeError, error source, field and cause at control admission. */
function invalidControl(field: string, cause?: unknown): never {
  /** Diagnostic tagging never grants an arbitrary caller Core operation identity. */
  const error = tagRpcError(
    new TypeError(rpcMessageCapabilityControl.failureText, { cause }),
    RpcCoreErrorCode.invalidConfig
  )
  Object.defineProperty(error, 'detail', { value: Object.freeze({ field }), enumerable: true })
  throw error
}

/** One held raw resource owns control capture, exact transport construction and stable close. */
class AdapterMessageResource implements IAdapterMessageResource {
  /** Exactly one of the two structural messaging surfaces supplies the physical operations. */
  readonly #port: IAdapterEventEmitterMessagePort | IAdapterEventTargetMessagePort
  /** EventTarget data extraction remains separate from EventEmitter's whole-message callback. */
  readonly #eventTarget: boolean
  /** Actual launch completion and termination belong to the original held launcher. */
  readonly #launch: IAdapterLaunchHandle | undefined
  /** Bounded capture is transferred to the canonical endpoint after its roots finish preparation. */
  #handoff:
    | ReturnType<typeof createEventEmitterMessageHandoff>
    | ReturnType<typeof createEventTargetMessageHandoff>
    | undefined
  /** ACK traffic may arrive before a launcher hands its resource to the channel factory. */
  /** Automatic preparation waits for the actual initial message observed by this resource. */
  readonly #bootstrap = deferred<unknown>()
  /** Child detection and automatic Peer construction share one bounded initial capture. */
  #initialDeadline: IScheduledTask | undefined
  /** The original undecoded initial message stays private to the existing Peer owner. */
  #rawBootstrap: unknown
  /** Actual initial control is admitted once; Peer/generation reads share this exact cached result. */
  #initial: IAdapterMessageInitial | undefined
  /** Duplicate capability ACKs fail while this same startup owner remains active. */
  #acknowledged = false
  /** The original received proposal is retained privately before a channel can be constructed. */
  #peerOffer: readonly string[] | undefined
  /** Automatic initial capture rejects non-bootstrap traffic at the original admission boundary. */
  #waitingInitial = false
  /** Capability preparation stores only Core's own local offer and observed control result. */
  #control: Promise<readonly string[]> | undefined
  /** The Core-owned readiness Promise settles in the actual raw ACK/failure callback segment. */
  #controlResult: ReturnType<typeof deferred<readonly string[]>> | undefined
  /** This independent local proposal is retained before any asynchronous receive can complete. */
  #localOffer: readonly string[] | undefined
  /** Early physical failure remains available when a launcher later opens its exact resource. */
  #failure: unknown
  /** Received acceptance is private output; subsequent public open options can only narrow it. */
  #accepted: readonly string[] | undefined
  /** Physical retirement is permanent and cannot be reversed by copied transport properties. */
  #alive = true
  /** Cold failure and later open cleanup share one request to the held native termination operation. */
  #terminationRequested = false
  /** A successful opening retains only its canonical borrowed message channel. */
  #channel: IRuntimePeerSourceResult | undefined
  /** Expanded opening is one operation; concurrent consumers join its actual startup Promise. */
  #opening: Promise<IRuntimePeerSourceResult> | undefined
  /** Concurrent resource shutdown preserves the original Promise and cleanup failure. */
  #closing: Promise<void> | undefined

  /**
   * Hold raw I/O; launched resources capture immediately while borrowed EventEmitter ports stay
   * cold.
   */
  constructor(
    port: IAdapterEventEmitterMessagePort | IAdapterEventTargetMessagePort,
    eventTarget: boolean,
    launch?: IAdapterLaunchHandle
  ) {
    this.#port = port
    this.#eventTarget = eventTarget
    this.#launch = launch
    // The eventual opening owns these failures; observation prevents late unhandled rejection.
    void this.#bootstrap.promise.catch(() => undefined)
    if (!eventTarget) {
      /** Reader count comes from this held physical port, never an adapter qualification callback. */
      const native = port as IAdapterEventEmitterMessagePort
      if (typeof native.listenerCount === 'function') {
        if (launch) {
          native.once?.('close', () => {
            this.#alive = false
          })
          registerNativeReplayOwner(native, {
            alive: () => this.#alive,
            exclusive: () => native.listenerCount!('message') <= 1
          })
        } else
          registerLazyNativeReplayOwner(native, () => {
            native.once?.('close', () => {
              this.#alive = false
            })
            return {
              alive: () => this.#alive,
              exclusive: () => native.listenerCount!('message') <= 1
            }
          })
      }
    }
    if (launch) this.#capture()
    if (launch) {
      void Promise.resolve(launch.exited).then(
        (status) => {
          this.#alive = false
          /** A native exit settles incomplete startup using its original observed failure. */
          const cause =
            status && typeof status === 'object' && 'error' in status ? status.error : undefined
          this.#handoff?.fail(cause)
        },
        (cause) => {
          this.#alive = false
          this.#handoff?.fail(cause)
        }
      )
      if (launch.failed)
        void Promise.resolve(launch.failed).then(
          (cause) => this.#handoff?.fail(cause),
          (cause) => this.#handoff?.fail(cause)
        )
    }
    /** This getter reads raw capture data without exposing another preparation setter. */
    const preparation = Object.defineProperties(
      {
        readyBootstrap: this.#bootstrap.promise,
        activateReceive: () => this.#handoff?.activateReceive(),
        fail: (cause?: unknown) => this.#handoff?.fail(cause),
        close: () => this.#handoff?.close()
      },
      {
        rawBootstrap: { get: () => this.#rawBootstrap, enumerable: true },
        initial: { get: () => this.#initial, enumerable: true },
        generation: { get: () => this.#initial?.generation, enumerable: true }
      }
    ) as IAdapterMessagePreparation
    preparations.set(this, preparation)
  }

  /** Install the original one-slot handoff and consume only the standard control grammar. */
  #capture(): void {
    if (this.#handoff) return
    /** Received ACKs supply peer proposals; no public resource property may inject one. */
    const options = {
      consume: (message: unknown): boolean => {
        if (this.#waitingInitial && !rpcMessageCapabilityControl.isInitial(message))
          invalidControl('bootstrap')
        if (rpcMessageCapabilityControl.isAcknowledgement(message)) {
          if (this.#acknowledged) invalidControl('runtimeApi.ack')
          /** The closed ACK parser is the single Contract owner shared by every adapter. */
          const parsed = rpcMessageCapabilityControl.readAcknowledgement(message)
          if (!parsed.valid) invalidControl(parsed.field)
          this.#acknowledged = true
          this.#peerOffer = parsed.value
          if (this.#localOffer) {
            this.#accepted = rpcMessageCapabilityControl.intersect(this.#localOffer, parsed.value)
            this.#controlResult?.resolve(this.#accepted)
          }
          return true
        }
        if (rpcMessageCapabilityControl.isReady(message)) return true
        if (rpcMessageCapabilityControl.isInitial(message)) {
          if (!this.#waitingInitial) return false
          this.#admitInitial(message)
          this.#waitingInitial = false
          this.#bootstrap.resolve(message)
          return true
        }
        return false
      },
      onFailure: (error: unknown): void => {
        this.#failure = error
        this.#controlResult?.reject(error)
        this.#bootstrap.reject(error)
        this.#terminateLaunch()
      }
    }
    this.#handoff = this.#eventTarget
      ? createEventTargetMessageHandoff(this.#port as IAdapterEventTargetMessagePort, options)
      : createEventEmitterMessageHandoff(this.#port as IAdapterEventEmitterMessagePort, options)
  }

  /** Admit only this actual held initial input and retain its original snapshot for Core consumers. */
  #admitInitial(raw: unknown): IAdapterMessageInitial {
    if (raw === this.#rawBootstrap && this.#initial) return this.#initial
    /** The one Contract parser retains portable/generation admission order and failure identity. */
    const parsed = rpcMessageCapabilityControl.readInitial(raw)
    if (!parsed.valid) invalidControl(parsed.field)
    this.#rawBootstrap = raw
    this.#initial = parsed.value.metadata
    return this.#initial
  }

  /** Request actual native termination once, independently of receipt retirement and channel close. */
  #terminateLaunch(): void {
    if (this.#terminationRequested || !this.#launch) return
    this.#terminationRequested = true
    this.#launch.terminate()
  }

  /** Capture initial raw control synchronously before automatic preparation can yield. */
  receiveInitial(initial?: IAdapterInitialMessageResource, bounded?: true): Promise<unknown> {
    if (initial) {
      if (initial.direction !== 'inbound') invalidControl('runtimeApi')
      /** The actual native initial read supplies raw data without sending a capability ACK early. */
      const raw = initial.read()
      this.#admitInitial(raw)
      this.#bootstrap.resolve(raw)
      return this.#bootstrap.promise
    }
    this.#waitingInitial = this.#rawBootstrap === undefined
    this.#capture()
    if (bounded && this.#waitingInitial && !this.#initialDeadline) {
      this.#initialDeadline = systemScheduler.schedule(
        () => this.#handoff?.fail(),
        rpcMessageCapabilityControl.timeoutMs
      )
      /** Observation releases the one timer while returning the original capture Promise. */
      void this.#bootstrap.promise.then(
        () => this.#initialDeadline?.cancel(),
        () => this.#initialDeadline?.cancel()
      )
    }
    return this.#bootstrap.promise
  }

  /**
   * Build only Core's own transport over the held raw resource and internally accepted
   * capabilities.
   */
  #build(
    options: IAdapterStaticMessageOptions,
    capabilities: readonly string[],
    deferredReceive: boolean
  ): IRuntimePeerSourceResult {
    /** Expanded preparation transfers this original capture owner into the canonical transport. */
    const handoff = this.#handoff
    if (!deferredReceive) handoff?.activateReceive()
    /**
     * EventTarget adaptation borrows the native runtime's lifecycle, as the original message
     * channel did.
     */
    const port = handoff?.port ?? this.#port
    /** Only a new canonical transport is signed; no external qualification target is accepted. */
    const transport = this.#eventTarget
      ? createBrowserMessagePortTransport(
          {
            postMessage: (message, transfer) => port.postMessage(message, transfer),
            addEventListener: (event, listener) =>
              (port as IAdapterEventTargetMessagePort).addEventListener(event, listener),
            removeEventListener: (event, listener) =>
              (port as IAdapterEventTargetMessagePort).removeEventListener(event, listener),
            start: () => undefined,
            close: () => undefined
          } satisfies IBrowserMessagePortLike,
          { ownership: 'borrowed' }
        )
      : createNodeMessagePortTransport(port as IAdapterEventEmitterMessagePort)
    if (!this.#eventTarget && handoff) bindNativeReplayTransport(this.#port, transport)
    registerBatchAgreement(transport, capabilities)
    /** Concurrent channel teardown retains its exact original cleanup Promise. */
    let closing: Promise<void> | undefined
    /** Static presentation remains the existing message-channel API, independent of startup wire. */
    const channel: IRuntimePeerSourceResult = Object.freeze({
      transport,
      peerId: options.peerId,
      scheduler: options.scheduler,
      agreement: Object.freeze({
        source: 'static' as const,
        codec: identityCodecV1.id,
        capabilities
      }),
      pipeline: messagePipeline,
      features: [],
      ...(deferredReceive && handoff ? { activateReceive: () => handoff.activateReceive() } : {}),
      close: () =>
        (closing ??= Promise.resolve().then(() => {
          handoff?.close()
          return transport.close?.()
        }))
    })
    /** A real inbound launch binds this channel to the actual observed parent's stable address. */
    if (this.#initial) retainRuntimeConnectionIdentity(channel, this.#initial.parent.instanceId)
    this.#channel = channel
    preparations.set(channel, preparations.get(this)!)
    return channel
  }

  /** Construct the fixed profile synchronously; local policy may disable but never add capability. */
  openStatic(options: IAdapterStaticMessageOptions): IRuntimePeerSourceResult {
    /** Fixed component construction supplies the baseline, while explicit policy only narrows it. */
    const capabilities =
      options.enabled === undefined
        ? rpcMessageCapabilityControl.staticCapabilities
        : rpcMessageCapabilityControl.intersect(
            options.enabled,
            rpcMessageCapabilityControl.staticCapabilities
          )
    if (
      options.enabled?.some(
        (value) => !rpcMessageCapabilityControl.staticCapabilities.includes(value)
      )
    )
      invalidControl('runtimeApi.capabilities')
    return this.#build(options, capabilities, false)
  }

  /** Start expanded control negotiation and join its one original preparation operation. */
  open(options: IAdapterMessageOpenOptions): Promise<IRuntimePeerSourceResult> {
    return (this.#opening ??= this.#open(options))
  }

  /** Prepare control on the held resource before the caller knows its channel scheduler. */
  prepareControl(
    offer: readonly string[],
    bootstrap?: IAdapterInitialMessageResource
  ): Promise<readonly string[]> {
    if (this.#control) return this.#control
    /** A local proposal does not grant any capability until raw peer control has been read. */
    const local = rpcMessageCapabilityControl.readOffer(offer)
    if (!local.valid) invalidControl(local.field)
    this.#localOffer = local.value
    this.#controlResult = deferred<readonly string[]>()
    this.#control = this.#controlResult.promise
    // The opening or public launcher readiness consumer owns this rejection.
    void this.#control.catch(() => undefined)
    this.#capture()
    /** Read actual initial input through its held source; adapter-decoded agreement is not accepted. */
    const raw = bootstrap?.read()
    if (bootstrap?.direction === 'inbound') {
      this.#admitInitial(raw)
      this.#bootstrap.resolve(raw)
    }
    /** The local launch already sent its own offer; only the actual child's ACK completes it. */
    const outgoing = bootstrap?.direction === 'outbound' ? raw : this.#launch?.initialMessage
    const outbound =
      outgoing !== undefined && rpcMessageCapabilityControl.readInitial(outgoing).valid
    /** A captured inbound initial message is the same independent peer offer used by the old child. */
    const initial = bootstrap?.direction === 'inbound' ? raw : this.#rawBootstrap
    const received = initial === undefined ? undefined : this.#admitInitial(initial)
    if (!outbound)
      this.#port.postMessage(rpcMessageCapabilityControl.acknowledgement(local.value), undefined)
    /** Actual early control settles readiness synchronously before Promise delivery as originally. */
    const peer = received?.capabilities ?? this.#peerOffer
    if (peer !== undefined) {
      this.#accepted = rpcMessageCapabilityControl.intersect(local.value, peer)
      this.#controlResult.resolve(this.#accepted)
    } else if (this.#failure !== undefined) this.#controlResult.reject(this.#failure)
    return this.#control
  }

  /** Consume actual initial/ACK I/O before publishing expanded capability facts. */
  async #open(options: IAdapterMessageOpenOptions): Promise<IRuntimePeerSourceResult> {
    if (options.control !== rpcMessageCapabilityControl) invalidControl('runtimeApi.ack')
    /** Later local policy is admitted as an offer and can never add a received capability. */
    const local = options.control.readOffer(options.offer)
    if (!local.valid) invalidControl(local.field)
    if (options.signal?.aborted) throw resolveAbortReason(options.signal)
    /** Launch readiness uses this same operation; no second handshake can be installed. */
    const prepared = this.prepareControl(local.value, options.bootstrap)
    if (this.#accepted !== undefined)
      return this.#build(options, options.control.intersect(this.#accepted, local.value), true)
    /** ACK absence reaches the original startup failure rather than enabling unaccepted flags. */
    let timer: IScheduledTask | undefined
    /** Abort observation is scoped to this attempt and retains the original reason object. */
    let abort: (() => void) | undefined
    try {
      /** The original scheduler owns bounded startup; no second negotiation or retry loop exists. */
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = options.scheduler.schedule(() => {
          this.#handoff?.fail()
          try {
            invalidControl('runtimeApi.ack')
          } catch (error) {
            reject(error)
          }
        }, options.timeoutMs ?? options.control.timeoutMs)
      })
      /** Received launch offer and received ACK use the same single intersection algorithm. */
      const peer = await Promise.race([
        prepared,
        deadline,
        new Promise<never>((_resolve, reject) => {
          if (!options.signal) return
          abort = () => reject(resolveAbortReason(options.signal!))
          options.signal.addEventListener('abort', abort, { once: true })
          if (options.signal.aborted) abort()
        })
      ])
      return this.#build(options, options.control.intersect(peer, local.value), true)
    } catch (error) {
      this.#handoff?.close()
      this.#terminateLaunch()
      throw error
    } finally {
      timer?.cancel()
      if (abort) options.signal?.removeEventListener('abort', abort)
    }
  }

  /** Close only this original messaging resource and retain the same cleanup Promise. */
  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#alive = false
    // The original cold handoff cleanup was synchronous and may preserve a native cleanup throw.
    this.#handoff?.close()
    return (this.#closing = Promise.resolve(this.#channel?.close()))
  }
}

/** Exact factory operations stay intact when a held resource returns to Core's Peer preparation. */
Object.freeze(AdapterMessageResource.prototype)

/**
 * Hold EventEmitter I/O and actual optional execution completion without importing a native
 * runtime.
 */
export function createEventEmitterMessageResource(
  port: IAdapterEventEmitterMessagePort,
  launch?: IAdapterLaunchHandle
): IAdapterMessageResource {
  return Object.freeze(new AdapterMessageResource(port, false, launch))
}

/** Hold EventTarget I/O with the same bounded cold receiver and borrowed lifecycle semantics. */
export function createEventTargetMessageResource(
  port: IAdapterEventTargetMessagePort,
  launch?: IAdapterLaunchHandle
): IAdapterMessageResource {
  return Object.freeze(new AdapterMessageResource(port, true, launch))
}
