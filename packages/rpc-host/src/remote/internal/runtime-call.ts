import type { IAbortSignal } from '@migaia/utils/promise'
import {
  createRpcError,
  isLocalRpcError,
  RpcCoreErrorCode,
  RpcRemoteError
} from '../../core/errors.js'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type {
  IRpcRuntimeGeneration,
  IRpcRuntimeStep,
  IRpcRuntimeStepOutcome
} from '@migaia/rpc-contract/runtime'
import { RpcCapability } from '@migaia/rpc-contract/wire'
import { RpcRuntimeMode } from '@migaia/rpc-contract/wire'
import { RuntimeApiErrorText } from '../runtime-api/constants.js'
import { normalizePortable } from '@migaia/rpc-contract/portable'
import { hasRpcBinaryEnvelope } from '@migaia/rpc-contract/binary/inspect'
import type { IRpcEndpoint, ISendOptions } from '../../core/typing.js'

import { RpcCoreErrorText } from '../../core/error-text.js'
import {
  captureRuntimeGroupSteps,
  createRuntimeRequestInput,
  readRuntimeRequestInput,
  retainRuntimeRequestInput,
  isForwardedPayload,
  retainForwardOptions,
  type IRuntimeRequestInput
} from '../../core/internal/outbound-envelope.js'
import { readEndpointOwner } from '../../core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../core/endpoint-kernel.js'
import type {
  RpcOutboundAttachment,
  IRpcRuntimeSendOptions
} from '../../core/internal/outbound-attachment.js'
import type { RpcStreamOwner } from '../../core/internal/stream/owner.js'
import {
  prepareRuntimeStreamConsumer,
  retainRuntimeStreamPreparation
} from '../../core/internal/stream/owner.js'
import { createProviderGenerationRetired } from '../../core/internal/provider.js'
import { assertRpcIdempotencyKey, defaultRpcId } from '../../core/internal/id.js'
import { rejectRuntimeApiCapability } from '../../core/runtime-api-endpoint.js'
import type { IRpcStreamRuntime } from '../../core/features/stream.js'
import {
  retainRuntimeTransferOptions,
  type ICoreRuntimeCallOptions
} from '../../core/internal/runtime-call-options.js'

/** The original generation event resource owns readiness and departure. */
type ICallEvents = Readonly<{
  current(): Readonly<{ generation: number; active: boolean }>
  onLeave(generation: number, listener: (reason: unknown) => void): () => void
  whenReady(afterGeneration: number, signal?: IAbortSignal): Promise<number>
}>
/** Retry sees one send closure; its Core-owned snapshot remains private inside the merged package. */
export type ICoreRuntimeRetryDispatch = Readonly<{
  method: string
  mode: 'request'
  idempotent: boolean
  key?: string
  generation: number
  signal?: IAbortSignal
  timeoutMs?: number
  deadlineAt?: number
  events: ICallEvents
  sendOnce(
    input: Readonly<{ expectedGeneration: number; remainingMs?: number; key?: string }>
  ): Promise<IRpcPortableValue>
}>
/** A held current endpoint and channel select the original physical composition. */
type ICoreRuntimeCallTarget = Readonly<{
  number: number
  channel: Readonly<{ peerId: string; agreement: Readonly<{ capabilities: readonly string[] }> }>
  endpoint: IRpcEndpoint
}>
/** Remote retains its generation/directory resources and delegates raw operations to Core. */
export type ICoreRuntimeCallBinding = Readonly<{
  scheduler: IScheduler
  events: ICallEvents
  dispatch(input: ICoreRuntimeRetryDispatch, forwarded: boolean): Promise<IRpcPortableValue>
  current(): ICoreRuntimeCallTarget
  observedGeneration(): number
  declaration(
    method: string,
    mode: 'request' | 'notify' | 'stream'
  ): Readonly<{ idempotent?: boolean; stream?: string; forwardedVia?: string }> | undefined
  validateOptions(options: unknown): void
  guard?(method: string, mode: 'request' | 'notify' | 'stream', generation: number): void
  keyFactory?(): string
  timeout(requested?: number | false): number | undefined
  closed(generation: number, cause?: unknown): Error
  departureCause(generation: number): unknown
  restoreFailure(error: unknown): never
  trackRequest?(invoke: () => Promise<IRpcPortableValue>): Promise<IRpcPortableValue>
}>
/** Existing binding controls delegate to one canonical iterator without a public ready property. */
type IRuntimeReadyConsumer = AsyncIterableIterator<IRpcPortableValue>

