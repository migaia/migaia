import {
  WebRpcAbortError,
  WebRpcContractError,
  WebRpcError,
  WebRpcErrorCode,
  WebRpcLifecycleError,
  WebRpcRemoteError,
  WebRpcTimeoutError
} from '../errors.js'
import { WebRpcMessageKind } from '../protocol-constants.js'
import { WebRpcErrorText } from '../error-text.js'
import type {
  IWebRpcEventListener,
  IWebRpcFanoutResult,
  IWebRpcHook,
  IWebRpcHookEvent,
  IWebRpcAuthenticationCapability,
  IWebRpcContractCapability,
  IWebRpcProtocolCapability,
  IWebRpcTimeoutCapability,
  IWebRpcUuidConfig,
  ISendOptions
} from '../typing.js'
import { assertMethod, normalizeWebRpcEnvelope, type IWebRpcResponse } from '../wire.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IWebRpcInboundMessage } from '../transport.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import { HookRegistry } from './hooks.js'
import { allocateRpcId } from './id.js'
import { validateContractData } from './contract.js'
import { PendingRegistry } from './pending.js'
import { WebRpcOutboundSender } from './outbound-sender.js'
import { ReplayWindow } from './replay.js'
import { splitUtf8, utf8ByteLength } from './utf8.js'
import { OperationScope } from './operation-scope.js'
import { SourceIdentityRegistry } from './source-identity.js'
import { InboundIdentityCoordinator } from './inbound-identity.js'
import { WebRpcVariationCoordinator } from './variation-coordinator.js'
import { createSafeRecord, fanoutDeliveryKey, tupleKey } from './safe-value.js'
import type { IWebRpcEndpointDebugSnapshot } from './test-observer.js'
import type { IWebRpcDiscoveryResolverPort } from './plugin-shared-keys.js'
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
  sendFrame(message: unknown, transfer?: readonly unknown[]): Promise<void>
  dispatch(targetId: string, method: string, data: unknown): void
  on(event: string, listener: IWebRpcEventListener): () => void
  readonly hooks: { on(listener: IWebRpcHook): () => void }
  emitFailure(error: unknown, code?: string): void
  emitDiagnostic(event: Omit<IWebRpcHookEvent, 'at' | 'localId'>): void
  readonly inboundIdentity: InboundIdentityCoordinator
  readonly variations: WebRpcVariationCoordinator
  send<T>(targetId: string, method: string, data: unknown, options?: ISendOptions): Promise<T>
  sendAll<T>(method: string, data: unknown, options?: ISendOptions): Promise<IWebRpcFanoutResult<T>>
  dispatchAll(method: string, data: unknown): void
  setReceiverResolver(resolver: (targetId: string) => Promise<IOutboundReceiver>): void
  resolveReceiver(targetId: string, receiverId?: string): Promise<IOutboundReceiver>
  validate(method: string, side: 'params' | 'result', data: unknown): void
  debugSnapshot(): IWebRpcEndpointDebugSnapshot
}

