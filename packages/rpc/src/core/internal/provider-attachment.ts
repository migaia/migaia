import { selectedJsonObjectPort } from './json-object-port.js'
import { invalidRpcStream } from '../../contract/stream-error.js'
import { createOutboundEnvelope } from './outbound-envelope.js'
import { readProviderPreflight } from './provider.js'
import { hasFastEndpoint } from './fast-path.js'
import type { IRpcProviderController } from './plugin-shared-keys.js'
import { RpcPlatform } from '../transport-constants.js'
import { RpcConfigurationError, RpcError, RpcCoreErrorCode, tagRpcError } from '../errors.js'
import {
  RpcMessageKind,
  RpcProviderRejectionReason,
  RpcReplayCapacityNamespace
} from '../semantic-constants.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcAbortSignal, IRpcContext, IRpcEventListener, IRpcProvider } from '../typing.js'
import {
  deserializeRpcError,
  RpcStreamViolation,
  RpcControl,
  RpcRouteProfile,
  type IRpcEnvelope,
  type IRpcEnvelopeData,
  type IRpcSerializedError
} from '../../contract/index.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import type { IInboundIdentityAdmission } from './inbound-identity.js'
import { EndpointOwnerKey, type IEndpointKernelHost } from '../endpoint-kernel.js'

import type {
  IRpcInboundIdentityPort,
  IRpcOutboundOperationsPort,
  IRpcVariationCoordinatorPort
} from './plugin-shared-keys.js'
import {
  ProviderAdmissionRegistry,
  prepareProviderAdmissionScope,
  type IProviderAdmissionScope
} from './provider-admission.js'
import { assertContractMethod } from './contract.js'
import { ProviderExecutor } from './provider-executor.js'
import { ProviderRegistry } from './provider.js'
import { RequestReplayLedger } from './request-replay-ledger.js'
import { nativeReplayReceipt } from './native-replay.js'
import {
  hasAuthenticationReplayBinding,
  authenticationReplyReceiverId
} from './authentication-replay.js'
import { NativeDefaultIdText } from './native-default-id-text.js'
import { tupleKey, runtimeTaskKey } from './safe-value.js'
import { createRpcIdempotencyStore } from '../idempotency-store.js'
import type { RpcOutboundAttachment } from './outbound-attachment.js'
import type { IRpcRuntimeEnvelope } from '../../contract/runtime-api/types.js'
import { RpcRuntimeKind, RpcRuntimeOperation } from '../../contract/runtime-api/constants.js'
import type { IRpcEarlyProviderIntent } from './variation-coordinator.js'
import {
  readSelectedFramerChunks,
  RpcDebugProperty,
  recordProviderRegistration,
  type IRpcEndpointDebugSnapshot
} from './test-observer.js'

/** Inbound transport metadata retained only for identity admission. */
type IProviderInbound = {
  readonly peerId?: string
  readonly origin?: string
  readonly source?: unknown
}

/** Native provider ports admitted from the one outbound feature owner. */
export type IRpcProviderPorts = {
  readonly outboundOperations: IRpcOutboundOperationsPort
  readonly inboundIdentity: IRpcInboundIdentityPort
  readonly variationCoordinator: IRpcVariationCoordinatorPort
}