/** The same original Core capability failure is used at every unavailable operation. */
function unsupported(): never {
  return rejectRuntimeApiCapability()
}
/** The exact receiver payload association controls forwarding completion, not route metadata. */
function isRelay(payload: unknown, options: ICoreRuntimeCallOptions): boolean {
  return isForwardedPayload(options, payload)
}
/** Only omitted values skip first caller admission. */
function payloadValue(payload: unknown, binary = false): IRpcPortableValue | undefined {
  return payload === undefined
    ? undefined
    : normalizePortable(payload, 0, new Set<object>(), binary || unsupported)
}
/** Preserve a provider's original cross-realm error and stack. */
export function restoreForwardError(error: unknown): never {
  if (isLocalRpcError(error, RpcRemoteError) && error.cause instanceof Error) throw error.cause
  throw error
}
function sendInput(
  target: ICoreRuntimeCallTarget,
  input: IRuntimeRequestInput,
  options: ICoreRuntimeCallOptions,
  mode: 'request' | 'notify' = 'request',
  restoreForwarded = false
): Promise<IRpcPortableValue> {
  /**
   * Canonical projection supplies the actual attachment; foreign endpoints receive ordinary strict
   * input.
   */
  const owner = readEndpointOwner<RpcOutboundAttachment>(
    target.endpoint,
    EndpointOwnerKey.outboundAttachment
  )
  /** The actual channel agreement retains the original Peer binary admission boundary. */
  const negotiatedBinary = target.channel.agreement.capabilities.includes(
    RpcCapability.portableBinary
  )
  /** Binding payloads must not fall through to the legacy byte-conversion grammar. */
  const binaryPayload = hasRpcBinaryEnvelope(input)
  /** Actual agreement and owned payload kind select the original physical profile. */
  const native =
    (mode === 'notify' ? binaryPayload : binaryPayload || negotiatedBinary) ||
    options.orderKey !== undefined ||
    options.cancel !== undefined ||
    Object.hasOwn(options, 'transfer')
  if (native) {
    if (binaryPayload && !negotiatedBinary) unsupported()
    if (!owner) unsupported()
    const generation = owner.runtimeTargetGeneration(target.channel.peerId)
    if (!generation) unsupported()
    return owner.sendRuntimeOperation(
      target.channel.peerId,
      generation,
      mode,
      input,
      options as IRpcRuntimeSendOptions,
      mode === 'notify' && isRelay(input.payload, options)
    ) as Promise<IRpcPortableValue>
  }
  /** Legacy depth-two admission keeps its original method/payload/depth predicates. */
  const legacy =
    readRuntimeRequestInput(options, input.method, input.payload, 2) ??
    createRuntimeRequestInput(input.method, input.payload, unsupported, options, 2)
  /** Only canonical Core dispatch stores the private input association; no public token is exposed. */
  const sendOptions = retainForwardOptions(
    options,
    retainRuntimeTransferOptions(options, { ...options })
  )
  if (owner) retainRuntimeRequestInput(sendOptions, legacy)
  if (mode === 'notify' && !isRelay(input.payload, options))
    return (
      target.endpoint as unknown as {
        sendOneWay(
          targetId: string,
          method: string,
          data: unknown,
          options?: ISendOptions
        ): Promise<IRpcPortableValue>
      }
    ).sendOneWay(target.channel.peerId, input.method, legacy.payload, sendOptions)
  const result = target.endpoint.send<IRpcPortableValue>(
    target.channel.peerId,
    input.method,
    legacy.payload,
    sendOptions
  )
  return restoreForwarded || isRelay(input.payload, options)
    ? result.catch(restoreForwardError)
    : result
}