/** Canonical outbound/client owner attached to one endpoint kernel. */
export class WebRpcOutboundAttachment implements IOutboundAttachmentHost {
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
  readonly #uuid: IWebRpcUuidConfig
  /** Contract validation owner shared with provider execution. */
  readonly #validateData: IWebRpcContractCapability['validateData']
  /** Canonical protocol snapshot used in both directions. */
  readonly #protocol: IWebRpcProtocolCapability
  /** Optional inbound/outbound protection capability. */
  readonly #authentication: IWebRpcAuthenticationCapability | undefined
  /** Canonical dynamic timeout capability installed by middleware. */
  readonly #timeout: IWebRpcTimeoutCapability
  /** Enables caller abort semantics only when the abort capability is selected. */
  readonly #abortEnabled: boolean
  /** Outbound transport/protocol pipeline. */
  readonly #pipeline: WebRpcOutboundSender<string>
  /** Active request settlements keyed by wire task id. */
  readonly #pending = new PendingRegistry<IOutboundPending>()
  /** Prevents active and recently released task-id reuse. */
  readonly #replay: ReplayWindow
  /** Hook callbacks owned by the outbound runtime. */
  readonly #hooks = new HookRegistry()
  /** Event listeners retained for the selected public kernel surface. */
  readonly #events = new Map<string, Set<IWebRpcEventListener>>()
  /** Stable weak source identities used by response admission. */
  readonly #sourceIdentity = new SourceIdentityRegistry()
  /** Shared inbound source-proof/connect/binding owner for all selected features. */
  readonly inboundIdentity: InboundIdentityCoordinator
  /** Shared variation route and admission owner for optional feature handlers. */
  readonly variations: WebRpcVariationCoordinator
  /** Pins each logical target to the first verified response source in the slim runtime. */
  readonly #responseBindings = new Map<string, string>()
  /** Optional discovery-backed receiver selector; target identity is safe default. */
  #receiverResolver: (targetId: string) => Promise<IOutboundReceiver> = async (targetId) => ({
    receiverId: targetId
  })
  /** Reads the later-installed discovery resolver without publishing a broad owner port. */
  readonly #discoveryResolver: (() => IWebRpcDiscoveryResolverPort | undefined) | undefined
  /** Canonical hook failure reporter snapshotted during construction. */
  readonly #hookErrorReporter: ((error: unknown, event: IWebRpcHookEvent) => void) | undefined
  /** Indicates that activation installed the physical receiver. */
  #activated = false
  /** Stable feature-result disposal Promise; root kernel disposal is owned by the kernel plugin. */
  #featureDisposePromise: Promise<void> | undefined

  /** Creates outbound owners without subscribing; provider may install its routes first. */
  constructor(
    kernel: IEndpointKernelHost,
    prepared: IPreparedEndpoint<string>,
    discoveryResolver?: () => IWebRpcDiscoveryResolverPort | undefined
  ) {
    this.kernel = kernel
    this.variations = new WebRpcVariationCoordinator(() => kernel.time.now())
    this.#discoveryResolver = discoveryResolver
    this.id = prepared.id
    this.targetIds = Object.freeze([...(prepared.options.targetIds ?? [])])
    this.#replay = new ReplayWindow(
      prepared.options.replay?.maxEntries,
      prepared.options.replay?.ttlMs
    )
    const contract = prepared.options.contract ?? {}
    this.#version = contract.version ?? '1.0'
    const uniqueTargetId = prepared.options.connect?.uniqueTargetId
    this.receiverId =
      kernel.platform === 'BroadcastChannel' && typeof uniqueTargetId === 'string'
        ? `${this.id}:${uniqueTargetId}`
        : this.id
    this.#validateData =
      'validateData' in contract && contract.validateData
        ? (contract.validateData as IWebRpcContractCapability['validateData'])
        : (method, side, data) => validateContractData(contract, method, side, data)
    this.#uuid = prepared.options.uuid ?? {}
    const protocol = prepared.options.protocol ?? {}
    this.#protocol = {
      ...protocol,
      encode: protocol.encode ?? ((value: unknown): unknown => value),
      decode: protocol.decode ?? ((value: unknown): unknown => value)
    }
    this.#authentication = prepared.options.authentication
    this.#hookErrorReporter = prepared.options.hooks?.onHookError
    this.#abortEnabled = prepared.options.features?.abort === true
    const chunk = prepared.options.chunk ?? {}
    const chunkCapability = {
      ...chunk,
      byteLength: chunk.byteLength ?? utf8ByteLength,
      split: chunk.split ?? splitUtf8
    }
    const timeout = prepared.options.timeout ?? {}
    const timeoutDefault = timeout.timeoutMs ?? 1000
    this.#timeout = {
      ...timeout,
      resolveTimeout:
        'resolveTimeout' in timeout && timeout.resolveTimeout
          ? (timeout.resolveTimeout as IWebRpcTimeoutCapability['resolveTimeout'])
          : (override) => (override === undefined ? timeoutDefault : override)
    }
    this.#pipeline = new WebRpcOutboundSender(
      kernel,
      this.id,
      this.#protocol,
      chunkCapability,
      (code, error) => this.emitFailure(error, code),
      prepared.options.authentication,
      kernel.platform,
      (messageId) => this.#replay.releaseId(messageId)
    )
    this.inboundIdentity = new InboundIdentityCoordinator({
      connect:
        prepared.options.connect && 'verify' in prepared.options.connect
          ? prepared.options.connect
          : undefined,
      sourceProof: kernel.transport.sourceProof,
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
    kernel.resources.addSync('outbound event listeners', () => this.#events.clear())
    kernel.resources.addSync('outbound response bindings', () => this.#responseBindings.clear())
    for (const listener of normalizeHooks(prepared.options.hooks?.listeners))
      this.#hooks.add(listener)
    for (const event of prepared.options.initialHookEvents ?? []) this.#emit(event)
    kernel.registerRoute(WebRpcMessageKind.response, (message) => this.#receiveResponse(message))
    kernel.registerRoute(WebRpcMessageKind.variation, (message) => this.#receiveVariation(message))
  }

  /** Routes one variation through the shared coordinator after identity admission. */
  async #receiveVariation(message: unknown): Promise<void> {
    const record = message as {
      envelope?: {
        variation?: string
        taskId?: string
        senderId?: string
        targetId?: string
        receiverId?: string
      }
      inbound?: import('../transport.js').IWebRpcInboundMessage
    }
    const envelope = record.envelope
    if (
      !envelope?.variation ||
      !envelope.taskId ||
      !envelope.senderId ||
      !envelope.targetId ||
      (envelope.receiverId !== this.receiverId && envelope.receiverId !== this.id)
    )
      return
    const admission = await this.inboundIdentity.admit({
      senderId: envelope.senderId,
      targetId: envelope.targetId,
      data: envelope,
      inbound: record.inbound
    })
    if (!admission) return
    try {
      await this.variations.dispatch(
        envelope.variation as import('../protocol-constants.js').IWebRpcVariation,
        `${admission.token}:${envelope.taskId}`,
        message,
        admission.token
      )
    } finally {
      admission.release()
    }
  }

  /** Installs the one physical receiver after all selected routes exist. */
  activate(): void {
    if (this.#activated) return
    const activation = createEndpointTransportActivation(this.kernel.transport, {
      receive: async (message) => {
        let decoded = message.data
        if (this.kernel.state !== 'active') return
        if (this.#authentication)
          decoded = await this.#authentication.unprotect(decoded, {
            direction: 'inbound',
            endpointId: this.id,
            platform: this.kernel.platform
          })
        decoded = this.#protocol.decode(decoded)
        const envelope = normalizeWebRpcEnvelope(decoded)
        if (!envelope) return
        await this.kernel.dispatchRoute(
          envelope.kind,
          Object.freeze({ envelope, inbound: message })
        )
      },
      transportError: (error) => this.#failAll(error),
      listenerError: (error) => this.emitFailure(error, WebRpcErrorCode.transport),
      receiveError: (error) => this.emitFailure(error)
    })
    this.kernel.activate(activation)
    this.#activated = true
  }

  /** Sends one request through the canonical single-attempt deadline and cancellation closure. */
  async send<T>(
    targetId: string,
    method: string,
    data: unknown,
    options: ISendOptions = {}
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
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          WebRpcErrorText.abortSignalInvalid,
          error
        )
      }
      if (!this.#abortEnabled)
        throw new WebRpcError(
          WebRpcErrorCode.middlewareMissing,
          WebRpcErrorText.abortMiddlewareMissing
        )
      if (options.signal.aborted)
        throw new WebRpcAbortError(undefined, undefined, options.signal.reason)
    }
    const timeoutMs = this.#timeout.resolveTimeout(options.timeoutMs)
    assertTimeout(timeoutMs)
    const operation = new OperationScope(generation, timeoutMs, this.kernel.closingSignal)
    const remaining = operation.remaining(timeoutMs)
    operation.assertActive(this.kernel.generation)
    if (remaining === 0) throw new WebRpcTimeoutError()
    return this.#requestOnce<T>(targetId, method, data, { ...options, timeoutMs: remaining }, [
      operation.signal,
      ...(options.signal ? [options.signal] : [])
    ]).finally(() => operation.abort())
  }

  /** Owns one request's task id, pending settlement, timeout, and abort listeners. */
  #requestOnce<T>(
    targetId: string,
    method: string,
    data: unknown,
    options: ISendOptions,
    signals: readonly NonNullable<ISendOptions['signal']>[]
  ): Promise<T> {
    const taskId = allocateRpcId(this.#uuid, 'task', this.id, targetId, (id) =>
      this.#replay.hasReservedId(id)
    )
    if (!this.#replay.reserveId(taskId))
      return Promise.reject(
        new WebRpcError(WebRpcErrorCode.overloaded, WebRpcErrorText.outboundReplayFull)
      )
    return new Promise<T>((resolve, reject) => {
      let timer: IEndpointTimer | undefined
      let settled = false
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
      const notifyRemoteAbort = (): void => {
        if (!this.#abortEnabled) return
        void this.resolveReceiver(targetId)
          .then((receiver) =>
            this.#pipeline.sendVariation({
              kind: WebRpcMessageKind.variation,
              variation: 'abort',
              taskId,
              senderId: this.id,
              targetId,
              sentAt: this.kernel.time.now(),
              receiverId: receiver.receiverId
            })
          )
          .catch((error) => this.emitFailure(error, WebRpcErrorCode.transport))
      }
      const onAbort = (): void => {
        notifyRemoteAbort()
        settleReject(
          new WebRpcAbortError(
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
          new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.abortSignalInvalid, error)
        )
        return
      }
      if (settled) return
      if (options.timeoutMs !== false && options.timeoutMs !== undefined)
        timer = this.kernel.time.setTimeout(() => {
          notifyRemoteAbort()
          settleReject(new WebRpcTimeoutError())
        }, options.timeoutMs)
      void this.resolveReceiver(
        targetId,
        (options as ISendOptions & { receiverId?: string }).receiverId
      )
        .then((receiver) => {
          if (settled) return
          const request = {
            kind: WebRpcMessageKind.request,
            version: this.#version,
            taskId,
            senderId: this.id,
            targetId,
            method,
            data,
            sentAt: this.kernel.time.now(),
            receiverId: receiver.receiverId
          }
          return this.#pipeline.send(request, () => taskId, options)
        })
        .catch(settleReject)
    })
  }

  /** Sends one dispatch-only request without creating pending response state. */
  dispatch(targetId: string, method: string, data: unknown): void {
    this.kernel.assertActive()
    assertMethod(targetId)
    assertMethod(method)
    this.#validateData(method, 'params', data)
    const taskId = allocateRpcId(this.#uuid, 'message', this.id, targetId, (id) =>
      this.#replay.hasReservedId(id)
    )
    if (!this.#replay.reserveId(taskId))
      throw new WebRpcError(WebRpcErrorCode.overloaded, WebRpcErrorText.outboundReplayFull)
    void Promise.resolve()
      .then(() => this.resolveReceiver(targetId))
      .then((receiver) =>
        this.#pipeline.send(
          {
            kind: WebRpcMessageKind.request,
            version: this.#version,
            taskId,
            senderId: this.id,
            targetId,
            method,
            data,
            dispatchOnly: true,
            sentAt: this.kernel.time.now(),
            receiverId: receiver.receiverId
          },
          () => taskId
        )
      )
      .then(
        () => this.#replay.releaseId(taskId),
        (error) => {
          this.#replay.releaseId(taskId)
          this.emitFailure(error, WebRpcErrorCode.transport)
        }
      )
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
  sendFrame(message: unknown, transfer?: readonly unknown[]): Promise<void> {
    return Promise.resolve().then(() =>
      this.#pipeline.send(message, () => '', transfer === undefined ? undefined : { transfer })
    )
  }

  /**
   * Sends one request to every statically configured target. Matches the legacy fanout contract:
   * results are keyed by the canonical `fanoutDeliveryKey` tagged shape and accumulated into a
   * `createSafeRecord` dictionary (a plain `{}` would let an attacker-controlled `__proto__`-shaped
   * target silently mutate the accumulator's prototype instead of appearing as a delivery result),
   * and a `WebRpcLifecycleError` raised by any individual `send()` (construction/dispose racing the
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
  ): Promise<IWebRpcFanoutResult<T>> {
    const results = await Promise.allSettled(
      this.targetIds.map(
        async (targetId) => [targetId, await this.send<T>(targetId, method, data, options)] as const
      )
    )
    const lifecycleFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && result.reason instanceof WebRpcLifecycleError
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

  /** Registers a selected event listener without publishing provider mutation APIs. */
  on(event: string, listener: IWebRpcEventListener): () => void {
    this.kernel.assertActive()
    assertMethod(event)
    if (typeof listener !== 'function')
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.eventListenerInvalid)
    const listeners = this.#events.get(event) ?? new Set<IWebRpcEventListener>()
    listeners.add(listener)
    this.#events.set(event, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.#events.delete(event)
    }
  }

  /** Returns the public hook registration surface. */
  get hooks(): { on(listener: IWebRpcHook): () => void } {
    return { on: (listener) => this.#hooks.add(listener) }
  }

  /** Reports one diagnostic without allowing reporter failure to re-enter runtime work. */
  emitFailure(error: unknown, code: string = WebRpcErrorCode.internal): void {
    const event = { name: 'failure', at: this.kernel.time.now(), localId: this.id, error, code }
    this.#emit(event)
    try {
      this.#hookErrorReporter?.(error, event)
    } catch {
      // Diagnostics are observational and cannot change the terminal operation outcome.
    }
  }

  /** Emits one package-owned diagnostic through the canonical hook owner. */
  emitDiagnostic(event: Omit<IWebRpcHookEvent, 'at' | 'localId'>): void {
    this.#emit(Object.freeze({ ...event, at: this.kernel.time.now(), localId: this.id }))
  }

  /** Applies the canonical contract validation snapshot for provider execution. */
  validate(method: string, side: 'params' | 'result', data: unknown): void {
    this.#validateData(method, side, data)
  }

  /** Reads live package-private owner counts for hostile lifecycle verification. */
  debugSnapshot(): IWebRpcEndpointDebugSnapshot {
    return {
      phase: this.kernel.state === 'disposed' ? 'disposed' : 'active',
      pending: this.#pending.size,
      pingPending: 0,
      activeControllers: 0,
      chunks: 0,
      providers: 0,
      events: [...this.#events.values()].reduce((total, listeners) => total + listeners.size, 0),
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
      this.#failAll(new WebRpcAbortError())
      this.#events.clear()
      this.#responseBindings.clear()
      this.#hooks.clear()
      this.#replay.clear()
    })
    return this.#featureDisposePromise
  }

  /** Settles one authenticated response owned by this endpoint. */
  async #receiveResponse(message: unknown): Promise<void> {
    const record = message as {
      envelope?: IWebRpcResponse
      inbound?: IWebRpcInboundMessage<unknown>
    }
    const envelope = record.envelope
    if (
      !envelope ||
      envelope.kind !== WebRpcMessageKind.response ||
      envelope.targetId !== this.id ||
      (envelope.receiverId !== this.receiverId && envelope.receiverId !== this.id)
    )
      return
    const pending = this.#pending.get(envelope.taskId)
    if (!pending || pending.targetId !== envelope.senderId || pending.method !== envelope.method)
      return
    const binding = await this.#verifyResponseSource(envelope, record.inbound)
    if (!binding || this.kernel.state !== 'active') return
    if (envelope.ok) {
      try {
        this.#validateData(envelope.method, 'result', envelope.data)
        pending.resolve(envelope.data)
      } catch (error) {
        pending.reject(error)
      }
    } else
      pending.reject(
        new WebRpcRemoteError(
          envelope.code ?? WebRpcErrorCode.internal,
          envelope.message ?? WebRpcErrorText.remoteRequestFailed,
          envelope.data
        )
      )
  }

  /** Verifies physical/logical source identity before a response may settle pending state. */
  async #verifyResponseSource(
    response: IWebRpcResponse,
    inbound: IWebRpcInboundMessage<unknown> | undefined
  ): Promise<string | false> {
    const admission = await this.inboundIdentity.admit({
      senderId: response.senderId,
      targetId: response.targetId,
      data: response.data,
      inbound
    })
    if (!admission) {
      this.#emit({
        name: 'authentication.rejected',
        at: this.kernel.time.now(),
        localId: this.id,
        code: 'UNAUTHENTICATED'
      })
      return false
    }
    admission.release()
    const binding = tupleKey(
      response.senderId,
      inbound?.peerId ?? this.kernel.transport.peerId ?? '',
      inbound?.origin ?? this.kernel.origin ?? '',
      this.#sourceIdentity.token(inbound?.source)
    )
    const existing = this.#responseBindings.get(response.senderId)
    if (existing !== undefined && existing !== binding) {
      this.#emit({
        name: 'authentication.rejected',
        at: this.kernel.time.now(),
        localId: this.id,
        code: 'SOURCE_BINDING_CONFLICT'
      })
      return false
    }
    this.#responseBindings.set(response.senderId, binding)
    return binding
  }

  /** Rejects and removes every pending operation after transport or lifecycle failure. */
  #failAll(error: unknown): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }

  /** Emits a hook event while preserving the configured hook-error boundary. */
  #emit(event: IWebRpcHookEvent): void {
    this.#hooks.emit(event, this.#hookErrorReporter)
  }
}

/** Normalizes configured hook listeners into one immutable iteration snapshot. */
function normalizeHooks(
  value: IWebRpcHook | readonly IWebRpcHook[] | undefined
): readonly IWebRpcHook[] {
  if (value === undefined) return []
  return Object.freeze(Array.isArray(value) ? [...value] : [value as IWebRpcHook])
}

/** Rejects timeout values outside the inherited finite non-negative domain. */
export function assertTimeout(timeoutMs: number | false | undefined): void {
  if (
    timeoutMs !== undefined &&
    timeoutMs !== false &&
    (!Number.isFinite(timeoutMs) || timeoutMs < 0)
  )
    throw new WebRpcContractError(WebRpcErrorText.timeoutInvalid)
}
