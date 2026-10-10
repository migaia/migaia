import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcPortableValue } from '../../contract/types.js'
import type {
  IRpcRuntimeGeneration,
  IRpcRuntimeStep,
  IRpcRuntimeStepOutcome,
  IRpcRuntimeOutcomeResult
} from '../../contract/runtime-api/types.js'
import { RpcCapability } from '../../contract/wire-constants.js'
import { RpcRuntimeMode } from '../../contract/runtime-api/constants.js'
import { normalizeRuntimeSteps } from '../../contract/runtime-api/metadata.js'
import { normalizePortable, hasRpcPortableBinary } from '../../contract/normalize.js'
import type { IRpcEndpoint, ISendOptions, IRpcAbortSignal } from '../typing.js'
import { RpcError, RpcCoreErrorCode, RpcRemoteError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import {
  createRuntimeRequestInput,
  readRuntimeRequestInput,
  retainRuntimeRequestInput,
  isForwardedPayload,
  retainForwardOptions,
  type IRuntimeRequestInput
} from './outbound-envelope.js'
import { readEndpointOwner } from './endpoint-projection.js'
import { EndpointOwnerKey } from '../endpoint-kernel.js'
import type { RpcOutboundAttachment, IRpcRuntimeSendOptions } from './outbound-attachment.js'
import type { RpcStreamOwner } from './stream/owner.js'
import { prepareRuntimeStreamConsumer, retainRuntimeStreamPreparation } from './stream/owner.js'
import { createProviderGenerationRetired } from './provider.js'
import { assertRpcIdempotencyKey, defaultRpcId } from './id.js'
import { rejectRuntimeApiCapability } from './runtime-api-endpoint.js'
import type { IRpcStreamRuntime } from '../features/stream.js'
import {
  assertRuntimeTransferFamily,
  retainRuntimeTransferOptions
} from './runtime-call-options.js'

/** Raw local options carry no admitted input token or wire authority. */
export type ICoreRuntimeCallOptions = Omit<ISendOptions, 'transfer' | 'trace'> &
  Readonly<{ orderKey?: string; cancel?: 'before-start'; transfer?: readonly ArrayBuffer[] }>
/** The original generation event resource owns readiness and departure. */
type ICallEvents = Readonly<{
  current(): Readonly<{ generation: number; active: boolean }>
  onLeave(generation: number, listener: (reason: unknown) => void): () => void
  whenReady(afterGeneration: number, signal?: IRpcAbortSignal): Promise<number>
}>
/** Retry sees one send closure; the private captured input never leaves Core. */
export type ICoreRuntimeRetryDispatch = Readonly<{
  method: string
  mode: 'request'
  idempotent: boolean
  key?: string
  generation: number
  signal?: IRpcAbortSignal
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
  if (error instanceof RpcRemoteError && error.cause instanceof Error) throw error.cause
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
  const binaryPayload = hasRpcPortableBinary(input.payload)
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
  /** Only Core-to-Core dispatch stores a private input association; no token crosses Remote. */
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

/**
 * This is the existing managed logical request sequence with capture and private state owned by
 * Core.
 */
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
      let retired: Error | undefined
      const unsubscribe = binding.events.onLeave(active.number, (reason) => {
        retired = createProviderGenerationRetired(reason)
      })
      return operation
        .then(
          (result) => {
            if (retired) throw retired
            return result
          },
          (error) => {
            throw retired ?? error
          }
        )
        .finally(unsubscribe)
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
          throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.idempotencyKeyInvalid)
        if (
          attempt.remainingMs !== undefined &&
          (!Number.isFinite(attempt.remainingMs) || attempt.remainingMs <= 0)
        )
          throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.timeoutInvalid)
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

/**
 * Move the original lazy registration control closure into Core; one actual consumer owns its
 * state.
 */
