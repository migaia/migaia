import type { IRpcPlatformValue, IRpcTransportTopologyValue } from './transport-constants.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  createRpcConstructionError,
  createRpcError,
  createRpcLifecycleError,
  RpcCoreErrorCode
} from './errors.js'

import { RpcCoreErrorText } from './error-text.js'
import { ResourceScope } from './internal/resource-scope.js'
import { safeRead, safeString } from './internal/safe-value.js'
import { createEndpointTimePort, type IEndpointTimePort } from './internal/time-port.js'
import type {
  IRpcInboundMessage,
  IRpcSendOptions,
  IRpcTransport,
  IRpcTransportEncoding,
  IRpcTransportOwnership
} from './transport.js'
import { RpcPlatform } from './transport-constants.js'
import { systemScheduler, type IScheduler, type IWallClock } from '@migaia/utils/scheduler'
import {
  readInstalledProbe,
  releaseInstalledProbe,
  type IProbeEmitter
} from './internal/probe-emitter.js'

/** The kernel alone owns default scheduler identity; bootstrap and the time port reuse its decision. */
export function isEndpointSystemScheduler(scheduler: IScheduler | undefined): boolean {
  return scheduler === undefined || scheduler === systemScheduler
}

/** Canonical lifecycle states owned by one endpoint kernel. */
export const EndpointKernelState = {
  constructing: 'constructing',
  active: 'active',
  closing: 'closing',
  disposed: 'disposed'
} as const

/** Lifecycle state value exposed to internal feature attachments. */
export type IEndpointKernelState = (typeof EndpointKernelState)[keyof typeof EndpointKernelState]

/** Cold client counts reuse these actual canonical registries; no provider count is included. */
export const EndpointOwnerKey = {
  /** Cold source acquisition borrows the same kernel's existing resource lifecycle. */
  resourceScope: 'resource-scope',
  /** Cold runtime assembly reads the genuine attachments from this existing owner table. */
  outboundAttachment: 'outbound-attachment',
  /** The same provider attachment retains runtime execution and cancellation authority. */
  providerAttachment: 'provider-attachment',
  /** Cold construction and contract tests read the original provider namespace owner. */
  providerRegistry: 'provider-registry',
  /** All opt-in ingress and execution share the original logical provider's admission owner. */
  providerAdmission: 'provider-admission',
  /** The canonical stream owner alone handles new-profile credit and terminal state. */
  streamOwner: 'stream-owner',
  pendingRegistry: 'pending-registry',
  streamConsumerRegistry: 'stream-consumer-registry'
} as const

/** Canonical labels keep raw capture cleanup aligned with the endpoint's native subscription. */
export const EndpointResourceLabel = {
  /** Subscription failures retain their original public cleanup diagnostic label. */
  transportSubscription: 'transport subscription'
} as const

/** One decoded frame owner installed into the kernel's constant-time route table. */
export type IEndpointKernelRoute = (message: unknown) => void | Promise<void>

/** Construction-time transport field values read exactly once before kernel allocation. */
export type IEndpointKernelTransportSnapshot = Readonly<{
  readonly send: unknown
  readonly subscribe: unknown
  readonly close: unknown
  readonly onTransportError: unknown
  readonly onListenerError: unknown
  readonly platform: unknown
  readonly topology: unknown
  readonly origin: unknown
  readonly encodedType: unknown
  readonly ownership: unknown
}>

/** Failure and receive callbacks supplied by the temporarily adapted full endpoint. */
export type IEndpointKernelCallbacks = {
  readonly receive: (message: IRpcInboundMessage<unknown>) => void | Promise<void>
  readonly transportError: (error: unknown) => void
  readonly listenerError: (error: unknown) => void
  readonly receiveError: (error: unknown) => void
}

/** Subscription handles prepared by the final activation owner before kernel commit. */
export type IEndpointKernelActivation = {
  readonly unsubscribe: () => void
  readonly unsubscribeTransportError?: () => void
  readonly unsubscribeListenerError?: () => void
  readonly commit: () => void
}

