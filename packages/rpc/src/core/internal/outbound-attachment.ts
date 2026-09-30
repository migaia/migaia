import { RpcPlatform } from '../transport-constants.js'
import {
  RpcAbortError,
  RpcContractError,
  RpcError,
  RpcCoreErrorCode,
  RpcLifecycleError,
  RpcRemoteError,
  RpcProtocolError,
  RpcTimeoutError,
  tagRpcError
} from '../errors.js'
import { RpcMessageKind } from '../semantic-constants.js'
import { RpcCoreErrorText } from '../error-text.js'
import type {
  IRpcFanoutResult,
  IRpcHook,
  IRpcHookEvent,
  IRpcAuthenticationCapability,
  IRpcContractCapability,
  IRpcTimeoutCapability,
  IRpcUuidConfig,
  ISendOptions
} from '../typing.js'
import { assertContractMethod as assertMethod, validateContractData } from './contract.js'
import {
  normalizePortable,
  normalizeRpcEnvelope,
  RpcControl,
  RpcEnvelopeKind,
  RpcRouteProfile,
  RpcWireLimit,
  type IRpcEnvelope,
  type IRpcEnvelopeData,
  type IRpcPortableValue,
  type IRpcResponseFailure,
  type IRpcWireErrorFailure
} from '../../contract/index.js'
import { createRpcUnknownFieldWarner } from '../../contract/unknown-field.js'
import { deserializeRpcError, serializeRpcError } from '../../contract/error.js'
import { RpcProtocolEvent } from '../protocol-constants.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IRpcInboundMessage } from '../transport.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import { HookRegistry } from './hooks.js'
import { allocateRpcId } from './id.js'
import { PendingRegistry } from './pending.js'
import { RpcOutboundSender } from './outbound-sender.js'
import { outboundGateMatchesFeature, readOutboundGate } from './outbound-gate.js'
import type { IRpcOutboundGate } from './outbound-gate.js'
import { ReplayWindow } from './replay.js'
import { OperationScope } from './operation-scope.js'
import { InboundIdentityCoordinator, type IInboundIdentityAdmission } from './inbound-identity.js'
import { RpcVariationCoordinator } from './variation-coordinator.js'
import { createSafeRecord, fanoutDeliveryKey } from './safe-value.js'
import { readSelectedFramerChunks, type IRpcEndpointDebugSnapshot } from './test-observer.js'
import type { IRpcDiscoveryResolverPort } from './plugin-shared-keys.js'
import type { IRpcFrameAdmission, IRpcStreamOpenCommand } from './plugin-shared-keys.js'
import type { IEndpointTimer } from './time-port.js'
import { createEndpointTransportActivation } from './transport-activation.js'

/** One pending slim-client request and its terminal cleanup handles. */
type IOutboundPending = {
  readonly targetId: string
  readonly method: string
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  readonly cleanup: () => void
}

/** Receiver identity selected for one logical target before a frame is emitted. */
export type IOutboundReceiver = {
  readonly receiverId: string
  readonly verifiedPeerKey?: string
}

/** Shared runtime contract exposed to the provider security attachment. */
export type IOutboundAttachmentHost = {
  readonly id: string
  /** Receiver identity advertised by discovery and required on inbound frames. */
  readonly receiverId: string
  readonly kernel: IEndpointKernelHost
  readonly targetIds: readonly string[]
  sendFrame(
    message: IRpcEnvelope,
    transfer?: readonly unknown[],
    admission?: IRpcFrameAdmission
  ): Promise<void>
  sendStreamOpen(command: IRpcStreamOpenCommand): Promise<void>
  onTransportFailure(listener: (error: unknown) => void): () => void
  dispatch(targetId: string, method: string, data: unknown): void
  sendOneWay(
    targetId: string,
    method: string,
    data: unknown,
    options?: { readonly transfer?: readonly unknown[] }
  ): Promise<void>
  readonly hooks: { on(listener: IRpcHook): () => void }
  emitFailure(error: unknown, code?: string): void
  emitDiagnostic(event: Omit<IRpcHookEvent, 'at' | 'localId'>): void
  noteUnknownField(connection: string, kind: string, pointer: string, field: string): void
  readonly inboundIdentity: InboundIdentityCoordinator
  readonly variations: RpcVariationCoordinator
  send<T>(targetId: string, method: string, data: unknown, options?: ISendOptions): Promise<T>
  sendAll<T>(method: string, data: unknown, options?: ISendOptions): Promise<IRpcFanoutResult<T>>
  dispatchAll(method: string, data: unknown): void
  setReceiverResolver(resolver: (targetId: string) => Promise<IOutboundReceiver>): void
  resolveReceiver(targetId: string, receiverId?: string): Promise<IOutboundReceiver>
  validate(method: string, side: 'params' | 'result', data: unknown): void
  debugSnapshot(): IRpcEndpointDebugSnapshot
}