/** Canonical provider attachment with an inseparable replay/admission/identity/executor closure. */
export class RpcProviderAttachment {
  /** Provider and event callback ownership. */
  readonly #registry = new ProviderRegistry()
  /** Completed request replay ownership. */
  readonly #replay: RequestReplayLedger
  /** Per-frame authentication brings protected streams into the shared budget even on legacy media. */
  readonly #authenticated: boolean
  /** Per-task provider execution quotas. */
  readonly #admission: ProviderAdmissionRegistry
  /** Opt-in runtime sessions borrow one logical-provider scope; ordinary quotas stay endpoint-local. */
  readonly #runtimeAdmission: ProviderAdmissionRegistry
  /** Active provider abort controllers. */
  readonly #controllers = new Map<string, IRpcProviderController>()
  /** Provider execution owner. */
  readonly #executor: ProviderExecutor<string>
  /** Narrow outbound facts and operations owned by the outbound feature. */
  readonly #outbound: IRpcOutboundOperationsPort
  /** Verified variation and cancellation owner. */
  readonly #variations: IRpcVariationCoordinatorPort
  /** Kernel lifecycle operations remain owned by the composed endpoint. */
  readonly #kernel: IEndpointKernelHost
  /** Immutable endpoint identity snapshot used by provider request admission. */
  readonly #id: string
  /** Immutable target snapshot used by provider dispatch. */
  readonly #targetIds: readonly string[]
  /** Receiver identity snapshot used by provider request admission. */
  readonly #receiverId: string
  /** Read-only selected-framer observation; provider never owns reassembly state. */
  readonly #chunks: number | undefined
  /** Release callback for the provider-owned abort variation handler. */
  readonly #releaseAbortHandler: () => void
  /** True only when the `abort()` capability middleware selected this endpoint into cancellation. */
  readonly #abortEnabled: boolean
  /** Canonical endpoint transaction identity used by the package-test passive recorder. */
  readonly #transaction: object