/** Feature-neutral transport, routing, lifecycle, and resource ports. */
export type IEndpointKernelHost = {
  readonly transport: IRpcTransport
  readonly platform: IRpcPlatformValue
  readonly topology: IRpcTransportTopologyValue | undefined
  readonly origin: string | undefined
  readonly encodedType: IRpcTransportEncoding | undefined
  readonly ownership: IRpcTransportOwnership | undefined
  readonly resources: ResourceScope
  readonly time: IEndpointTimePort
  readonly closingSignal: IAbortSignal
  readonly generation: number
  readonly state: IEndpointKernelState
  /** Cold owner construction reads the emitter once after middleware ports have installed. */
  readonly probe: IProbeEmitter | undefined
  readonly ownerKeys: readonly string[]
  readonly routeKeys: readonly string[]
  activate(activation: IEndpointKernelActivation): void
  assertActive(generation?: number): void
  send<Message, Transfer>(
    message: Message,
    options?: IRpcSendOptions<Transfer>
  ): void | Promise<void>
  registerRoute(kind: string, route: IEndpointKernelRoute): () => void
  registerOwner(key: string, owner: object): void
  /** Cold reads reuse the original owner table without exposing it on the public endpoint. */
  readOwner(key: string): object | undefined
  dispatchRoute(kind: string, message: unknown): Promise<boolean>
  beginClose(reason?: unknown): void
  completeDispose(): void
}

/**
 * Owns the single physical transport subscription, route table, closing signal, terminal promise,
 * and root resource scope. Concrete endpoint features attach through ports and are never imported.
 */