function streamBound(
  binding: ICoreRuntimeCallBinding,
  method: string,
  payload: unknown,
  options: ICoreRuntimeCallOptions
): IRuntimeReadyConsumer {
  let consumer: IRuntimeReadyConsumer | undefined
  let retired: Error | undefined
  let unsubscribe: (() => void) | undefined
  const current = (): IRuntimeReadyConsumer => {
    if (consumer) return consumer
    const input = createRuntimeRequestInput(method, payload, true, options)
    const declaration = binding.declaration(method, 'stream')
    binding.validateOptions(options)
    binding.guard?.(method, 'stream', binding.observedGeneration())
    const active = binding.current()
    const timeoutMs = binding.timeout(options.timeoutMs)
    const callOptions = retainForwardOptions(
      options,
      retainRuntimeTransferOptions(options, {
        ...options,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      })
    )
    const owner = readEndpointOwner<RpcStreamOwner>(active.endpoint, EndpointOwnerKey.streamOwner)
    const outbound = readEndpointOwner<RpcOutboundAttachment>(
      active.endpoint,
      EndpointOwnerKey.outboundAttachment
    )
    if (!owner || !outbound) unsupported()
    const native =
      active.channel.agreement.capabilities.includes(RpcCapability.portableBinary) ||
      callOptions.orderKey !== undefined ||
      callOptions.cancel !== undefined ||
      Object.hasOwn(callOptions, 'transfer')
    if (native) {
      const generation = outbound.runtimeTargetGeneration(active.channel.peerId)
      if (!generation) unsupported()
      consumer = owner.openRuntime(
        active.channel.peerId,
        method,
        input.payload,
        generation,
        callOptions as IRpcRuntimeSendOptions
      ) as IRuntimeReadyConsumer
    } else
      consumer = (active.endpoint as unknown as { stream: IRpcStreamRuntime }).stream.open(
        active.channel.peerId,
        declaration?.stream ?? method,
        input.payload,
        callOptions
      ) as IRuntimeReadyConsumer
    if (isRelay(payload, options))
      unsubscribe = binding.events.onLeave(active.number, (reason) => {
        retired = createProviderGenerationRetired(reason)
      })
    return consumer
  }
  const observe = async (
    operation: () => Promise<IteratorResult<IRpcPortableValue>>
  ): Promise<IteratorResult<IRpcPortableValue>> => {
    try {
      const result = await operation()
      if (result.done) unsubscribe?.()
      return result
    } catch (error) {
      unsubscribe?.()
      throw retired ?? error
    }
  }
  const facade: IRuntimeReadyConsumer = {
    next: () => observe(() => current().next()),
    return: (value?: IRpcPortableValue) => observe(() => current().return!(value)),
    throw: (reason?: unknown) => observe(() => current().throw!(reason)),
    [Symbol.asyncIterator]() {
      return this
    }
  }
  if (options.orderKey !== undefined || options.cancel !== undefined)
    retainRuntimeStreamPreparation(facade, async () => {
      try {
        await prepareRuntimeStreamConsumer(current())
      } catch (error) {
        unsubscribe?.()
        throw retired ?? error
      }
    })
  return Object.freeze(facade)
}

/** Capture, retry and lazy stream controls stay together at the existing Core operation owner. */
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