  /** Installs the complete provider security closure before the receiver becomes active. */
  constructor(
    kernel: IEndpointKernelHost,
    ports: IRpcProviderPorts,
    prepared: IPreparedEndpoint<string>,
    admission?: IProviderAdmissionScope,
    commitPolicy?: () => boolean
  ) {
    this.#kernel = kernel
    this.#chunks = readSelectedFramerChunks(prepared.options.components!)
    this.#outbound = ports.outboundOperations
    this.#variations = ports.variationCoordinator
    this.#id = prepared.id
    this.#targetIds = Object.freeze([...(prepared.options.targetIds ?? [])])
    const uniqueTargetId = prepared.options.connect?.uniqueTargetId
    this.#receiverId =
      kernel.platform === RpcPlatform.broadcastChannel && typeof uniqueTargetId === 'string'
        ? `${prepared.id}:${uniqueTargetId}`
        : prepared.id
    this.#abortEnabled = prepared.options.features?.abort === true
    /** Capacity comes from the actual selected framer, never a caller-provided ingress number. */
    const maxIngress =
      prepared.options.components!.ingressPrepare.singleFrameLimits?.maxConcurrentMessages
    this.#admission = new ProviderAdmissionRegistry(
      prepared.options.providerLimits?.maxGlobal ?? 256,
      prepared.options.providerLimits?.maxPerPeer ?? 64,
      maxIngress
    )
    this.#runtimeAdmission = admission
      ? prepareProviderAdmissionScope(
          admission,
          prepared.options.providerLimits?.maxGlobal,
          prepared.options.providerLimits?.maxPerPeer,
          maxIngress,
          commitPolicy?.() ?? true
        )
      : this.#admission
    if (
      prepared.options.providerLimits?.onRejected !== undefined &&
      typeof prepared.options.providerLimits.onRejected !== 'function'
    )
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.providerAdmissionObserverMustBeAFunction),
        RpcCoreErrorCode.invalidConfig
      )
    this.#transaction = kernel
    this.#authenticated = prepared.options.authentication !== undefined
    this.#replay = new RequestReplayLedger(
      4096,
      prepared.options.providerLimits?.maxReplayEntriesPerPeer ?? 1024,
      310_000,
      undefined,
      () => {
        /** This is a pure mode read; owner observations precede admission/settlement. */
        const receipt = nativeReplayReceipt(kernel.transport)
        return receipt && !receipt.active ? undefined : receipt?.qualified === true
      }
    )
    this.#executor = new ProviderExecutor({
      fast: hasFastEndpoint(prepared.options),
      /** Borrow only the once-selected factory response format, never caller/wire policy. */
      responseError: selectedJsonObjectPort(prepared.options.components!)?.responseError,
      timestamp: () => kernel.time.timestamp(),
      now: () => kernel.time.now(),
      setTimeout: (task, delayMs) => kernel.time.setTimeout(task, delayMs),
      clearTimeout: (timer) => kernel.time.clearTimeout(timer),
      idempotencyStore: prepared.options.idempotency?.store ?? createRpcIdempotencyStore(),
      runtimeDefaultMemoryStore: prepared.options.idempotency?.store === undefined,
      idempotencyScope: prepared.options.idempotency?.scope,
      id: this.#id,
      registry: this.#registry,
      controllers: this.#controllers,
      admission: this.#admission,
      /** Observe numeric capacity locally, then preserve the original callback result and cause. */
      onRejected: (rejection) => {
        if (rejection.reason === RpcProviderRejectionReason.replayLedgerFull) {
          /** Admission has already purged expired entries; this O(1) snapshot cannot change it. */
          const capacity = this.#replay.readCapacity(rejection.verifiedPeerKey)
          if (capacity.occupancy >= capacity.limit || capacity.peerOccupancy >= capacity.peerLimit)
            this.#outbound.send({
              kind: 'report',
              error: new RpcError(
                RpcCoreErrorCode.overloaded,
                RpcCoreErrorText.requestReplayLedgerIsFull
              ),
              code: RpcCoreErrorCode.overloaded,
              detail: Object.freeze({
                namespace: RpcReplayCapacityNamespace.inbound,
                reason: RpcProviderRejectionReason.replayLedgerFull,
                ...capacity
              })
            })
        }
        return prepared.options.providerLimits?.onRejected?.(rejection)
      },
      peers: this.#targetIds,
      dispatch: (targetId, method, data) => {
        this.#outbound.send({ kind: 'dispatch', targetId, method, data })
      },
      send: (response, transfer) =>
        this.#outbound.send({
          kind: 'response',
          message: toCanonicalResponse(response),
          transfer
        }),
      validate: (method, side, data) =>
        this.#outbound.send({ kind: 'validate', method, side, data }),
      emitFailure: (error, code) => {
        this.#outbound.send({ kind: 'report', error, code })
      },
      isReplay: (request, peerKey) =>
        this.#replay.has(
          tupleKey(peerKey, request.route.route.senderId, request.envelope.id),
          kernel.time.scheduler.now()
        ),
      admitReplay: (request, peerKey) =>
        this.#replay.admit(
          tupleKey(peerKey, request.route.route.senderId, request.envelope.id),
          peerKey,
          kernel.time.scheduler.now(),
          nativeReplayReceipt(kernel.transport)?.qualified === true &&
            (!this.#authenticated || hasAuthenticationReplayBinding(request.envelope))
        ),
      consumePendingAbort: (key, association) =>
        this.#variations.admit({
          operation: 'consumeAbort',
          key,
          association
        }) as IRpcEarlyProviderIntent,
      /** Source-less authentication binds the response to the exact admitted client receiver. */
      responseReceiverId: (request) =>
        authenticationReplyReceiverId(request.envelope) ?? request.route.route.senderId
    })
    /** Physical retirement drops only this provider's ledger before any late cleanup can return. */
    const native = nativeReplayReceipt(kernel.transport)
    if (native)
      kernel.resources.addSync(
        NativeDefaultIdText.providerTerminalSubscription,
        native.onRetire(() => this.#replay.clear())
      )
    if (kernel.readOwner(EndpointOwnerKey.outboundAttachment))
      kernel.registerOwner(EndpointOwnerKey.providerAttachment, this)
    kernel.registerOwner(EndpointOwnerKey.providerRegistry, this.#registry)
    kernel.registerOwner('request-replay', this.#replay)
    kernel.registerOwner(EndpointOwnerKey.providerAdmission, this.#runtimeAdmission)
    kernel.registerOwner('provider-controllers', this.#controllers)
    kernel.registerOwner('provider-executor', this.#executor)
    kernel.registerRoute(RpcMessageKind.request, (message) => this.#receiveRequest(message))
    kernel.registerRoute(RpcRuntimeKind.call, (message) => this.#receiveRuntime(message))
    kernel.registerRoute(RpcRuntimeKind.group, (message) => this.#receiveRuntime(message))
    this.#releaseAbortHandler = this.#variations.admit({
      operation: 'register',
      variation: RpcControl.abort,
      handler: (message, peerKey) => this.#receiveAbort(message, peerKey)
    }) as () => void
    for (const [method, provider] of snapshotProviderEntries(prepared.providers))
      this.provide(method, provider)
  }

  /** Registers one provider and preserves duplicate-owner failure semantics. */
  provide(method: string, provider: IRpcProvider): this {
    this.#kernel.assertActive()
    if (typeof method !== 'string' || method.length === 0 || typeof provider !== 'function')
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.providerDescriptorInvalid)
    if (!this.#registry.register(method, provider))
      throw new RpcError(
        RpcCoreErrorCode.providerDuplicated,
        RpcCoreErrorText.providerDuplicated(method)
      )
    recordProviderRegistration(this.#transaction, method, provider)
    return this
  }

  /** Transfers one method to the stream owner without duplicating request admission. */
  provideStream(
    method: string,
    handler: (
      message: unknown,
      createContext: (signal: IRpcAbortSignal) => IRpcContext
    ) => void | Promise<void>
  ): () => void {
    this.#kernel.assertActive()
    if (typeof method !== 'string' || method.length === 0 || typeof handler !== 'function')
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.providerDescriptorInvalid)
    if (!this.#registry.registerStream(method, handler))
      throw new RpcError(
        RpcCoreErrorCode.providerDuplicated,
        RpcCoreErrorText.providerDuplicated(method)
      )
    return () => {
      if (this.#registry.streamProviders.get(method) === handler)
        this.#registry.streamProviders.delete(method)
    }
  }

  /** Registers an inbound dispatch listener in the same provider registry as request handlers. */
  on(event: string, listener: IRpcEventListener): () => void {
    this.#kernel.assertActive()
    assertContractMethod(event)
    if (typeof listener !== 'function')
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.eventListenerInvalid)
    return this.#registry.listen(event, listener)
  }

  /** Aborts the active provider task identified by its canonical task key or task id. */
  abort(id: string): void {
    const direct = this.#controllers.get(id)
    if (direct) {
      direct.abort()
      return
    }
    for (const [key, controller] of this.#controllers) {
      let parts: unknown
      try {
        parts = JSON.parse(key)
      } catch {
        continue
      }
      if (Array.isArray(parts) && parts[2] === id) controller.abort()
    }
  }

  /** Extends outbound live counts with the provider security closure's current ownership. */
  debugSnapshot(): IRpcEndpointDebugSnapshot {
    /**
     * Keeps provider-only counters available to provider RED evidence without widening the
     * enumerable endpoint snapshot consumed by the pre-existing B12b04 exact-shape contracts.
     */
    const snapshot: IRpcEndpointDebugSnapshot = {
      phase: this.#kernel.state === 'disposed' ? 'disposed' : 'active',
      pending: 0,
      pingPending: 0,
      chunks: this.#chunks,
      hooks: 0,
      resources: this.#kernel.resources.size,
      owners: this.#kernel.ownerKeys,
      discovery: {
        local: 0,
        remote: 0,
        waiters: 0,
        tasks: 0,
        timers: 0,
        manualWaiters: 0,
        inboundQueries: 0,
        inboundTimers: 0
      },
      activeControllers: this.#controllers.size,
      providers: this.#registry.providers.size,
      events: this.#registry.listenerCount
    }
    Object.defineProperty(snapshot, 'providerState', {
      configurable: false,
      enumerable: false,
      value: Object.freeze({ admission: this.#admission.size, replay: this.#replay.size }),
      writable: false
    })
    Object.defineProperty(snapshot, RpcDebugProperty.replayState, {
      value: Object.freeze({
        active: this.#replay.activeSize,
        completed: this.#replay.size - this.#replay.activeSize
      })
    })
    return snapshot
  }

  /** Releases all security and callback owners during reverse feature disposal. */
  dispose(): void {
    this.#releaseAbortHandler()
    for (const controller of this.#controllers.values()) controller.abort()
    this.#controllers.clear()
    this.#registry.clear()
    this.#replay.clear()
    this.#admission.clear()
  }

  /**
   * Cancels only the provider task named by a source-verified abort variation. Gated on
   * `#abortEnabled` exactly like legacy `src/endpoint.ts`'s `#features.abort === true` check: a
   * receiver that never selected the `abort()` middleware must not cancel an active controller or
   * record an early-abort tombstone, even though the variation route stays registered (matching the
   * legacy single always-listening receiver).
   */
  #receiveAbort(message: unknown, peerKey: string): void {
    if (!this.#abortEnabled) return
    const record = message as { envelope?: IRpcEnvelope; route?: IRpcEnvelopeData }
    const envelope = record.envelope
    const route = record.route
    if (envelope?.kind !== 'variation' || route?.route.type !== 'variation') return
    const key = tupleKey(peerKey, route.route.senderId, envelope.id)
    this.#variations.admit({
      operation: 'abort',
      key,
      controller: this.#controllers.get(key),
      expiresAt: this.#kernel.time.now() + 310_000,
      reason: decodeAbortReason(
        route.payload,
        (error) =>
          this.#outbound.send({ kind: 'report', error, code: RpcCoreErrorCode.protocolInvalid }),
        (pointer, field) =>
          this.#outbound.noteUnknownField(peerKey, 'variation', `/data/payload${pointer}`, field)
      )
    })
  }

  /** Verifies source identity, rejects replay, and executes one provider request. */
  async #receiveRuntime(message: unknown): Promise<void> {
    const record = message as {
      envelope: IRpcRuntimeEnvelope
      admission: IInboundIdentityAdmission
    }
    if (this.#kernel.state !== 'active') return
    const outbound = this.#kernel.readOwner(
      EndpointOwnerKey.outboundAttachment
    ) as RpcOutboundAttachment
    const generation = outbound.runtimeGeneration
    const callerGeneration = outbound.inboundIdentity.readGeneration(record.admission.token)
    if (!generation || !callerGeneration)
      throw new RpcError(
        RpcCoreErrorCode.providerGenerationMismatch,
        RpcCoreErrorText.providerGenerationMismatch
      )
    const native = nativeReplayReceipt(this.#kernel.transport)
    await this.#executor.executeRuntime(record.envelope, record.admission.token, {
      generation,
      callerGeneration,
      admission: this.#runtimeAdmission,
      replay: this.#replay,
      activeReplay:
        native?.qualified === true &&
        (!this.#authenticated || hasAuthenticationReplayBinding(record.envelope)),
      replyReceiverId:
        authenticationReplyReceiverId(record.envelope) ?? record.envelope.route.senderId,
      send: (envelope, onPrepared) => outbound.sendRuntimeFrame(envelope, undefined, onPrepared)
    })
  }

  /** The original controller map remains the authority for a same-hop cancel intent. */
  async receiveRuntimeOutcome(message: unknown): Promise<void> {
    const record = message as {
      envelope: IRpcRuntimeEnvelope
      admission: IInboundIdentityAdmission
    }
    const outbound = this.#kernel.readOwner(
      EndpointOwnerKey.outboundAttachment
    ) as RpcOutboundAttachment
    const generation = outbound.runtimeGeneration
    const callerGeneration = outbound.inboundIdentity.readGeneration(record.admission.token)
    if (!generation || !callerGeneration)
      throw new RpcError(
        RpcCoreErrorCode.providerGenerationMismatch,
        RpcCoreErrorText.providerGenerationMismatch
      )
    await this.#executor.lookupRuntime(record.envelope, record.admission.token, {
      generation,
      callerGeneration,
      replay: this.#replay,
      replyReceiverId:
        authenticationReplyReceiverId(record.envelope) ?? record.envelope.route.senderId,
      send: (envelope) => outbound.sendRuntimeFrame(envelope)
    })
  }

  /** The original controller map remains the authority for a same-hop cancel intent. */
  async receiveRuntimeControl(message: unknown): Promise<void> {
    const record = message as {
      envelope: IRpcRuntimeEnvelope
      admission: IInboundIdentityAdmission
    }
    const envelope = record.envelope
    if (
      envelope.kind !== RpcRuntimeKind.control ||
      (envelope.operation !== RpcRuntimeOperation.cancel &&
        envelope.operation !== RpcRuntimeOperation.stream)
    )
      return
    const key = tupleKey(record.admission.token, envelope.route.senderId, envelope.id)
    const controller = this.#controllers.get(key)
    const association = runtimeTaskKey(envelope.task)
    if (
      controller &&
      (!controller.runtimeTask || runtimeTaskKey(controller.runtimeTask) !== association)
    )
      return
    const outbound = this.#kernel.readOwner(
      EndpointOwnerKey.outboundAttachment
    ) as RpcOutboundAttachment
    const generation = outbound.runtimeGeneration
    const callerGeneration = outbound.inboundIdentity.readGeneration(record.admission.token)
    if (
      !generation ||
      !callerGeneration ||
      runtimeTaskKey({ ...envelope.task, callerGeneration, targetGeneration: generation }) !==
        association
    )
      throw new RpcError(
        RpcCoreErrorCode.providerGenerationMismatch,
        RpcCoreErrorText.providerGenerationMismatch
      )
    if (envelope.operation === RpcRuntimeOperation.stream) {
      if (controller?.streamIntent) await controller.streamIntent(envelope.stream)
      else if (envelope.stream.event === 'finish-without-items') {
        /** The original bounded intent slot waits for the call's authenticated before-start option. */
        if (envelope.stream.seq !== 0) throw invalidRpcStream(RpcStreamViolation.seq, '/stream/seq')
        outbound.variations.abort(
          key,
          undefined,
          this.#kernel.time.now() + 310_000,
          envelope.stream.reason === undefined
            ? undefined
            : deserializeRpcError(envelope.stream.reason),
          association,
          true
        )
      }
      return
    }
    const reason = envelope.reason === undefined ? undefined : deserializeRpcError(envelope.reason)
    outbound.variations.abort(
      key,
      controller ? { abort: (cause) => controller.cancelIntent?.(cause) } : undefined,
      this.#kernel.time.now() + 310_000,
      reason,
      association
    )
  }

  /** Verifies source identity, rejects replay, and executes one provider request. */
  async #receiveRequest(message: unknown): Promise<void> {
    const record = message as {
      envelope?: IRpcEnvelope
      route?: IRpcEnvelopeData
      inbound?: IProviderInbound
      admission?: IInboundIdentityAdmission
    }
    const request = record.envelope
    const route = record.route
    if (
      !request ||
      request.kind !== 'request' ||
      route?.route.type !== 'request' ||
      route.route.targetId !== this.#id ||
      route.route.receiverId !== this.#receiverId
    )
      return
    if (this.#kernel.state !== 'active') return
    if (!record.admission) return
    const stream = this.#registry.streamProviders.get(request.method)
    if (stream) {
      /** Forward refusals occur before stream replay/admission; the original stream owner replies. */
      try {
        readProviderPreflight(stream)?.(route.route)
      } catch (error) {
        await stream({ ...record, preflightError: error }, (signal) =>
          this.#executor.createContext({ envelope: request, route }, signal, () => signal.aborted)
        )
        return
      }
      /** Unauthenticated unsupported streams retain their original stream-only budget behavior. */
      const native = nativeReplayReceipt(this.#kernel.transport)
      if (!native && !this.#authenticated) {
        await stream(record, (signal) =>
          this.#executor.createContext({ envelope: request, route }, signal, () => signal.aborted)
        )
        return
      }
      /** One shared business identity protects open, next, return and terminal send settlement. */
      const key = tupleKey(record.admission.token, route.route.senderId, request.id)
      if (this.#replay.has(key, this.#kernel.time.scheduler.now())) return
      if (
        !this.#replay.admit(
          key,
          record.admission.token,
          this.#kernel.time.scheduler.now(),
          native?.qualified === true &&
            (!this.#authenticated || hasAuthenticationReplayBinding(request)),
          true
        )
      ) {
        this.#executor.notifyReplayCapacityRejection(
          { envelope: request, route },
          record.admission.token
        )
        await stream({ ...record, replayRejected: true }, (signal) =>
          this.#executor.createContext({ envelope: request, route }, signal, () => signal.aborted)
        )
        return
      }
      /** Capture exact admission ownership before any asynchronous stream construction or cleanup. */
      const release = this.#replay.captureRelease(key)
      try {
        await stream({ ...record, activeLifetime: true }, (signal) =>
          this.#executor.createContext({ envelope: request, route }, signal, () => signal.aborted)
        )
      } finally {
        native?.observeOwner()
        release(this.#kernel.time.scheduler.now())
      }
      return
    }
    /** Executor admission happens synchronously before its first await; duplicates own no new lease. */
    const key = tupleKey(record.admission.token, route.route.senderId, request.id)
    /** A duplicate must never capture the original operation's release closure. */
    const duplicate = this.#replay.has(key, this.#kernel.time.scheduler.now())
    /** Start the canonical executor before capturing its actual admitted entry identity. */
    const executing = this.#executor.execute({ envelope: request, route }, record.admission.token)
    /** A captured closure compares exact entry identity after asynchronous completion. */
    const release = duplicate ? undefined : this.#replay.captureRelease(key)
    try {
      await executing
    } finally {
      nativeReplayReceipt(this.#kernel.transport)?.observeOwner()
      release?.(this.#kernel.time.scheduler.now())
    }
  }
}

/** Decode a present abort payload while keeping cancellation effective on malformed input. */
function decodeAbortReason(
  payload: unknown,
  report: (error: unknown) => void,
  onUnknownField: (pointer: string, field: string) => void
): unknown {
  if (payload === undefined) return undefined
  try {
    return deserializeRpcError(payload, { unknownFields: 'ignore', onUnknownField })
  } catch (error) {
    report(error)
    return error
  }
}

/** Maps the provider executor's private result record into the sole RPC envelope authority. */
function toCanonicalResponse(response: unknown): IRpcEnvelope {
  const current = response as {
    readonly version: string
    readonly taskId: string
    readonly senderId: string
    readonly targetId: string
    readonly receiverId?: string
    readonly method: string
    readonly ok: boolean
    readonly data?: unknown
    readonly message?: string
    readonly code?: string
    readonly serializedError?: IRpcSerializedError
    readonly sentAt: number
  }
  const route = {
    profile: RpcRouteProfile,
    type: 'response' as const,
    applicationVersion: current.version,
    senderId: current.senderId,
    targetId: current.targetId,
    ...(current.receiverId === undefined ? {} : { receiverId: current.receiverId }),
    sentAt: current.sentAt,
    method: current.method,
    ...(current.message === undefined ? {} : { message: current.message })
  }
  if (current.ok)
    return createOutboundEnvelope({
      kind: 'response',
      ok: true,
      id: current.taskId,
      data: {
        route: route,
        ...(current.data === undefined ? {} : { payload: current.data })
      } as never
    })
  return createOutboundEnvelope({
    kind: 'response',
    ok: false,
    id: current.taskId,
    code: current.code ?? RpcCoreErrorCode.internal,
    message: current.message ?? RpcCoreErrorText.remoteRequestFailed,
    data: {
      route: route,
      ...(current.data === undefined ? {} : { payload: current.data })
    } as never,
    ...(current.serializedError === undefined ? {} : { error: current.serializedError })
  })
}

/** Snapshots provider entries once and preserves the original getter failure as the cause. */
function snapshotProviderEntries(
  providers: Readonly<Record<string, IRpcProvider>> | undefined
): readonly (readonly [string, IRpcProvider])[] {
  try {
    return Object.entries(providers ?? {})
  } catch (error) {
    throw new RpcConfigurationError(RpcCoreErrorText.providerDescriptorInvalid, error)
  }
}