/** Canonical outbound/client owner attached to one endpoint kernel. */
export class RpcOutboundAttachment implements IOutboundAttachmentHost {
  /** Validated endpoint identifier. */
  readonly id: string
  /** Stable local receiver identity used by multiplexed discovery routing. */
  readonly receiverId: string
  /** One kernel shared by all selected attachments. */
  readonly kernel: IEndpointKernelHost
  /** Immutable configured remote target set. */
  readonly targetIds: readonly string[]
  /** Contract version placed on outbound requests. */
  readonly #version: string
  /** Identifier generator snapshot installed by middleware. */
  readonly #uuid: IRpcUuidConfig
  /** Contract validation owner shared with provider execution. */
  readonly #validateData: IRpcContractCapability['validateData']
  /** Validated canonical descriptors retained for the endpoint lifetime. */
  readonly #components: import('./endpoint-options.js').IRpcSelectedComponents
  /** Optional inbound/outbound protection capability. */
  readonly #authentication: IRpcAuthenticationCapability | undefined
  /** Canonical dynamic timeout capability installed by middleware. */
  readonly #timeout: IRpcTimeoutCapability
  /** Enables caller abort semantics only when the abort capability is selected. */
  readonly #abortEnabled: boolean
  /** Outbound transport/protocol pipeline. */
  readonly #pipeline: RpcOutboundSender
  /** Optional wrapper-owned whole-envelope gate selected before the sender is constructed. */
  readonly #outboundGate: IRpcOutboundGate | undefined
  /** Active request settlements keyed by wire task id. */
  readonly #pending = new PendingRegistry<IOutboundPending>()
  /** Optional stream owners observe the same canonical transport failure as requests. */
  #transportFailureListener: ((error: unknown) => void) | undefined
  /** Prevents active and recently released task-id reuse. */
  readonly #replay: ReplayWindow
  /** Hook callbacks owned by the outbound runtime. */
  readonly #hooks = new HookRegistry()
  /** Per-connection warning cache for additive fields and unknown control subtypes. */
  readonly #unknownFields = createRpcUnknownFieldWarner({
    warn: (_connection, field) =>
      this.emitDiagnostic({ name: RpcProtocolEvent.unknownField, field })
  })

  /** Route control payload warnings through the same per-connection cache as envelope fields. */
  noteUnknownField(connection: string, kind: string, pointer: string, field: string): void {
    this.#unknownFields.note(connection, kind, pointer, field)
  }
  /** Shared inbound source-proof/connect/binding owner for all selected features. */
  readonly inboundIdentity: InboundIdentityCoordinator
  /** Shared variation route and admission owner for optional feature handlers. */
  readonly variations: RpcVariationCoordinator
  /** Pins each logical target to the first verified response source in the slim runtime. */
  readonly #responseBindings = new Map<string, string>()
  /** Optional discovery-backed receiver selector; target identity is safe default. */
  #receiverResolver: (targetId: string) => Promise<IOutboundReceiver> = async (targetId) => ({
    receiverId: targetId
  })
  /** Reads the later-installed discovery resolver without publishing a broad owner port. */
  readonly #discoveryResolver: (() => IRpcDiscoveryResolverPort | undefined) | undefined
  /** Canonical hook failure reporter snapshotted during construction. */
  readonly #hookErrorReporter: ((error: unknown, event: IRpcHookEvent) => void) | undefined
  /** Indicates that activation installed the physical receiver. */
  #activated = false
  /** Stable feature-result disposal Promise; root kernel disposal is owned by the kernel plugin. */
  #featureDisposePromise: Promise<void> | undefined

  /** Creates outbound owners without subscribing; provider may install its routes first. */
  constructor(
    kernel: IEndpointKernelHost,
    prepared: IPreparedEndpoint<string>,
    discoveryResolver?: () => IRpcDiscoveryResolverPort | undefined
  ) {
    this.kernel = kernel
    this.variations = new RpcVariationCoordinator(
      () => kernel.time.now(),
      () => kernel.time.scheduler.now()
    )
    this.#discoveryResolver = discoveryResolver
    this.id = prepared.id
    this.targetIds = Object.freeze([...(prepared.options.targetIds ?? [])])
    this.#replay = new ReplayWindow(
      () => kernel.time.scheduler.now(),
      prepared.options.replay?.maxEntries,
      prepared.options.replay?.ttlMs
    )
    const contract = prepared.options.contract ?? {}
    this.#version = contract.version ?? '1.0'
    const uniqueTargetId = prepared.options.connect?.uniqueTargetId
    this.receiverId =
      kernel.platform === RpcPlatform.broadcastChannel && typeof uniqueTargetId === 'string'
        ? `${this.id}:${uniqueTargetId}`
        : this.id
    this.#validateData =
      'validateData' in contract && contract.validateData
        ? (contract.validateData as IRpcContractCapability['validateData'])
        : (method, side, data) => validateContractData(contract, method, side, data)
    this.#uuid = prepared.options.uuid ?? {}
    this.#components = prepared.options.components!
    this.#authentication = prepared.options.authentication
    this.#hookErrorReporter = prepared.options.hooks?.onHookError
    this.#abortEnabled = prepared.options.features?.abort === true
    const timeout = prepared.options.timeout ?? {}
    const timeoutDefault = timeout.timeoutMs ?? 1000
    this.#timeout = {
      ...timeout,
      resolveTimeout:
        'resolveTimeout' in timeout && timeout.resolveTimeout
          ? (timeout.resolveTimeout as IRpcTimeoutCapability['resolveTimeout'])
          : (override) => (override === undefined ? timeoutDefault : override)
    }
    this.#outboundGate = readOutboundGate(kernel.transport)
    this.#pipeline = new RpcOutboundSender(
      kernel,
      this.id,
      this.#components,
      prepared.options.authentication,
      kernel.platform,
      this.#outboundGate
    )
    this.inboundIdentity = new InboundIdentityCoordinator({
      now: () => kernel.time.scheduler.now(),
      connect:
        prepared.options.connect && 'verify' in prepared.options.connect
          ? prepared.options.connect
          : undefined,
      sourceProof: kernel.transport.sourceProof,
      reportRead: ({ key, error }) => {
        this.emitFailure(
          error,
          RpcCoreErrorCode.transport,
          typeof key === 'string' ? key : undefined
        )
        return undefined
      },
      platform: kernel.platform,
      topology: kernel.topology
    })
    kernel.registerOwner('outbound-pipeline', this.#pipeline)
    kernel.registerOwner('pending-registry', this.#pending)
    kernel.registerOwner('replay-window', this.#replay)
    kernel.registerOwner('hook-registry', this.#hooks)
    kernel.registerOwner('inbound-identity', this.inboundIdentity)
    kernel.registerOwner('variation-coordinator', this.variations)
    kernel.resources.addSync('outbound hook registry', () => this.#hooks.clear())
    kernel.resources.addSync('outbound unknown fields', () => this.#unknownFields.clear())
    kernel.resources.addSync('outbound response bindings', () => this.#responseBindings.clear())
    if (this.#outboundGate) {
      /** Endpoint diagnostics own their subscription until kernel scope release. */
      const unsubscribe = this.#outboundGate.onEvent((event) => {
        const snapshot = event as { readonly name: string; readonly error?: unknown }
        this.emitDiagnostic({ name: snapshot.name, contract: event, error: snapshot.error })
      })
      kernel.resources.addSync('IPC diagnostics', unsubscribe)
    }
    for (const listener of normalizeHooks(prepared.options.hooks?.listeners))
      this.#hooks.add(listener)
    for (const event of prepared.options.initialHookEvents ?? []) this.#emit(event)
    kernel.registerRoute(RpcMessageKind.response, (message) => this.#receiveResponse(message))
    kernel.registerRoute(RpcMessageKind.variation, (message) => this.#receiveVariation(message))
  }

  /** Routes one variation through the shared coordinator after identity admission. */
  async #receiveVariation(message: unknown): Promise<void> {
    const record = message as {
      envelope?: IRpcEnvelope
      route?: IRpcEnvelopeData
      inbound?: import('../transport.js').IRpcInboundMessage
      admission?: IInboundIdentityAdmission
    }
    const envelope = record.envelope
    const route = record.route
    if (
      envelope?.kind !== 'variation' ||
      route?.route.type !== 'variation' ||
      !route.route.variation ||
      (route.route.receiverId !== this.receiverId && route.route.receiverId !== this.id)
    )
      return
    if (!record.admission) return
    const disposition = await this.variations.dispatch(
      route.route.variation,
      `${record.admission.token}:${envelope.id}`,
      message,
      record.admission.token
    )
    if (disposition === 'unknown')
      this.#unknownFields.note(record.admission.token, 'variation', '', route.route.variation)
  }

  /** Installs the one physical receiver after all selected routes exist. */
  activate(): void {
    if (this.#activated) return
    if (!outboundGateMatchesFeature(this.kernel.transport))
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.ipcGateMismatch),
        RpcCoreErrorCode.invalidConfig
      )
    const activation = createEndpointTransportActivation(this.kernel.transport, {
      receive: async (message) => {
        const generation = this.kernel.generation
        if (this.kernel.state !== 'active') return
        const physical = this.inboundIdentity.prepareSource(message)
        if (!physical) return
        let frame = physical.data
        if (this.#authentication)
          frame = await this.#authentication.unprotect(frame, {
            direction: 'inbound',
            endpointId: this.id,
            platform: this.kernel.platform
          })
        this.kernel.assertActive(generation)
        const preparedFrame = this.#components.ingressPrepare(frame, {
          source: physical.sourceToken,
          messageId: 'whole'
        })
        const accepted = this.#components.framer.accept(preparedFrame.frame, {
          source: physical.sourceToken,
          messageId: preparedFrame.messageId
        })
        if (accepted.status === 'pending') return
        if (accepted.status === 'rejected') {
          this.emitFailure(accepted.error, RpcCoreErrorCode.transport)
          return
        }
        const decoded = this.#components.codec.decode(accepted.value)
        let envelope: IRpcEnvelope
        /** Unknown fields are reported after normalize returns its once-read kind. */
        const ignored: Array<readonly [string, string]> = []
        try {
          envelope = this.#components.protocol.normalize(decoded, {
            onUnknownField: (pointer, field) => ignored.push([pointer, field])
          })
        } catch (error) {
          if ((error as { readonly violation?: unknown }).violation === 'unknownKind') {
            this.#unknownFields.note(
              physical.sourceToken,
              'kind',
              '',
              String((error as { readonly unknownKindValue?: unknown }).unknownKindValue)
            )
            return
          }
          this.emitFailure(error, RpcCoreErrorCode.transport)
          return
        }
        for (const [pointer, field] of ignored)
          this.#unknownFields.note(physical.sourceToken, envelope.kind, pointer, field)
        const route = envelope.data
        const admission = await this.inboundIdentity.admitPrepared(physical, {
          senderId: route.route.senderId,
          targetId: route.route.targetId,
          data: route.payload,
          inbound: message
        })
        if (!admission) return
        try {
          this.kernel.assertActive(generation)
          const handled = await this.kernel.dispatchRoute(
            envelope.kind,
            Object.freeze({ envelope, route, inbound: message, admission })
          )
          if (!handled && envelope.kind === RpcEnvelopeKind.stream)
            this.emitFailure(
              new RpcProtocolError(RpcCoreErrorText.streamRouteUnclaimed),
              RpcCoreErrorCode.protocolInvalid
            )
        } finally {
          admission.release()
        }
      },
      transportError: (error) => this.#failAll(error),
      listenerError: (error) => this.emitFailure(error, RpcCoreErrorCode.transport),
      receiveError: (error) => this.emitFailure(error)
    })
    this.kernel.activate(activation)
    this.#activated = true
  }

  /** Sends one request through the canonical single-attempt deadline and cancellation closure. */
  send<T>(targetId: string, method: string, data: unknown, options: ISendOptions = {}): Promise<T> {
    if (
      options.idempotencyKey !== undefined &&
      (typeof options.idempotencyKey !== 'string' ||
        !/^[A-Za-z0-9._:~-]{1,128}$/u.test(options.idempotencyKey))
    )
      throw new RpcContractError(RpcCoreErrorText.idempotencyKeyInvalid)
    if (
      options.trace !== undefined &&
      (typeof options.trace !== 'string' ||
        options.trace.length < 1 ||
        options.trace.length > RpcWireLimit.maxTraceChars ||
        !/^[\x20-\x7E]+$/u.test(options.trace))
    )
      throw new RpcContractError(RpcCoreErrorText.traceInvalid)
    return this.#sendAsync(targetId, method, data, options)
  }

  /** Keep inherited send admission and rejection timing after the new synchronous option gates. */
  async #sendAsync<T>(
    targetId: string,
    method: string,
    data: unknown,
    options: ISendOptions
  ): Promise<T> {
    this.kernel.assertActive()
    const generation = this.kernel.generation
    assertMethod(targetId)
    assertMethod(method)
    this.#validateData(method, 'params', data)
    if (options.signal) {
      const probe = (): void => undefined
      try {
        options.signal.addEventListener('abort', probe, { once: true })
        options.signal.removeEventListener('abort', probe)
      } catch (error) {
        try {
          options.signal.removeEventListener('abort', probe)
        } catch {}
        throw new RpcError(
          RpcCoreErrorCode.invalidConfig,
          RpcCoreErrorText.abortSignalInvalid,
          error
        )
      }
      if (!this.#abortEnabled)
        throw new RpcError(
          RpcCoreErrorCode.middlewareMissing,
          RpcCoreErrorText.abortMiddlewareMissing
        )
      if (options.signal.aborted)
        throw new RpcAbortError(undefined, undefined, options.signal.reason)
    }
    const timeoutMs = this.#timeout.resolveTimeout(options.timeoutMs)
    assertTimeout(timeoutMs)
    const operation = new OperationScope(generation, timeoutMs, this.kernel.closingSignal, () =>
      this.kernel.time.scheduler.now()
    )
    const remaining = operation.remaining(timeoutMs)
    operation.assertActive(this.kernel.generation)
    if (remaining === 0) throw new RpcTimeoutError()
    return this.#requestOnce<T>(
      targetId,
      method,
      data,
      { ...options, timeoutMs: remaining },
      [operation.signal, ...(options.signal ? [options.signal] : [])],
      operation
    ).finally(() => operation.abort())
  }

  /** Owns one request's task id, pending settlement, timeout, and abort listeners. */
  #requestOnce<T>(
    targetId: string,
    method: string,
    data: unknown,
    options: ISendOptions,
    signals: readonly NonNullable<ISendOptions['signal']>[],
    operation: OperationScope
  ): Promise<T> {
    const taskId = allocateRpcId(this.#uuid, 'task', this.id, targetId, (id) =>
      this.#replay.hasReservedId(id)
    )
    if (!this.#replay.reserveId(taskId))
      return Promise.reject(
        new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
      )
    return new Promise<T>((resolve, reject) => {
      let timer: IEndpointTimer | undefined
      let settled = false
      let settlementError: unknown
      let startedSending = false
      const registeredSignals: NonNullable<ISendOptions['signal']>[] = []
      const cleanup = (): void => {
        if (timer !== undefined) this.kernel.time.clearTimeout(timer)
        for (const signal of registeredSignals.reverse()) {
          try {
            signal.removeEventListener('abort', onAbort)
          } catch (error) {
            this.emitFailure(error)
          }
        }
        registeredSignals.length = 0
        this.#pending.delete(taskId)
        this.#replay.releaseId(taskId)
      }
      const settleReject = (error: unknown): void => {
        if (settled) return
        settled = true
        settlementError = error
        cleanup()
        reject(error)
      }
      const settleResolve = (value: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value as T)
      }
      // Matches legacy `notifyRemoteAbort()`: told the remote provider to cancel its active
      // controller whenever this caller settles a request early for a reason the remote cannot
      // otherwise observe (caller abort signal or caller-side timeout) — never on success, remote
      // failure, or transport failure, which the remote already knows about from its own send.
      const notifyRemoteAbort = (reason?: unknown): void => {
        if (!this.#abortEnabled) return
        if (this.#outboundGate && !startedSending) return
        void this.resolveReceiver(targetId)
          .then((receiver) => {
            const payload =
              reason === undefined
                ? undefined
                : normalizeAbortReason(reason, (failure) =>
                    this.emitFailure(failure.error, RpcCoreErrorCode.payloadInvalid)
                  )
            return this.#pipeline.send(
              normalizeRpcEnvelope({
                kind: 'variation',
                id: taskId,
                data: {
                  route: {
                    profile: RpcRouteProfile,
                    type: 'variation',
                    applicationVersion: this.#version,
                    senderId: this.id,
                    targetId,
                    receiverId: receiver.receiverId,
                    sentAt: this.kernel.time.timestamp(),
                    variation: RpcControl.abort
                  },
                  ...(payload === undefined ? {} : { payload })
                }
              })
            )
          })
          .catch((error) => this.#reportOutboundFailure(error))
      }
      const onAbort = (): void => {
        notifyRemoteAbort(registeredSignals.find((signal) => signal.aborted)?.reason)
        settleReject(
          new RpcAbortError(
            undefined,
            undefined,
            registeredSignals.find((signal) => signal.aborted)?.reason
          )
        )
      }
      this.#pending.set(taskId, {
        targetId,
        method,
        resolve: settleResolve,
        reject: settleReject,
        cleanup
      })
      try {
        for (const signal of signals) {
          registeredSignals.push(signal)
          signal.addEventListener('abort', onAbort, { once: true })
          if (signal.aborted) onAbort()
          if (settled) return
        }
      } catch (error) {
        settleReject(
          new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.abortSignalInvalid, error)
        )
        return
      }
      if (settled) return
      if (options.timeoutMs !== false && options.timeoutMs !== undefined)
        timer = this.kernel.time.setTimeout(() => {
          notifyRemoteAbort()
          settleReject(new RpcTimeoutError())
        }, options.timeoutMs)
      void this.resolveReceiver(
        targetId,
        (options as ISendOptions & { receiverId?: string }).receiverId
      )
        .then((receiver) => {
          if (settled) return
          const request = {
            kind: 'request' as const,
            id: taskId,
            method,
            data: {
              route: {
                profile: RpcRouteProfile,
                type: 'request' as const,
                applicationVersion: this.#version,
                senderId: this.id,
                targetId,
                ...(receiver.receiverId === undefined ? {} : { receiverId: receiver.receiverId }),
                sentAt: this.kernel.time.timestamp(),
                ...(options.timeoutMs === false || options.timeoutMs === undefined
                  ? {}
                  : { timeoutMs: Math.ceil(operation.remaining(options.timeoutMs) as number) }),
                ...(options.idempotencyKey === undefined
                  ? {}
                  : { idempotencyKey: options.idempotencyKey }),
                ...(options.trace === undefined ? {} : { trace: options.trace })
              },
              ...(data === undefined ? {} : { payload: data as IRpcPortableValue })
            }
          }
          const assertCanSend = (): void => {
            if (settled) throw settlementError
            if (options.signal?.aborted) throw new RpcAbortError()
            operation.assertActive(this.kernel.generation)
            this.kernel.assertActive()
          }
          return this.#pipeline.send(
            normalizeRpcEnvelope(request),
            options,
            this.#outboundGate
              ? {
                  queueSignal: operation.signal,
                  signals,
                  assertCanSend
                }
              : undefined,
            this.#outboundGate
              ? () => {
                  assertCanSend()
                  const remaining = operation.remaining(options.timeoutMs)
                  if (remaining === 0) throw new RpcTimeoutError()
                  request.data.route.sentAt = this.kernel.time.timestamp()
                  if (typeof remaining === 'number')
                    (request.data.route as { timeoutMs?: number }).timeoutMs = Math.ceil(remaining)
                  return normalizeRpcEnvelope(request)
                }
              : undefined,
            () => {
              startedSending = true
            }
          )
        })
        .catch(settleReject)
    })
  }

  /** Sends one dispatch-only request without creating pending response state. */
  dispatch(targetId: string, method: string, data: unknown): void {
    void this.#sendDispatchOnly(targetId, method, data).catch((error) =>
      this.#reportOutboundFailure(error)
    )
  }

  /** Keeps capacity refusal distinct from a physical transport failure in fire-and-forget paths. */
  #reportOutboundFailure(error: unknown): void {
    this.emitFailure(
      error,
      error instanceof RpcError && error.code === RpcCoreErrorCode.overloaded
        ? RpcCoreErrorCode.overloaded
        : RpcCoreErrorCode.transport
    )
  }

  /** Sends a dispatch-only request and exposes canonical physical completion to the caller. */
  sendOneWay(
    targetId: string,
    method: string,
    data: unknown,
    options?: { readonly transfer?: readonly unknown[] }
  ): Promise<void> {
    return this.#sendDispatchOnly(targetId, method, data, options?.transfer)
  }

  /** Owns all dispatch-only request construction, reservation, physical send and release. */
  #sendDispatchOnly(
    targetId: string,
    method: string,
    data: unknown,
    transfer?: readonly unknown[]
  ): Promise<void> {
    this.kernel.assertActive()
    assertMethod(targetId)
    assertMethod(method)
    this.#validateData(method, 'params', data)
    const taskId = allocateRpcId(this.#uuid, 'message', this.id, targetId, (id) =>
      this.#replay.hasReservedId(id)
    )
    return this.#sendUnansweredRequest({
      id: taskId,
      targetId,
      method,
      data,
      transfer,
      dispatchOnly: true
    })
  }

  /** Emits the initial stream request without a normal response waiter or idempotency key. */
  sendStreamOpen(command: IRpcStreamOpenCommand): Promise<void> {
    this.kernel.assertActive()
    assertMethod(command.targetId)
    assertMethod(command.method)
    this.#validateData(command.method, 'params', command.data)
    return this.#sendUnansweredRequest(command)
  }

  /** Reuse one route header and replay reservation path for dispatch and stream-open. */
  #sendUnansweredRequest(
    command: Readonly<{
      id: string
      targetId: string
      method: string
      data: unknown
      transfer?: readonly unknown[]
      dispatchOnly?: true
      operation?: IRpcStreamOpenCommand['operation']
    }>
  ): Promise<void> {
    if (!this.#replay.reserveId(command.id))
      throw new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.outboundReplayFull)
    return Promise.resolve()
      .then(() => this.resolveReceiver(command.targetId))
      .then((receiver) => {
        if (command.operation?.signal.aborted) throw new RpcAbortError()
        const remaining = command.operation?.remaining()
        const wireTimeout = typeof remaining === 'number' ? Math.floor(remaining) : undefined
        if (wireTimeout === 0) throw new RpcTimeoutError()
        const request = {
          kind: 'request' as const,
          id: command.id,
          method: command.method,
          data: {
            route: {
              profile: RpcRouteProfile,
              type: 'request' as const,
              applicationVersion: this.#version,
              senderId: this.id,
              targetId: command.targetId,
              ...(receiver.receiverId === undefined ? {} : { receiverId: receiver.receiverId }),
              ...(command.dispatchOnly ? { dispatchOnly: true } : {}),
              sentAt: this.kernel.time.timestamp(),
              ...(wireTimeout === undefined ? {} : { timeoutMs: wireTimeout })
            },
            ...(command.data === undefined ? {} : { payload: command.data as IRpcPortableValue })
          }
        }
        const assertCanSend = (): void => {
          this.kernel.assertActive()
          if (command.operation?.signal.aborted) throw new RpcAbortError()
          if (command.operation?.remaining() === 0) throw new RpcTimeoutError()
        }
        return this.#pipeline.send(
          normalizeRpcEnvelope(request),
          command.transfer === undefined ? undefined : { transfer: command.transfer },
          this.#outboundGate && command.operation
            ? {
                queueSignal: command.operation.signal,
                signals: [command.operation.signal],
                assertCanSend
              }
            : undefined,
          this.#outboundGate && command.operation
            ? () => {
                assertCanSend()
                const updated = command.operation?.remaining()
                request.data.route.sentAt = this.kernel.time.timestamp()
                if (typeof updated === 'number')
                  (request.data.route as { timeoutMs?: number }).timeoutMs = Math.ceil(updated)
                return normalizeRpcEnvelope(request)
              }
            : undefined
        )
      })
      .finally(() => this.#replay.releaseId(command.id))
  }

  /** Installs the one discovery-backed selector for all outbound operation kinds. */
  setReceiverResolver(resolver: (targetId: string) => Promise<IOutboundReceiver>): void {
    this.#receiverResolver = resolver
  }

  /** Resolves an explicit receiver or delegates to the endpoint-local discovery owner. */
  resolveReceiver(targetId: string, receiverId?: string): Promise<IOutboundReceiver> {
    if (receiverId !== undefined) return Promise.resolve({ receiverId, verifiedPeerKey: undefined })
    const discoveryResolver = this.#discoveryResolver?.()
    if (discoveryResolver) return discoveryResolver.resolve(targetId)
    return this.#receiverResolver(targetId)
  }

  /** Sends a frame generated by the provider attachment through the canonical pipeline. */
  sendFrame(
    message: IRpcEnvelope,
    transfer?: readonly unknown[],
    admission?: IRpcFrameAdmission
  ): Promise<void> {
    return Promise.resolve().then(() => {
      admission?.assertCanSend()
      return this.#pipeline.send(
        message,
        transfer === undefined ? undefined : { transfer },
        this.#outboundGate && admission
          ? {
              queueSignal: admission.queueSignal,
              signals: admission.queueSignal ? [admission.queueSignal] : [],
              assertCanSend: admission.assertCanSend
            }
          : undefined
      )
    })
  }

  /**
   * Sends one request to every statically configured target. Matches the legacy fanout contract:
   * results are keyed by the canonical `fanoutDeliveryKey` tagged shape and accumulated into a
   * `createSafeRecord` dictionary (a plain `{}` would let an attacker-controlled `__proto__`-shaped
   * target silently mutate the accumulator's prototype instead of appearing as a delivery result),
   * and a `RpcLifecycleError` raised by any individual `send()` (construction/dispose racing the
   * fanout) is rethrown rather than folded into the per-target result, exactly like legacy
   * `sendAll`/`pingAll` and this class's own `pingAll`. Per-receiver keys are not produced here:
   * this composed `sendAll` fans out over the statically configured target list, not a
   * discovery-resolved receiver set (see the discovery-driven receiver resolution gap disclosed in
   * Achievement Review Round 8/9 for `ping`, which the same architecture applies to).
   */
  async sendAll<T>(
    method: string,
    data: unknown,
    options?: ISendOptions
  ): Promise<IRpcFanoutResult<T>> {
    const results = await Promise.allSettled(
      this.targetIds.map(
        async (targetId) => [targetId, await this.send<T>(targetId, method, data, options)] as const
      )
    )
    const lifecycleFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && result.reason instanceof RpcLifecycleError
    )
    if (lifecycleFailure) throw lifecycleFailure.reason
    const fulfilled = createSafeRecord<T>()
    const rejected = createSafeRecord<unknown>()
    results.forEach((result, index) => {
      const key = fanoutDeliveryKey(this.targetIds[index])
      if (result.status === 'fulfilled') fulfilled[key] = result.value[1]
      else rejected[key] = result.reason
    })
    return { fulfilled, rejected }
  }

  /** Dispatches to every configured target. */
  dispatchAll(method: string, data: unknown): void {
    for (const targetId of this.targetIds) this.dispatch(targetId, method, data)
  }

  /** Returns the public hook registration surface. */
  get hooks(): { on(listener: IRpcHook): () => void } {
    return { on: (listener) => this.#hooks.add(listener) }
  }

  /** Reports one diagnostic without allowing reporter failure to re-enter runtime work. */
  emitFailure(error: unknown, code: string = RpcCoreErrorCode.internal, field?: string): void {
    const event = {
      name: 'failure',
      at: this.kernel.time.timestamp(),
      localId: this.id,
      error,
      code,
      ...(field === undefined ? {} : { field })
    }
    this.#emit(event)
    try {
      this.#hookErrorReporter?.(error, event)
    } catch {
      // Diagnostics are observational and cannot change the terminal operation outcome.
    }
  }

  /** Register an optional flow owner without creating another transport subscription. */
  onTransportFailure(listener: (error: unknown) => void): () => void {
    this.#transportFailureListener = listener
    return () => {
      if (this.#transportFailureListener === listener) this.#transportFailureListener = undefined
    }
  }

  /** Emits one package-owned diagnostic through the canonical hook owner. */
  emitDiagnostic(event: Omit<IRpcHookEvent, 'at' | 'localId'>): void {
    this.#emit(Object.freeze({ ...event, at: this.kernel.time.timestamp(), localId: this.id }))
  }

  /** Applies the canonical contract validation snapshot for provider execution. */
  validate(method: string, side: 'params' | 'result', data: unknown): void {
    this.#validateData(method, side, data)
  }

  /** Reads live package-private owner counts for hostile lifecycle verification. */
  debugSnapshot(): IRpcEndpointDebugSnapshot {
    return {
      phase: this.kernel.state === 'disposed' ? 'disposed' : 'active',
      pending: this.#pending.size,
      pingPending: 0,
      activeControllers: 0,
      chunks: readSelectedFramerChunks(this.#components),
      providers: 0,
      events: 0,
      hooks: this.#hooks.size,
      resources: this.kernel.resources.size,
      owners: this.kernel.ownerKeys,
      discovery: {
        local: 0,
        remote: 0,
        waiters: 0,
        tasks: 0,
        timers: 0,
        manualWaiters: 0,
        inboundQueries: 0,
        inboundTimers: 0
      }
    }
  }

  /** Releases outbound-owned state once; the composed kernel plugin closes root resources later. */
  dispose(): Promise<void> {
    if (this.#featureDisposePromise) return this.#featureDisposePromise
    this.#featureDisposePromise = Promise.resolve().then(() => {
      this.kernel.beginClose()
      this.#failAll(new RpcAbortError())
      this.#responseBindings.clear()
      this.#hooks.clear()
      this.#replay.clear()
    })
    return this.#featureDisposePromise
  }

  /** Settles one authenticated response owned by this endpoint. */
  async #receiveResponse(message: unknown): Promise<void> {
    const record = message as {
      envelope?: IRpcEnvelope
      route?: IRpcEnvelopeData
      inbound?: IRpcInboundMessage<unknown>
      admission?: IInboundIdentityAdmission
    }
    const canonical = record.envelope
    const route = record.route
    if (canonical?.kind !== 'response' || route?.route.type !== 'response') return
    if (
      route.route.targetId !== this.id ||
      (route.route.receiverId !== this.receiverId && route.route.receiverId !== this.id)
    )
      return
    const method = route.route.method
    if (typeof method !== 'string') return
    const pending = this.#pending.get(canonical.id)
    if (!pending || pending.targetId !== route.route.senderId || pending.method !== method) return
    const binding = record.admission?.bindingKey
    if (!binding || this.kernel.state !== 'active') return
    const existing = this.#responseBindings.get(route.route.senderId)
    if (existing !== undefined && existing !== binding) {
      this.#emit({
        name: 'authentication.rejected',
        at: this.kernel.time.timestamp(),
        localId: this.id,
        code: 'SOURCE_BINDING_CONFLICT'
      })
      return
    }
    this.#responseBindings.set(route.route.senderId, binding)
    if (canonical.ok) {
      try {
        this.#validateData(method, 'result', route.payload)
        pending.resolve(route.payload)
      } catch (error) {
        pending.reject(error)
      }
    } else
      pending.reject(
        restoreRemoteError(canonical, route.payload, (error) =>
          this.emitFailure(error, RpcCoreErrorCode.protocolInvalid)
        )
      )
  }

  /** Rejects and removes every pending operation after transport or lifecycle failure. */
  #failAll(error: unknown): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
    try {
      this.#transportFailureListener?.(error)
    } catch (failure) {
      this.emitFailure(failure)
    }
  }

  /** Emits a hook event while preserving the configured hook-error boundary. */
  #emit(event: IRpcHookEvent): void {
    this.#hooks.emit(event, this.#hookErrorReporter)
  }
}