/** Direct Peer operators retain each original transfer/timeout/route/capture prefix. */
export function createRuntimePeerCalls(
  config: Readonly<{
    processFamily: boolean
    callTimeout: (options?: ICoreRuntimeCallOptions) => ICoreRuntimeCallOptions
    route: (method: string, mode: 'request' | 'notify' | 'stream') => void
    ready: Pick<IRpcEndpoint, 'send'> &
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
) {
  const {
    processFamily,
    callTimeout,
    route,
    ready,
    runtimeOutbound,
    supportsBinary,
    supportsStream,
    routes
  } = config
  const channel = { peerId: config.peerId }
  const remote = { self: { generation: config.generation } }
  return Object.freeze({
    request: (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
      assertRuntimeTransferFamily(processFamily, callOptions)
      callOptions = callTimeout(callOptions)
      route(method, RpcRuntimeMode.request)
      if (
        supportsBinary ||
        callOptions?.orderKey !== undefined ||
        callOptions?.cancel !== undefined ||
        (callOptions !== undefined && Object.hasOwn(callOptions, 'transfer'))
      ) {
        if (!runtimeOutbound || !remote.self.generation) rejectRuntimeApiCapability()
        return runtimeOutbound.sendRuntimeOperation(
          channel.peerId,
          remote.self.generation,
          'request',
          createRuntimeRequestInput(
            method,
            payload,
            supportsBinary || rejectRuntimeApiCapability,
            callOptions
          ),
          callOptions
        ) as Promise<IRpcPortableValue | undefined>
      }
      /** Original legacy framing retains its depth-two payload boundary without a facade walk. */
      const input = createRuntimeRequestInput(
        method,
        payload,
        supportsBinary || rejectRuntimeApiCapability,
        callOptions,
        2
      )
      const result = ready.send<IRpcPortableValue | undefined>(
        channel.peerId,
        method,
        input.payload,
        retainRuntimeRequestInput({ ...callOptions }, input)
      )
      return routes.get(method)?.forwardedVia || isForwardedPayload(callOptions, payload)
        ? result.catch(restoreForwardError)
        : result
    },
    notify: (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
      assertRuntimeTransferFamily(processFamily, callOptions)
      route(method, RpcRuntimeMode.notify)
      /**
       * Plain notify has no binary result; its existing physical/forward completion path stays
       * intact.
       */
      const normalizedPayload = isForwardedPayload(callOptions, payload)
        ? (payload as IRpcPortableValue | undefined)
        : payloadValue(payload, supportsBinary)
      if (
        hasRpcPortableBinary(normalizedPayload) ||
        callOptions?.orderKey !== undefined ||
        callOptions?.cancel !== undefined ||
        (callOptions !== undefined && Object.hasOwn(callOptions, 'transfer'))
      ) {
        if (!runtimeOutbound || !remote.self.generation) rejectRuntimeApiCapability()
        return runtimeOutbound.sendRuntimeOperation(
          channel.peerId,
          remote.self.generation,
          'notify',
          { method, payload: normalizedPayload },
          callOptions,
          isForwardedPayload(callOptions, payload)
        ) as Promise<void>
      }
      /**
       * The private forward operation awaits C's existing provider response, unlike ordinary
       * notify.
       */
      if (isForwardedPayload(callOptions, payload))
        return ready
          .send(channel.peerId, method, payload, callOptions)
          .then(() => undefined, restoreForwardError)
      return ready.sendOneWay(channel.peerId, method, normalizedPayload, callOptions)
    },
    stream: (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
      assertRuntimeTransferFamily(processFamily, callOptions)
      callOptions = callTimeout(callOptions)
      if (!supportsStream) rejectRuntimeApiCapability()
      route(method, RpcRuntimeMode.stream)
      if (
        supportsBinary ||
        callOptions?.orderKey !== undefined ||
        callOptions?.cancel !== undefined ||
        (callOptions !== undefined && Object.hasOwn(callOptions, 'transfer'))
      ) {
        if (!runtimeOutbound || !remote.self.generation) rejectRuntimeApiCapability()
        /** The same canonical stream owner retains its existing consumer and single-credit loop. */
        const owner = readEndpointOwner<RpcStreamOwner>(ready, EndpointOwnerKey.streamOwner)
        if (!owner) rejectRuntimeApiCapability()
        return owner.openRuntime(
          channel.peerId,
          method,
          payloadValue(payload, supportsBinary),
          remote.self.generation,
          callOptions
        )
      }
      return ready.stream!.open(
        channel.peerId,
        routes.get(method)!.stream,
        isForwardedPayload(callOptions, payload)
          ? (payload as IRpcPortableValue | undefined)
          : payloadValue(payload, supportsBinary),
        callOptions
      )
    },
    group: (steps: readonly IRpcRuntimeStep[], callOptions?: IRpcRuntimeSendOptions) => {
      assertRuntimeTransferFamily(processFamily, callOptions)
      if (!runtimeOutbound || !remote.self.generation) rejectRuntimeApiCapability()
      /** Snapshot the owning grammar before any route read can execute a user getter. */
      let normalized: readonly IRpcRuntimeStep[]
      try {
        normalized = normalizeRuntimeSteps(steps)
      } catch (cause) {
        throw new RpcError(
          RpcCoreErrorCode.invalidConfig,
          RpcCoreErrorText.runtimeGroupStepsInvalid,
          cause
        )
      }
      for (const step of normalized) route(step.method, RpcRuntimeMode.request)
      return runtimeOutbound.sendRuntimeOperation(
        channel.peerId,
        remote.self.generation,
        'group',
        { steps: normalized },
        callOptions
      ) as Promise<readonly IRpcRuntimeStepOutcome[]>
    },
    outcome: (idempotencyKey: string) => {
      if (!runtimeOutbound || !remote.self.generation) rejectRuntimeApiCapability()
      return runtimeOutbound.sendRuntimeOperation(
        channel.peerId,
        remote.self.generation,
        'outcome',
        { idempotencyKey }
      ) as Promise<IRpcRuntimeOutcomeResult>
    }
  })
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
/** Managed public prefixes delegate raw data to the existing Core binding/direct operations. */
export function createManagedRuntimeCalls(
  config: Readonly<{
    processFamily: boolean
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
    }>
  }>
) {
  const { processFamily, callTimeout, registration } = config
  const binding = { trackRequest: config.trackRequest }
  const request = (method: string, payload: unknown, callOptions: ICoreRuntimeCallOptions) =>
    registration.invokeRequest(method, payload, callOptions)
  return Object.freeze({
    request: (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
      assertRuntimeTransferFamily(processFamily, callOptions)
      /** Logical retry settlement must finish before native drain can retire its generation. */
      return binding.trackRequest
        ? binding.trackRequest(request, method, payload, callTimeout(callOptions))
        : request(method, payload, callTimeout(callOptions))
    },
    notify: (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
      assertRuntimeTransferFamily(processFamily, callOptions)
      return isForwardedPayload(callOptions, payload)
        ? registration.invokeRequest(method, payload, callOptions, 'notify').then(() => undefined)
        : registration.currentPeer().notify(method, payload, callOptions)
    },
    stream: (method: string, payload?: unknown, callOptions?: ICoreRuntimeCallOptions) => {
      assertRuntimeTransferFamily(processFamily, callOptions)
      return isForwardedPayload(callOptions, payload) || config.callDeadlineCapMs !== undefined
        ? registration.invokeStream(method, payload, callTimeout(callOptions))
        : registration.currentPeer().stream(method, payload, callTimeout(callOptions))
    },
    group: (steps: readonly IRpcRuntimeStep[], callOptions?: IRpcRuntimeSendOptions) => {
      assertRuntimeTransferFamily(processFamily, callOptions)
      return registration.invokeGroup(steps, callOptions)
    },
    outcome: (key: string) => registration.currentPeer().outcome(key)
  })
}