/** One admitted forwarded operation retains its exact generation-leave observation. */
class ForwardedRuntimeRequest {
  /** Leave wins over either fulfillment or rejection after the admitted operation settles. */
  #retired: Error | undefined
  /** The exact original listener receipt is removed by Promise.finally with its bare receiver. */
  #unsubscribe: () => void

  /** Subscribe only after the original request has already entered native tracking. */
  constructor(events: ICallEvents, generation: number) {
    this.#unsubscribe = events.onLeave(generation, (reason) => {
      this.#retired = createProviderGenerationRetired(reason)
    })
  }

  /** Keep the original completion chain and cleanup settlement semantics. */
  observe(operation: Promise<IRpcPortableValue>): Promise<IRpcPortableValue> {
    return operation.then(this.#fulfilled, this.#rejected).finally(this.#unsubscribe)
  }

  /** Retirement is checked only after the original physical operation fulfills. */
  #fulfilled = (value: IRpcPortableValue): IRpcPortableValue => {
    if (this.#retired) throw this.#retired
    return value
  }

  /** Preserve the original rejection unless this admitted generation has already retired. */
  #rejected = (error: unknown): never => {
    throw this.#retired ?? error
  }
}

/** Coordinate the original managed request with one Core-owned snapshot across Remote retries. */
function requestBound(
  binding: ICoreRuntimeCallBinding,
  method: string,
  payload: unknown,
  options: ICoreRuntimeCallOptions,
  mode: 'request' | 'notify'
): Promise<IRpcPortableValue> {
  /**
   * The snapshot precedes declaration/guard/key/current/ready reads, preserving the old public
   * error point.
   */
  const input = createRuntimeRequestInput(method, payload, true, options)
  /**
   * Declaration errors retain their original synchronous point outside the following rejection
   * catch.
   */
  const declaration = binding.declaration(method, mode)
  /** Receiver identity is data admission only; routing changes no other party's rights. */
  const forwarded = isRelay(payload, options)
  try {
    binding.validateOptions(options)
    binding.guard?.(method, mode, binding.observedGeneration())
    /** Select before the key factory exactly as in the original native registration. */
    const active = binding.current()
    const key =
      options.idempotencyKey ??
      (declaration?.idempotent ? (binding.keyFactory?.() ?? defaultRpcId()) : undefined)
    if (key !== undefined) assertRpcIdempotencyKey(key)
    const timeoutMs = binding.timeout(options.timeoutMs)
    if (
      options.orderKey !== undefined ||
      options.cancel !== undefined ||
      Object.hasOwn(options, 'transfer')
    ) {
      const callOptions = retainForwardOptions(
        options,
        retainRuntimeTransferOptions(options, {
          ...options,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
          ...(key === undefined ? {} : { idempotencyKey: key })
        })
      )
      const invoke = () =>
        sendInput(active, input, callOptions, mode, declaration?.forwardedVia !== undefined)
      const operation = binding.trackRequest ? binding.trackRequest(invoke) : invoke()
      if (!forwarded) return operation
      return new ForwardedRuntimeRequest(binding.events, active.number).observe(operation)
    }
    const deadlineAt = timeoutMs === undefined ? undefined : binding.scheduler.now() + timeoutMs
    /**
     * The actual existing retry port receives a send closure, never an input object or admission
     * flag.
     */
    const dispatch: ICoreRuntimeRetryDispatch = {
      method,
      mode: 'request',
      idempotent: declaration?.idempotent ?? false,
      key,
      generation: active.number,
      signal: options.signal,
      timeoutMs,
      deadlineAt,
      events: binding.events,
      sendOnce: async (attempt) => {
        if (attempt.key !== key)
          throw createRpcError(
            RpcCoreErrorCode.invalidConfig,
            RpcCoreErrorText.idempotencyKeyInvalid
          )
        if (
          attempt.remainingMs !== undefined &&
          (!Number.isFinite(attempt.remainingMs) || attempt.remainingMs <= 0)
        )
          throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.timeoutInvalid)
        const live = binding.current()
        if (live.number !== attempt.expectedGeneration)
          throw binding.closed(
            attempt.expectedGeneration,
            binding.departureCause(attempt.expectedGeneration)
          )
        const sendOptions = retainForwardOptions(options, {
          ...(options.signal ? { signal: options.signal } : {}),
          ...(attempt.remainingMs === undefined
            ? timeoutMs === undefined
              ? options.timeoutMs === false
                ? { timeoutMs: false as const }
                : {}
              : { timeoutMs }
            : { timeoutMs: attempt.remainingMs }),
          ...(key === undefined ? {} : { idempotencyKey: key })
        })
        const invoke = () =>
          sendInput(live, input, sendOptions, mode, declaration?.forwardedVia !== undefined)
        const result = binding.trackRequest ? binding.trackRequest(invoke) : invoke()
        return result.catch((error) => binding.restoreFailure(error))
      }
    }
    return binding.dispatch(
      forwarded ? retainForwardOptions(options, dispatch) : dispatch,
      forwarded
    )
  } catch (error) {
    return Promise.reject(error)
  }
}