class EndpointKernel implements IEndpointKernelHost {
  /** Physical transport retained for context-safe method invocation and adapter metadata. */
  readonly #transport: IRpcTransport
  /** Validated platform snapshot used by protocol and authentication context. */
  readonly #platform: IRpcPlatformValue
  /** Validated adapter topology snapshot used by routing policy. */
  readonly #topology: IRpcTransportTopologyValue | undefined
  /** Validated adapter origin snapshot used by identity policy. */
  readonly #origin: string | undefined
  /** Validated wire encoding snapshot used by protocol compatibility checks. */
  readonly #encodedType: IRpcTransportEncoding | undefined
  /** Validated transport ownership snapshot controlling terminal close. */
  readonly #ownership: IRpcTransportOwnership | undefined
  /** Root lifecycle owner shared with the endpoint resource coordinator. */
  readonly #resources = new ResourceScope()
  /** Endpoint-local immutable clock/timer capability; all attachment timers drain through it. */
  readonly #time: IEndpointTimePort
  /** Aborts in-flight operations synchronously when closing starts. */
  readonly #closing = new AbortController()
  /** Constant-time decoded-frame route ownership table for selected attachments. */
  readonly #routes = new Map<string, IEndpointKernelRoute>()
  /** Per-kernel owner topology used to prevent duplicate runtime allocations. */
  readonly #owners = new Map<string, object>()
  /** Returns one exact registered owner without installing an observer or reconstructing state. */
  readOwner(key: string): object | undefined {
    return this.#owners.get(key)
  }
  /** Current lifecycle state; only this kernel mutates it. */
  #state: IEndpointKernelState = EndpointKernelState.constructing
  /** Invalidates callbacks captured before close without allocating per callback. */
  #generation = 0
  /** One endpoint observer is cached at activation; normal send paths never read probe hosts. */
  #probe: IProbeEmitter | undefined
  /** Returns the transport-bound installation only during cold attachment construction. */
  get probe(): IProbeEmitter | undefined {
    return this.#probe ?? readInstalledProbe(this.#transport)
  }
  /** Snapshots and validates transport metadata without subscribing or allocating feature owners. */
  constructor(
    transport: IRpcTransport,
    snapshot: IEndpointKernelTransportSnapshot | undefined,
    scheduler: IScheduler,
    wallClock: IWallClock | undefined
  ) {
    this.#time = createEndpointTimePort(scheduler, wallClock, isEndpointSystemScheduler(scheduler))
    const transportSnapshot = snapshot ?? readTransportSnapshot(transport)
    const {
      send: transportSend,
      subscribe: transportSubscribe,
      close: transportClose,
      onTransportError,
      onListenerError,
      platform,
      topology,
      origin,
      encodedType,
      ownership
    } = transportSnapshot
    if (typeof transportSend !== 'function' || typeof transportSubscribe !== 'function')
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.transportDescriptorInvalid
      )
    if (
      (transportClose !== undefined && typeof transportClose !== 'function') ||
      (onTransportError !== undefined && typeof onTransportError !== 'function') ||
      (onListenerError !== undefined && typeof onListenerError !== 'function')
    )
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.transportDescriptorInvalid
      )
    if (
      !isRpcPlatform(platform) ||
      (topology !== undefined &&
        topology !== 'exclusive' &&
        topology !== 'multiplexed' &&
        topology !== 'broadcast') ||
      (origin !== undefined && typeof origin !== 'string') ||
      (encodedType !== undefined &&
        encodedType !== 'any' &&
        encodedType !== 'string' &&
        encodedType !== 'uint8array') ||
      (ownership !== undefined && ownership !== 'owned' && ownership !== 'borrowed')
    )
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.transportIdentityDescriptorInvalid
      )
    this.#transport = transport
    this.#platform = platform
    this.#topology = topology
    this.#origin = origin
    this.#encodedType = encodedType
    this.#ownership = ownership
    this.#owners.set('kernel', this)
    this.#owners.set(EndpointOwnerKey.resourceScope, this.#resources)
    this.#owners.set('time-port', this.#time)
    this.#resources.addSync('endpoint time port', () => this.#time.dispose())
    if (this.#ownership !== 'borrowed')
      this.#resources.add('transport close', () => this.#transport.close?.(), 'critical')
  }

  /** Returns the physical transport without transferring its ownership. */
  get transport(): IRpcTransport {
    return this.#transport
  }

  /** Returns the immutable endpoint-local clock and timer capability. */
  get time(): IEndpointTimePort {
    return this.#time
  }

  /** Returns the immutable validated platform snapshot. */
  get platform(): IRpcPlatformValue {
    return this.#platform
  }

  /** Returns the immutable validated topology snapshot. */
  get topology(): IRpcTransportTopologyValue | undefined {
    return this.#topology
  }

  /** Returns the immutable validated origin snapshot. */
  get origin(): string | undefined {
    return this.#origin
  }

  /** Returns the immutable validated encoding snapshot. */
  get encodedType(): IRpcTransportEncoding | undefined {
    return this.#encodedType
  }

  /** Returns the immutable validated ownership snapshot. */
  get ownership(): IRpcTransportOwnership | undefined {
    return this.#ownership
  }

  /** Returns the one root lifecycle scope shared by all selected attachments. */
  get resources(): ResourceScope {
    return this.#resources
  }

  /** Returns the canonical close signal without exposing its controller. */
  get closingSignal(): IAbortSignal {
    return this.#closing.signal
  }

  /** Returns the callback generation used to reject work captured before closing. */
  get generation(): number {
    return this.#generation
  }

  /** Returns the canonical lifecycle state. */
  get state(): IEndpointKernelState {
    return this.#state
  }

  /** Returns the exact sorted runtime-owner topology retained by this kernel. */
  get ownerKeys(): readonly string[] {
    return Object.freeze([...this.#owners.keys()].sort())
  }

  /** Returns decoded route kinds registered by selected feature attachments. */
  get routeKeys(): readonly string[] {
    return Object.freeze([...this.#routes.keys()].sort())
  }

  /**
   * Activates exactly one receiver and adapter error subscriptions. Registration rollback releases
   * every prior listener synchronously and closes an owned transport through the root scope.
   */
  activate(activation: IEndpointKernelActivation): void {
    if (this.#state !== EndpointKernelState.constructing)
      throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    try {
      this.#resources.addSync(EndpointResourceLabel.transportSubscription, activation.unsubscribe)
      if (activation.unsubscribeTransportError)
        this.#resources.addSync(
          'transport error subscription',
          activation.unsubscribeTransportError
        )
      if (activation.unsubscribeListenerError)
        this.#resources.addSync('listener error subscription', activation.unsubscribeListenerError)
      this.#state = EndpointKernelState.active
      activation.commit()
      this.#probe = this.probe
      if (this.#probe) {
        /**
         * Capability masks describe real physical and lifecycle production, intersected with
         * subscriptions.
         */
        let capabilities = this.#probe.mask
        if (this.#probe.authentication === 'none') capabilities &= ~(1 << 5)
        if (!this.#probe.peerOwned) capabilities &= ~(1 << 0)
        if (!this.#transport.observe) capabilities &= ~(1 << 6)
        this.#probe.describe({
          endpointId: this.#probe.endpointId,
          platform: this.#platform,
          topology: this.#topology,
          encodedType: this.#encodedType,
          authentication: this.#probe.authentication,
          fastPath: this.#probe.fastPath,
          carrier: this.#transport.observe ? this.#platform : 'unavailable',
          stageMask: capabilities
        })
        if (this.#transport.observe) {
          try {
            /**
             * This exact receipt belongs to the canonical resource scope, never another lifecycle
             * manager.
             */
            const release = this.#transport.observe(this.#probe.carrier())
            this.#resources.add('probe transport observation', () => {
              try {
                release()
              } catch (error) {
                this.#probe?.report(error)
                throw error
              }
            })
          } catch (error) {
            this.#probe.report(error)
          }
        }
      }
    } catch (error) {
      this.#beginClose()
      const cleanupPromise = this.#resources.releaseAll()
      void cleanupPromise.then(
        () => {
          this.#state = EndpointKernelState.disposed
        },
        () => {
          this.#state = EndpointKernelState.disposed
        }
      )
      /** A hostile message getter is secondary; the registration failure remains first. */
      let primary: unknown = error
      let message: string = RpcCoreErrorText.endpointRegistrationFailed
      try {
        /** String conversion and property reads share this secondary cause position. */
        const secondary: unknown[] = []
        message = safeString(safeRead(error, 'message'), message, ({ error: failure }) => {
          secondary.push(failure)
          return undefined
        })
        if (secondary.length > 0) primary = new AggregateError([error, ...secondary], message)
      } catch (readError) {
        primary = new AggregateError([error, readError], message)
      }
      throw createRpcConstructionError(message, primary, [], cleanupPromise)
    }
  }

  /** Rejects work after closing or when its captured generation is stale. */
  assertActive(generation?: number): void {
    if (generation !== undefined && generation !== this.#generation)
      throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    if (
      this.#state !== EndpointKernelState.constructing &&
      this.#state !== EndpointKernelState.active
    )
      throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
  }

  /** Sends through the canonical transport while preserving class-instance method context. */
  send<Message, Transfer>(
    message: Message,
    options?: IRpcSendOptions<Transfer>
  ): void | Promise<void> {
    this.assertActive()
    return this.#transport.send(message, options)
  }

  /** Claims one decoded frame kind and returns an idempotent release function. */
  registerRoute(kind: string, route: IEndpointKernelRoute): () => void {
    this.assertActive()
    if (this.#routes.has(kind))
      throw createRpcError(RpcCoreErrorCode.capabilityConflict, RpcCoreErrorText.endpointRouteOwned)
    this.#routes.set(kind, route)
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.#routes.get(kind) === route) this.#routes.delete(kind)
    }
  }

  /** Registers one concrete owner identity and rejects duplicate ownership within the kernel. */
  registerOwner(key: string, owner: object): void {
    this.assertActive()
    if (this.#owners.has(key))
      throw createRpcError(RpcCoreErrorCode.capabilityConflict, RpcCoreErrorText.endpointOwnerOwned)
    this.#owners.set(key, owner)
  }

  /** Dispatches a decoded frame to its unique owner in constant time. */
  async dispatchRoute(kind: string, message: unknown): Promise<boolean> {
    this.assertActive()
    const route = this.#routes.get(kind)
    if (!route) return false
    await route(message)
    return true
  }

  /** Starts close synchronously and returns the canonical terminal Promise. */
  beginClose(reason?: unknown): void {
    this.#beginClose(reason)
  }

  /** Completes the Host-owned terminal transition after root resources have been released. */
  completeDispose(): void {
    this.#beginClose()
    this.#routes.clear()
    this.#owners.clear()
    this.#state = EndpointKernelState.disposed
  }

  /** Closes admission and invalidates all captured callback generations synchronously. */
  #beginClose(reason?: unknown): void {
    if (this.#state === EndpointKernelState.closing || this.#state === EndpointKernelState.disposed)
      return
    this.#state = EndpointKernelState.closing
    this.#probe ??= readInstalledProbe(this.#transport)
    if (this.#probe) releaseInstalledProbe(this.#transport, this.#probe)
    this.#generation += 1
    if (reason === undefined) this.#closing.abort()
    else this.#closing.abort(reason)
  }
}

/** Creates the one feature-neutral kernel without subscribing or constructing feature owners. */
export function createEndpointKernel(
  transport: IRpcTransport,
  snapshot?: IEndpointKernelTransportSnapshot,
  scheduler: IScheduler = systemScheduler,
  wallClock?: IWallClock
): IEndpointKernelHost {
  return new EndpointKernel(transport, snapshot, scheduler, wallClock)
}

/** Captures each transport descriptor field once when no bootstrap snapshot is available. */
export function readTransportSnapshot(transport: IRpcTransport): IEndpointKernelTransportSnapshot {
  try {
    return Object.freeze({
      send: safeRead<unknown>(transport, 'send'),
      subscribe: safeRead<unknown>(transport, 'subscribe'),
      close: safeRead<unknown>(transport, 'close'),
      onTransportError: safeRead<unknown>(transport, 'onTransportError'),
      onListenerError: safeRead<unknown>(transport, 'onListenerError'),
      platform: safeRead<unknown>(transport, 'platform'),
      topology: safeRead<unknown>(transport, 'topology'),
      origin: safeRead<unknown>(transport, 'origin'),
      encodedType: safeRead<unknown>(transport, 'encodedType'),
      ownership: safeRead<unknown>(transport, 'ownership')
    })
  } catch (error) {
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.transportDescriptorInvalid,
      error
    )
  }
}

/** Narrows a hostile transport platform descriptor to the public platform domain. */
function isRpcPlatform(value: unknown): value is IRpcPlatformValue {
  return Object.values(RpcPlatform).includes(value as IRpcPlatformValue)
}