/** Normalizes configured hook listeners into one immutable iteration snapshot. */
function normalizeHooks(value: IRpcHook | readonly IRpcHook[] | undefined): readonly IRpcHook[] {
  if (value === undefined) return []
  return Object.freeze(Array.isArray(value) ? [...value] : [value as IRpcHook])
}

/** Projects an abort reason through RPC portable/error owners before it crosses the wire. */
function normalizeAbortReason(
  reason: unknown,
  report: (failure: IRpcWireErrorFailure) => void
): IRpcPortableValue {
  return normalizePortable(serializeRpcError(reason, { report }))
}

/** Always settle a failed call, reporting a malformed optional remote error once. */
function restoreRemoteError(
  canonical: IRpcResponseFailure,
  payload: unknown,
  report: (error: unknown) => void
): RpcRemoteError {
  let restored: unknown
  try {
    restored = canonical.error === undefined ? undefined : deserializeRpcError(canonical.error)
  } catch (error) {
    report(error)
    restored = error
  }
  return new RpcRemoteError(
    canonical.code ?? RpcCoreErrorCode.internal,
    canonical.message ?? RpcCoreErrorText.remoteRequestFailed,
    payload,
    restored
  )
}

/** Rejects timeout values outside the inherited finite non-negative domain. */
export function assertTimeout(timeoutMs: number | false | undefined): void {
  if (
    timeoutMs !== undefined &&
    timeoutMs !== false &&
    (!Number.isFinite(timeoutMs) || timeoutMs < 0)
  )
    throw new RpcContractError(RpcCoreErrorText.timeoutInvalid)
}