/** One lazy stream consumer owns generation retirement and its original observation receipt. */
class BoundRuntimeStream {
  /** The original binding remains sole current-generation, retry and clock authority. */
  #binding: ICoreRuntimeCallBinding
  /** Method admission remains lazy until first read or canonical forwarding preparation. */
  #method: string
  /** Original payload is captured once by the canonical request-input owner at preparation. */
  #payload: unknown
  /** Original options preserve forwarding and transfer provenance. */
  #options: ICoreRuntimeCallOptions
  /** The one actual consumer is created lazily and reused by every iterator operation. */
  #consumer: IRuntimeReadyConsumer | undefined
  /** A retired forwarded generation retains its original failure precedence. */
  #retired: Error | undefined
  /** The original leave subscription is removed on completion, rejection or failed preparation. */
  #unsubscribe: (() => void) | undefined
  /** The public iterator keeps the original own operation callbacks and frozen projection. */
  readonly iterator: IRuntimeReadyConsumer

  /** Retain immutable call inputs without touching declarations, guards or the physical source. */
  constructor(
    binding: ICoreRuntimeCallBinding,
    method: string,
    payload: unknown,
    options: ICoreRuntimeCallOptions
  ) {
    this.#binding = binding
    this.#method = method
    this.#payload = payload
    this.#options = options
    /** Short iterator callbacks delegate lifecycle changes to this named operation owner. */
    const facade: IRuntimeReadyConsumer = {
      next: () => this.#observe(() => this.#current().next()),
      return: (value?: IRpcPortableValue) => this.#observe(() => this.#current().return!(value)),
      throw: (reason?: unknown) => this.#observe(() => this.#current().throw!(reason)),
      [Symbol.asyncIterator]() {
        return this
      }
    }
    retainRuntimeStreamPreparation(facade, this.#prepare)
    this.iterator = Object.freeze(facade)
  }

  /** Prepare the one original native or legacy consumer at its existing lazy admission point. */
  #current(): IRuntimeReadyConsumer {
    if (this.#consumer) return this.#consumer
    const input = createRuntimeRequestInput(this.#method, this.#payload, true, this.#options)
    const declaration = this.#binding.declaration(this.#method, 'stream')
    this.#binding.validateOptions(this.#options)
    this.#binding.guard?.(this.#method, 'stream', this.#binding.observedGeneration())
    const active = this.#binding.current()
    const timeoutMs = this.#binding.timeout(this.#options.timeoutMs)
    const callOptions = retainForwardOptions(
      this.#options,
      retainRuntimeTransferOptions(this.#options, {
        ...this.#options,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      })
    )
    const owner = readEndpointOwner<RpcStreamOwner>(active.endpoint, EndpointOwnerKey.streamOwner)
    const outbound = readEndpointOwner<RpcOutboundAttachment>(
      active.endpoint,
      EndpointOwnerKey.outboundAttachment
    )
    if (!owner) unsupported()
    const native =
      active.channel.agreement.capabilities.includes(RpcCapability.portableBinary) ||
      callOptions.orderKey !== undefined ||
      callOptions.cancel !== undefined ||
      Object.hasOwn(callOptions, 'transfer')
    if (native) {
      if (!outbound) unsupported()
      const generation = outbound.runtimeTargetGeneration(active.channel.peerId)
      if (!generation) unsupported()
      this.#consumer = owner.openRuntime(
        active.channel.peerId,
        this.#method,
        input.payload,
        generation,
        callOptions as IRpcRuntimeSendOptions
      ) as IRuntimeReadyConsumer
    } else {
      if (this.#options.idempotencyKey !== undefined) unsupported()
      this.#consumer = (active.endpoint as unknown as { stream: IRpcStreamRuntime }).stream.open(
        active.channel.peerId,
        declaration?.stream ?? this.#method,
        input.payload,
        callOptions
      ) as IRuntimeReadyConsumer
    }
    if (isRelay(this.#payload, this.#options))
      this.#unsubscribe = this.#binding.events.onLeave(active.number, (reason) => {
        this.#retired = createProviderGenerationRetired(reason)
      })
    return this.#consumer
  }

  /** Observe original iterator completion and preserve retirement-over-operation error precedence. */
  async #observe(
    operation: () => Promise<IteratorResult<IRpcPortableValue>>
  ): Promise<IteratorResult<IRpcPortableValue>> {
    try {
      const result = await operation()
      if (result.done) (0, this.#unsubscribe)?.()
      return result
    } catch (error) {
      ;(0, this.#unsubscribe)?.()
      throw this.#retired ?? error
    }
  }

  /** Forwarding prepares the same lazy consumer even without ordering or cancellation options. */
  #prepare = async (): Promise<void> => {
    try {
      await prepareRuntimeStreamConsumer(this.#current())
    } catch (error) {
      ;(0, this.#unsubscribe)?.()
      throw this.#retired ?? error
    }
  }
}

/** Remote keeps its original lazy registration controls while this resource owns the consumer. */
function streamBound(
  binding: ICoreRuntimeCallBinding,
  method: string,
  payload: unknown,
  options: ICoreRuntimeCallOptions
): IRuntimeReadyConsumer {
  return new BoundRuntimeStream(binding, method, payload, options).iterator
}

/** Remote coordinates Core capture with its original retry and lazy stream resources. */
export function createRuntimeBindingCalls(binding: ICoreRuntimeCallBinding) {
  return Object.freeze({
    request: (
      method: string,
      payload: unknown,
      options: ICoreRuntimeCallOptions = {},
      mode: 'request' | 'notify' = 'request'
    ) => requestBound(binding, method, payload, options, mode),
    stream: (method: string, payload: unknown, options: ICoreRuntimeCallOptions = {}) =>
      streamBound(binding, method, payload, options)
  })
}

/** Immutable inputs borrowed from the genuine endpoint and generation owners. */
type IRuntimePeerCallConfig = Readonly<{
  /** The held native owner supplies only its original transfer rejection policy. */
  restrictTransfer?: (options: object | undefined) => void
  callTimeout: (options?: ICoreRuntimeCallOptions) => ICoreRuntimeCallOptions
  route: (method: string, mode: 'request' | 'notify' | 'stream') => void
  ready: Pick<IRpcEndpoint, 'send' | 'group' | 'outcome'> &
    Readonly<{
      sendOneWay(
        targetId: string,
        method: string,
        data: unknown,
        options?: ISendOptions
      ): Promise<void>
      stream?: IRpcStreamRuntime
    }>
  runtimeOutbound?: RpcOutboundAttachment
  peerId: string
  generation?: IRpcRuntimeGeneration
  supportsBinary: boolean
  supportsStream: boolean
  routes: ReadonlyMap<string, Readonly<{ stream: string; forwardedVia?: unknown }>>
}>

/** One named call operator owns its original endpoint/registration context and callback identities. */
class RuntimePeerCalls {
  /** The exact original context retains transfer, route, clock and receiver policy. */
  #config: IRuntimePeerCallConfig

  /** Retain original owner inputs without preparing a request, stream or native generation. */
  constructor(config: IRuntimePeerCallConfig) {
    this.#config = {
      restrictTransfer: config.restrictTransfer,
      callTimeout: config.callTimeout,
      route: config.route,
      ready: config.ready,
      runtimeOutbound: config.runtimeOutbound,
      supportsBinary: config.supportsBinary,
      supportsStream: config.supportsStream,
      routes: config.routes,
      peerId: config.peerId,
      generation: config.generation
    }
  }

  /** Preserve the original request admission, failure and resource boundary. */
  request = (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
    ;(0, this.#config.restrictTransfer)?.(callOptions)
    callOptions = (0, this.#config.callTimeout)(callOptions)
    ;(0, this.#config.route)(method, RpcRuntimeMode.request)
    if (
      this.#config.supportsBinary ||
      callOptions?.orderKey !== undefined ||
      callOptions?.cancel !== undefined ||
      (callOptions !== undefined && Object.hasOwn(callOptions, 'transfer'))
    ) {
      if (!this.#config.runtimeOutbound || !this.#config.generation) rejectRuntimeApiCapability()
      return this.#config.runtimeOutbound.sendRuntimeOperation(
        this.#config.peerId,
        this.#config.generation,
        'request',
        createRuntimeRequestInput(
          method,
          payload,
          this.#config.supportsBinary || rejectRuntimeApiCapability,
          callOptions
        ),
        callOptions
      ) as Promise<IRpcPortableValue | undefined>
    }
    /** Original legacy framing retains its depth-two payload boundary without a facade walk. */
    const input = createRuntimeRequestInput(
      method,
      payload,
      this.#config.supportsBinary || rejectRuntimeApiCapability,
      callOptions,
      2
    )
    const result = this.#config.ready.send<IRpcPortableValue | undefined>(
      this.#config.peerId,
      method,
      input.payload,
      retainRuntimeRequestInput(retainForwardOptions(callOptions, { ...callOptions }), input)
    )
    return this.#config.routes.get(method)?.forwardedVia || isForwardedPayload(callOptions, payload)
      ? result.catch(restoreForwardError)
      : result
  }

  /** Preserve the original notify admission, failure and resource boundary. */
  notify = (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
    ;(0, this.#config.restrictTransfer)?.(callOptions)
    ;(0, this.#config.route)(method, RpcRuntimeMode.notify)
    /**
     * Plain notify has no binary result; its existing physical/forward completion path stays
     * intact.
     */
    const normalizedPayload = isForwardedPayload(callOptions, payload)
      ? (payload as IRpcPortableValue | undefined)
      : payloadValue(payload, this.#config.supportsBinary)
    if (
      hasRpcBinaryEnvelope({ payload: normalizedPayload }) ||
      callOptions?.orderKey !== undefined ||
      callOptions?.cancel !== undefined ||
      (callOptions !== undefined && Object.hasOwn(callOptions, 'transfer'))
    ) {
      if (!this.#config.runtimeOutbound || !this.#config.generation) rejectRuntimeApiCapability()
      return this.#config.runtimeOutbound.sendRuntimeOperation(
        this.#config.peerId,
        this.#config.generation,
        'notify',
        { method, payload: normalizedPayload },
        callOptions,
        isForwardedPayload(callOptions, payload)
      ) as Promise<void>
    }
    /** The private forward operation awaits C's existing provider response, unlike ordinary notify. */
    if (isForwardedPayload(callOptions, payload))
      return this.#config.ready
        .send(this.#config.peerId, method, payload, callOptions)
        .then(() => undefined, restoreForwardError)
    return this.#config.ready.sendOneWay(
      this.#config.peerId,
      method,
      normalizedPayload,
      callOptions
    )
  }

  /** Preserve the original stream admission, failure and resource boundary. */
  stream = (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
    ;(0, this.#config.restrictTransfer)?.(callOptions)
    callOptions = (0, this.#config.callTimeout)(callOptions)
    if (!this.#config.supportsStream) rejectRuntimeApiCapability()
    ;(0, this.#config.route)(method, RpcRuntimeMode.stream)
    if (
      this.#config.supportsBinary ||
      callOptions?.orderKey !== undefined ||
      callOptions?.cancel !== undefined ||
      (callOptions !== undefined && Object.hasOwn(callOptions, 'transfer'))
    ) {
      if (!this.#config.runtimeOutbound || !this.#config.generation) rejectRuntimeApiCapability()
      /** The same canonical stream owner retains its existing consumer and single-credit loop. */
      const owner = readEndpointOwner<RpcStreamOwner>(
        this.#config.ready,
        EndpointOwnerKey.streamOwner
      )
      if (!owner) rejectRuntimeApiCapability()
      return owner.openRuntime(
        this.#config.peerId,
        method,
        payloadValue(payload, this.#config.supportsBinary),
        this.#config.generation,
        callOptions
      )
    }
    /** Legacy open has no request reply when the accepted directory declares no stream handler. */
    const declaration = this.#config.routes.get(method)
    if (!declaration)
      throw createRpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
    return this.#config.ready.stream!.open(
      this.#config.peerId,
      declaration.stream,
      isForwardedPayload(callOptions, payload)
        ? (payload as IRpcPortableValue | undefined)
        : payloadValue(payload, this.#config.supportsBinary),
      callOptions
    )
  }

  /** Preserve the original group admission, failure and resource boundary. */
  group = (steps: readonly IRpcRuntimeStep[], callOptions?: IRpcRuntimeSendOptions) => {
    ;(0, this.#config.restrictTransfer)?.(callOptions)
    if (!this.#config.runtimeOutbound || !this.#config.generation) rejectRuntimeApiCapability()
    /** Snapshot the owning grammar before any this.#config.route read can execute a user getter. */
    const normalized = captureRuntimeGroupSteps(steps)
    for (const step of normalized) (0, this.#config.route)(step.method, RpcRuntimeMode.request)
    return this.#config.ready.group(this.#config.peerId, normalized, callOptions)
  }

  /** Preserve the original outcome admission, failure and resource boundary. */
  outcome = (idempotencyKey: string) => {
    if (!this.#config.runtimeOutbound || !this.#config.generation) rejectRuntimeApiCapability()
    return this.#config.ready.outcome(this.#config.peerId, idempotencyKey)
  }
}

/** Project the same frozen call operations from their named context owner. */
export function createRuntimePeerCalls(config: IRuntimePeerCallConfig) {
  return Object.freeze(new RuntimePeerCalls(config))
}

/** Original native drain operation shape, held once rather than reconstructed for each request. */
type ICoreRequestTracker = {
  <T>(operation: () => Promise<T>): Promise<T>
  <T>(
    operation: (method: string, payload: unknown, options: ICoreRuntimeCallOptions) => Promise<T>,
    method: string,
    payload: unknown,
    options: ICoreRuntimeCallOptions
  ): Promise<T>
}
/** Immutable inputs borrowed from the genuine endpoint and generation owners. */
type IManagedRuntimeCallConfig = Readonly<{
  /** The held native owner supplies only its original transfer rejection policy. */
  restrictTransfer?: (options: object | undefined) => void
  callTimeout: (options?: ICoreRuntimeCallOptions) => ICoreRuntimeCallOptions
  callDeadlineCapMs?: number
  trackRequest?: ICoreRequestTracker
  registration: Readonly<{
    invokeRequest(
      method: string,
      payload: unknown,
      options?: ICoreRuntimeCallOptions,
      mode?: 'request' | 'notify'
    ): Promise<IRpcPortableValue>
    invokeStream(
      method: string,
      payload: unknown,
      options?: ICoreRuntimeCallOptions
    ): AsyncIterableIterator<IRpcPortableValue>
    invokeGroup(
      steps: readonly IRpcRuntimeStep[],
      options?: IRpcRuntimeSendOptions
    ): Promise<readonly IRpcRuntimeStepOutcome[]>
    currentPeer(): ReturnType<typeof createRuntimePeerCalls>
    /** True while the next generation is starting and no current Peer exists. */
    readonly restarting: boolean
  }>
}>

/** One named call operator owns its original endpoint/registration context and callback identities. */
class ManagedRuntimeCalls {
  /** The exact original context retains transfer, route, clock and receiver policy. */
  #config: IManagedRuntimeCallConfig
  /** The original transfer callback is captured once and invoked with its bare receiver. */
  #restrictTransfer: IManagedRuntimeCallConfig['restrictTransfer']
  /** Default call options keep the original captured timeout callback identity. */
  #callTimeout: IManagedRuntimeCallConfig['callTimeout']
  /** Exact registration identity is captured before native tracker construction. */
  #registration: IManagedRuntimeCallConfig['registration']
  /** Preserve the original trackRequest receiver record and native drain callback. */
  #binding: { trackRequest: ICoreRequestTracker | undefined }

  /** Retain original owner inputs without preparing a request, stream or native generation. */
  constructor(config: IManagedRuntimeCallConfig) {
    this.#config = config
    this.#restrictTransfer = config.restrictTransfer
    this.#callTimeout = config.callTimeout
    this.#registration = config.registration
    this.#binding = { trackRequest: config.trackRequest }
  }

  /** Original request dispatch retains its existing restart/error timing. */
  #request = (method: string, payload: unknown, callOptions: ICoreRuntimeCallOptions) =>
    this.#registration.invokeRequest(method, payload, callOptions)

  /** Original notifyCurrent dispatch retains its existing restart/error timing. */
  #notifyCurrent = (
    method: string,
    payload: unknown,
    callOptions: ICoreRuntimeCallOptions | undefined
  ): Promise<void> =>
    this.#registration.restarting
      ? new Promise<void>((resolve) => {
          resolve(this.#registration.currentPeer().notify(method, payload, callOptions))
        })
      : this.#registration.currentPeer().notify(method, payload, callOptions)

  /** Original streamCurrent dispatch retains its existing restart/error timing. */
  #streamCurrent = (method: string, payload: unknown, callOptions: ICoreRuntimeCallOptions) =>
    this.#registration.restarting
      ? this.#registration.invokeStream(method, payload, callOptions)
      : this.#registration.currentPeer().stream(method, payload, callOptions)

  /** Preserve the original request admission, failure and resource boundary. */
  request = (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
    ;(0, this.#restrictTransfer)?.(callOptions)
    /** Logical retry settlement must finish before native drain can retire its generation. */
    return this.#binding.trackRequest
      ? this.#binding.trackRequest(
          this.#request,
          method,
          payload,
          (0, this.#callTimeout)(callOptions)
        )
      : this.#request(method, payload, (0, this.#callTimeout)(callOptions))
  }

  /** Preserve the original notify admission, failure and resource boundary. */
  notify = (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
    ;(0, this.#restrictTransfer)?.(callOptions)
    return isForwardedPayload(callOptions, payload)
      ? this.#registration
          .invokeRequest(method, payload, callOptions, 'notify')
          .then(() => undefined)
      : this.#notifyCurrent(method, payload, callOptions)
  }

  /** Preserve the original stream admission, failure and resource boundary. */
  stream = (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
    ;(0, this.#restrictTransfer)?.(callOptions)
    return isForwardedPayload(callOptions, payload) || this.#config.callDeadlineCapMs !== undefined
      ? this.#registration.invokeStream(method, payload, (0, this.#callTimeout)(callOptions))
      : this.#streamCurrent(method, payload, (0, this.#callTimeout)(callOptions))
  }

  /** Preserve the original group admission, failure and resource boundary. */
  group = (steps: readonly IRpcRuntimeStep[], callOptions?: IRpcRuntimeSendOptions) => {
    ;(0, this.#restrictTransfer)?.(callOptions)
    return this.#registration.restarting
      ? new Promise<readonly IRpcRuntimeStepOutcome[]>((resolve) => {
          resolve(this.#registration.invokeGroup(steps, callOptions))
        })
      : this.#registration.invokeGroup(steps, callOptions)
  }

  /** Preserve the original outcome admission, failure and resource boundary. */
  outcome = (key: string) =>
    this.#registration.restarting
      ? new Promise<
          Awaited<
            ReturnType<
              ReturnType<IManagedRuntimeCallConfig['registration']['currentPeer']>['outcome']
            >
          >
        >((resolve) => {
          resolve(this.#registration.currentPeer().outcome(key))
        })
      : this.#registration.currentPeer().outcome(key)
}

/** Project the same frozen call operations from their named context owner. */
export function createManagedRuntimeCalls(config: IManagedRuntimeCallConfig) {
  return Object.freeze(new ManagedRuntimeCalls(config))
}
