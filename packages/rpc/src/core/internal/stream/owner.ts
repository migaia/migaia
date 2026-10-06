import { normalizeRuntimePortable } from '../../../contract/normalize.js'
import {
  createOutboundEnvelope,
  retainForwardOptions,
  readForwardRoute
} from '../outbound-envelope.js'
import {
  retainProviderPreflight,
  retainProviderFailureRoute,
  readProviderStreamAdmission
} from '../provider.js'
import {
  deserializeRpcError,
  invalidRpcStream,
  normalizeStreamPayload,
  RpcEnvelopeKind,
  RpcRouteProfile,
  RpcStreamEvent,
  RpcStreamViolation,
  serializeRpcError,
  type IRpcEnvelope,
  type IRpcPortableValue,
  type IRpcStreamPayload
} from '../../../contract/index.js'
import { RpcCoreErrorCode, RpcError, RpcAbortError, RpcTimeoutError } from '../../errors.js'
import { RpcCoreErrorText } from '../../error-text.js'
import { RpcStreamErrorText } from './error-text.js'
import { EndpointOwnerKey, type IEndpointKernelHost } from '../../endpoint-kernel.js'
import type {
  IRpcStreamCapabilityPort,
  IRpcStreamRun,
  IRpcStreamRuntime
} from '../../features/stream.js'
import type { IPreparedEndpoint } from '../endpoint-bootstrap.js'
import { allocateRpcId } from '../id.js'
import { OperationScope } from '../operation-scope.js'
import type { IRpcFrameAdmission, IRpcOutboundOperationsPort } from '../plugin-shared-keys.js'
import { tupleKey } from '../safe-value.js'
import { resolveAbortReason, type IAbortSignal } from '../async-control.js'
import { authenticationReplyReceiverId } from '../authentication-replay.js'
import type { IEndpointTimer } from '../time-port.js'
import type { IRpcAbortSignal, IRpcContext } from '../../typing.js'
import { RpcStreamLimit } from '../../../contract/stream-constants.js'
import type { IProviderRuntimeStream } from '../provider.js'
import type { RpcOutboundAttachment, IRpcRuntimeSendOptions } from '../outbound-attachment.js'
import type { IInboundIdentityAdmission } from '../inbound-identity.js'
import type {
  IRpcRuntimeEnvelope,
  IRpcRuntimeGeneration,
  IRpcRuntimeTask
} from '../../../contract/runtime-api/types.js'
import {
  RpcRuntimeKind,
  RpcRuntimeOperation,
  RpcRuntimeProfile,
  RpcRuntimeCancel,
  RpcRuntimeFinish,
  RpcRuntimeField
} from '../../../contract/runtime-api/constants.js'

/** Only an original opt-in consumer exposes its existing lazy open/ready boundary to a relay. */
const runtimeStreamReady = Symbol('rpc-runtime-stream-ready')

/** Keep the existing managed facade's preparation tied to its sole original downstream consumer. */
export function retainRuntimeStreamPreparation<T extends AsyncIterableIterator<IRpcPortableValue>>(
  facade: T,
  prepare: () => Promise<void>
): T {
  Object.defineProperty(facade, runtimeStreamReady, { value: prepare })
  return facade
}

/** Prepare the same downstream consumer without issuing a pull or creating another iterator. */
export function prepareRuntimeStreamConsumer(
  iterator: AsyncIterableIterator<IRpcPortableValue>
): Promise<void> {
  const prepare = Reflect.get(iterator, runtimeStreamReady) as (() => Promise<void>) | undefined
  if (!prepare)
    throw new RpcError(
      RpcCoreErrorCode.capabilityUnsupported,
      RpcCoreErrorText.capabilityUnsupported
    )
  return prepare()
}

/** Opt-in metadata stays on the original consumer, including its one final settlement. */
type IRuntimeConsumer = {
  readonly task: IRpcRuntimeTask
  readonly options: IRpcRuntimeSendOptions
  /** Retains the actual original receiver-preparation promise, independently of physical completion. */
  prepared?: Promise<IRpcRuntimeEnvelope>
  envelope?: IRpcRuntimeEnvelope
  finishing?: Promise<IteratorResult<IRpcPortableValue>>
  resolveFinal?: (result: IteratorResult<IRpcPortableValue>) => void
  rejectFinal?: (error: unknown) => void
}

/** One pending caller pull; the enclosing state owns settlement and its sequence. */
type IConsumerPull = {
  readonly resolve: (result: IteratorResult<IRpcPortableValue>) => void
  readonly reject: (reason: unknown) => void
}

/** Caller state is keyed by the selected target and the initial request id. */
type IConsumerState = {
  /** Only an opted-in stream retains generation identity and final-return settlement. */
  runtime?: IRuntimeConsumer
  /** Only an originally admitted open reply can select the exact source-less stream receiver. */
  receiverId?: string
  readonly id: string
  readonly targetId: string
  readonly method: string
  readonly scope: OperationScope
  readonly timeoutMs: number | undefined
  readonly ready: Promise<void>
  readonly resolveReady: () => void
  readonly rejectReady: (reason: unknown) => void
  openSend?: Promise<void>
  timer?: IEndpointTimer
  removeAbort?: () => void
  seq: number
  pending?: IConsumerPull
  pullAdmission?: AbortController
  terminal?:
    | { readonly done: true; readonly value?: IRpcPortableValue }
    | { readonly error: unknown }
}

/** A sent cancel retains only its sequence and cleanup result until peer acknowledgement. */
type IPendingCancel = {
  readonly seq: number
  readonly resolve: (cleanupError?: unknown) => void
  settled?: boolean
}

/** Producer state is keyed by admitted sender and id, never by method alone. */
type IProducerState = {
  /** Original native quota/drain cleanup stays attached to this producer's existing lifetime. */
  nativeSettlement?: (succeeded: boolean) => void
  /** Only actual iterator.done establishes successful native policy settlement. */
  nativeSucceeded?: boolean
  /** The final executor supplies admission/start/seal authority to this same iterator owner. */
  readonly runtime?: IProviderRuntimeStream
  /** Finish switches this original single-credit loop to discard, never another producer. */
  discard?: boolean
  /** The admitted request's signed reply identity survives terminal removal from the producer Map. */
  readonly receiverId?: string
  /** The admitted immutable node route accompanies failures from later iterator pulls. */
  readonly route?: readonly string[]
  /** Protected stream admission waits until all next/return/write work actually finishes. */
  readonly lifetime?: {
    /** Counts only operations already started for this exact producer, independent of Map deletion. */
    pending: number
    /** Completes at terminal with no remaining operation, retaining the stream-open replay entry. */
    readonly settled: Promise<void>
    /** Promise resolution is idempotent and never aborts or recreates the stream. */
    readonly resolve: () => void
  }
  readonly id: string
  readonly senderId: string
  readonly iterator: AsyncIterator<IRpcPortableValue> | Iterator<IRpcPortableValue>
  readonly scope: OperationScope
  timer?: IEndpointTimer
  itemAdmission?: AbortController
  seq: number
  busy: boolean
  terminal: boolean
}

/** The one optional stream owner attached to a composed endpoint kernel. */
export class RpcStreamOwner implements IRpcStreamRuntime {
  /** Canonical endpoint state and time owner. */
  readonly #kernel: IEndpointKernelHost
  /** Construction snapshot used only for id allocation and local identity. */
  readonly #prepared: IPreparedEndpoint<string>
  /** All stream frames use the existing outbound operation. */
  readonly #outbound: IRpcOutboundOperationsPort
  /** Shared provider namespace registration port. */
  readonly #registerStream: (
    method: string,
    handler: (
      message: unknown,
      createContext: (signal: IRpcAbortSignal) => IRpcContext
    ) => void | Promise<void>
  ) => () => void
  /** Connection capability decision supplied by the channel owner. */
  readonly #capability: IRpcStreamCapabilityPort | undefined
  /** Caller-owned streams, isolated by target and id. */
  readonly #consumers = new Map<string, IConsumerState>()
  /** Producer-owned streams, isolated by admitted sender and id. */
  readonly #producers = new Map<string, IProducerState>()
  /** Cancelled caller keys remain admitted until their terminal peer notification. */
  readonly #pendingCancels = new Map<string, IPendingCancel>()
  /** Bounded early cancels prevent delayed requests from starting orphan work. */
  readonly #earlyCancels = new Map<string, { senderId: string; seq: number }>()
  /** A peer that exceeded its early-cancel budget cannot start an orphan producer. */
  readonly #earlyCancelOverflow = new Set<string>()
  /** Provider registrations released on feature disposal. */
  readonly #registrations = new Set<() => void>()
  /** Kernel route release is idempotent and belongs to this feature. */
  readonly #releaseRoute: () => void
  /** This optional callback uses the outbound owner's existing transport subscription. */
  readonly #releaseTransportFailure: (() => void) | undefined
  /** Prevents new streams during reverse feature disposal. */
  #closed = false

  /** Installs the stream route and reuses the provider and outbound feature ports. */
  constructor(
    kernel: IEndpointKernelHost,
    prepared: IPreparedEndpoint<string>,
    outbound: IRpcOutboundOperationsPort,
    registerStream: (
      method: string,
      handler: (
        message: unknown,
        createContext: (signal: IRpcAbortSignal) => IRpcContext
      ) => void | Promise<void>
    ) => () => void,
    capability?: IRpcStreamCapabilityPort
  ) {
    this.#kernel = kernel
    this.#prepared = prepared
    this.#outbound = outbound
    this.#registerStream = registerStream
    this.#capability = capability
    /** The existing consumer Map is the sole logical client stream count; producers are excluded. */
    kernel.registerOwner(EndpointOwnerKey.streamConsumerRegistry, this.#consumers)
    kernel.registerOwner(EndpointOwnerKey.streamOwner, this)
    this.#releaseTransportFailure = outbound.onTransportFailure?.((error) =>
      this.#transportFailed(error)
    )
    this.#releaseRoute = kernel.registerRoute(RpcEnvelopeKind.stream, (message) =>
      this.#receive(message)
    )
  }

  /** Lazily opens one remote stream; no request is sent before the first next. */
  open(
    targetId: string,
    method: string,
    params: unknown,
    options?: Readonly<{ signal?: IAbortSignal; timeoutMs?: number | false }>
  ): AsyncIterableIterator<IRpcPortableValue> {
    return this.#open(targetId, method, params, options)
  }

  /** New profile uses the same lazy consumer and iterator with actual accepted generation facts. */
  openRuntime(
    targetId: string,
    method: string,
    params: unknown,
    generation: IRpcRuntimeGeneration,
    options: IRpcRuntimeSendOptions
  ): AsyncIterableIterator<IRpcPortableValue> {
    return this.#open(targetId, method, params, options, generation)
  }

  /** Both profiles share the original consumer tail and lifecycle; metadata exists only on opt-in. */
  #open(
    targetId: string,
    method: string,
    params: unknown,
    options?: IRpcRuntimeSendOptions,
    generation?: IRpcRuntimeGeneration
  ): AsyncIterableIterator<IRpcPortableValue> {
    this.#kernel.assertActive()
    if (this.#closed) throw new RpcAbortError()
    let state: IConsumerState | undefined
    let unopenedTerminal: IConsumerState['terminal']
    let tail = Promise.resolve<unknown>(undefined)
    const next = (): Promise<IteratorResult<IRpcPortableValue>> => {
      const task = tail.then(async () => {
        if (unopenedTerminal) return this.#terminalResult(unopenedTerminal)
        if (!state) {
          try {
            state = this.#start(targetId, method, params, options, generation)
          } catch (error) {
            unopenedTerminal = { error }
            throw error
          }
        }
        return this.#next(state)
      })
      tail = task.then(
        () => undefined,
        () => undefined
      )
      return task
    }
    const close = async (
      value?: unknown,
      thrown = false
    ): Promise<IteratorResult<IRpcPortableValue>> => {
      if (!state) unopenedTerminal = { done: true }
      if (state?.runtime) {
        /**
         * Ordinary return after local terminal keeps legacy cleanup semantics; next keeps its
         * error.
         */
        if (!thrown && state.terminal && state.runtime.options.cancel !== RpcRuntimeCancel)
          return { done: true, value: value as IRpcPortableValue }
        try {
          /** Return observes the same actual producer terminal, including concurrent callers. */
          const result = await this.#finishRuntimeConsumer(state, thrown ? value : undefined)
          if (thrown) throw value
          return result
        } catch (error) {
          if (thrown && error !== value)
            throw new AggregateError([value, error], RpcStreamErrorText.cleanupFailed)
          throw error
        }
      }
      const cleanup = state
        ? await this.#cancelConsumer(state, { done: true }, thrown ? value : undefined)
        : undefined
      if (cleanup !== undefined) {
        if (thrown) throw new AggregateError([value, cleanup], RpcStreamErrorText.cleanupFailed)
        throw cleanup
      }
      if (thrown) throw value
      return { done: true, value: value as IRpcPortableValue }
    }
    /** Iterator identity remains the original consumer tail; metadata is present only for opt-in. */
    const iterator = {
      next,
      return: (value?: IRpcPortableValue) => close(value),
      throw: (reason?: unknown) => close(reason, true),
      [Symbol.asyncIterator]() {
        return this
      }
    }
    if (generation)
      Object.defineProperty(iterator, runtimeStreamReady, {
        value: () => {
          if (!state) {
            try {
              state = this.#start(targetId, method, params, options, generation)
            } catch (error) {
              unopenedTerminal = { error }
              throw error
            }
          }
          return state.ready
        }
      })
    return Object.freeze(iterator)
  }

  /** Claim a provider method in the ordinary namespace and release it idempotently. */
  provide(method: string, run: IRpcStreamRun): () => void {
    if (this.#closed) throw new RpcAbortError()
    const release = this.#registerStream(
      method,
      retainProviderPreflight(
        run,
        (message: unknown, createContext: (signal: IRpcAbortSignal) => IRpcContext) =>
          this.#acceptRequest(message, run, createContext)
      )
    )
    this.#registrations.add(release)
    return () => {
      release()
      this.#registrations.delete(release)
    }
  }

  /** Stop the optional route and settle only this feature's live streams. */
  async dispose(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#releaseRoute()
    this.#releaseTransportFailure?.()
    for (const release of this.#registrations) release()
    this.#registrations.clear()
    for (const state of this.#consumers.values())
      this.#finishConsumer(state, { error: new RpcAbortError() })
    for (const state of this.#producers.values()) {
      if (state.lifetime) state.lifetime.pending += 1
      this.#finishProducer(state, new RpcAbortError())
      try {
        await state.iterator.return?.()
      } catch (error) {
        this.#report(error)
      } finally {
        if (state.lifetime) state.lifetime.pending -= 1
        this.#settleProducer(state)
      }
    }
    this.#producers.clear()
    for (const key of this.#pendingCancels.keys()) this.#resolveCancel(key)
    this.#earlyCancels.clear()
    this.#earlyCancelOverflow.clear()
  }

  /** Allocate the sole operation scope and issue the initial request through outbound. */
  #start(
    targetId: string,
    method: string,
    params: unknown,
    options?: IRpcRuntimeSendOptions,
    generation?: IRpcRuntimeGeneration
  ): IConsumerState {
    if (this.#capability && !this.#capability.supports(targetId))
      throw new RpcError(RpcCoreErrorCode.capabilityConflict, RpcStreamErrorText.capabilityMissing)
    if (options?.signal?.aborted) throw readStreamAbortReason(options.signal)
    const id = allocateRpcId(
      this.#outbound.defaultGenerate
        ? { ...this.#prepared.options.uuid, generate: this.#outbound.defaultGenerate }
        : (this.#prepared.options.uuid ?? {}),
      'task',
      this.#prepared.id,
      targetId,
      (candidate) => this.#consumers.has(tupleKey(targetId, candidate))
    )
    const scope = new OperationScope(
      this.#kernel.generation,
      options?.timeoutMs,
      this.#kernel.closingSignal,
      () => this.#kernel.time.now()
    )
    let resolveReady!: () => void
    let rejectReady!: (reason: unknown) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const state: IConsumerState = {
      id,
      targetId,
      method,
      scope,
      timeoutMs: options?.timeoutMs === false ? undefined : options?.timeoutMs,
      ready,
      resolveReady,
      rejectReady,
      seq: 0
    }
    if (generation) {
      /** The existing outbound replay registry supplies the sole bounded task reservation. */
      const outbound = this.#runtimeOutbound()
      /** Validation occurs before publishing the original consumer state. */
      let reserved: ReturnType<RpcOutboundAttachment['reserveRuntimeStream']>
      try {
        reserved = outbound.reserveRuntimeStream(id, generation, method, options ?? {})
      } catch (error) {
        scope.abort(error)
        throw error
      }
      state.runtime = { task: reserved.task, options: options ?? {} }
      state.runtime.prepared = outbound
        .prepareRuntimeStreamOpen(
          id,
          targetId,
          reserved.task,
          reserved.options,
          params as IRpcPortableValue | undefined,
          readForwardRoute(options)
        )
        .then((envelope) => {
          state.runtime!.envelope = envelope
          return envelope
        })
      state.openSend = state.runtime.prepared.then((envelope) => {
        return outbound.sendRuntimeFrame(
          envelope,
          {
            queueSignal: scope.signal,
            assertCanSend: () => scope.assertActive(this.#kernel.generation)
          },
          undefined,
          state.runtime!.options
        )
      })
    }
    this.#consumers.set(tupleKey(targetId, id), state)
    state.openSend ??= Promise.resolve().then(() =>
      this.#outbound.send(
        retainForwardOptions(options, {
          kind: 'stream-open',
          id,
          targetId,
          method,
          data: params,
          timeoutMs: options?.timeoutMs === false ? undefined : options?.timeoutMs,
          operation: { signal: scope.signal, remaining: () => scope.remaining(options?.timeoutMs) }
        })
      )
    )
    void state.openSend.catch((error) => {
      if (!state.terminal) this.#finishConsumer(state, { error: this.#sendFailureReason(error) })
    })
    if (options?.timeoutMs !== undefined && options.timeoutMs !== false) {
      state.timer = this.#kernel.time.setTimeout(() => {
        void this.#cancelConsumer(state, { error: new RpcTimeoutError() })
      }, options.timeoutMs)
    }
    if (options?.signal) {
      const onAbort = (): void => {
        void this.#cancelConsumer(state, { error: readStreamAbortReason(options.signal!) })
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
      state.removeAbort = () => options.signal!.removeEventListener('abort', onAbort)
    }
    return state
  }

  /** Send exactly one pull for each awaited caller next and settle it from the matching frame. */
  async #next(state: IConsumerState): Promise<IteratorResult<IRpcPortableValue>> {
    if (state.terminal) return this.#terminalResult(state.terminal, state.runtime !== undefined)
    await state.ready
    if (state.terminal) return this.#terminalResult(state.terminal, state.runtime !== undefined)
    return new Promise<IteratorResult<IRpcPortableValue>>((resolve, reject) => {
      state.pending = { resolve, reject }
      const admission = new AbortController()
      state.pullAdmission = admission
      const seq = state.seq
      void this.#sendFrame(
        state.targetId,
        state.id,
        {
          event: RpcStreamEvent.pull,
          seq: state.seq
        },
        {
          queueSignal: admission.signal,
          assertCanSend: () => {
            this.#kernel.assertActive()
            if (state.terminal || !state.pending || state.seq !== seq) throw new RpcAbortError()
          }
        },
        state.receiverId,
        state.runtime?.envelope
      ).catch((error) => {
        if (state.terminal) return
        void this.#cancelConsumer(state, { error: this.#sendFailureReason(error) }, error)
      })
    })
  }

  /** Return sticky terminal completion or throw the original terminal error instance. */
  #terminalResult(
    terminal: NonNullable<IConsumerState['terminal']>,
    retainValue = false
  ): IteratorResult<IRpcPortableValue> {
    if ('error' in terminal) throw terminal.error
    return { done: true, value: retainValue ? terminal.value : undefined }
  }

  /** Only a top-level overload proves no physical frame was sent. */
  #sendFailureReason(error: unknown): unknown {
    if ((error as { readonly code?: unknown })?.code === RpcCoreErrorCode.overloaded) return error
    return new RpcError(
      RpcCoreErrorCode.streamResultUnknown,
      RpcStreamErrorText.resultUnknown,
      error
    )
  }

  /** Select one terminal result and release its scope without affecting other streams. */
  #finishConsumer(state: IConsumerState, terminal: NonNullable<IConsumerState['terminal']>): void {
    if (state.terminal) return
    state.terminal = terminal
    if (state.timer) this.#kernel.time.clearTimeout(state.timer)
    state.removeAbort?.()
    state.scope.abort('error' in terminal ? terminal.error : undefined)
    state.pullAdmission?.abort()
    this.#consumers.delete(tupleKey(state.targetId, state.id))
    if (state.runtime) {
      this.#runtimeOutbound().releaseRuntimeStream(state.id)
      if ('error' in terminal) state.runtime.rejectFinal?.(terminal.error)
      else state.runtime.resolveFinal?.({ done: true, value: terminal.value })
    }
    if ('error' in terminal) {
      state.rejectReady(terminal.error)
      state.pending?.reject(terminal.error)
    } else {
      state.resolveReady()
      state.pending?.resolve({ done: true, value: terminal.value })
    }
    state.pending = undefined
  }

  /** Settle locally first, then send at most one cancel after stream-open physically settles. */
  #cancelConsumer(
    state: IConsumerState,
    terminal: NonNullable<IConsumerState['terminal']>,
    reason?: unknown
  ): Promise<unknown> {
    if (state.runtime) {
      if (state.terminal) return Promise.resolve(undefined)
      /** Only selected before-start intent keeps its consumer for the final provider's decision. */
      if (state.runtime.options.cancel !== RpcRuntimeCancel) this.#finishConsumer(state, terminal)
      /** The same prepared task emits cancellation even after ordinary local settlement. */
      void state.runtime.prepared
        ?.then(() =>
          this.#sendRuntimeIntent(
            state,
            serializeRpcError(
              RpcRuntimeField.error in terminal ? terminal.error : new RpcAbortError(),
              {
                report: (failure) => this.#report(failure.error)
              }
            ),
            false
          )
        )
        .catch((error: unknown) => {
          if (!state.terminal) this.#finishConsumer(state, { error })
          else this.#report(error)
        })
      return Promise.resolve(undefined)
    }
    if (state.terminal) return Promise.resolve(undefined)
    const key = tupleKey(state.targetId, state.id)
    const acknowledgement = new Promise<unknown>((resolve) => {
      this.#pendingCancels.set(key, { seq: state.seq, resolve })
    })
    this.#finishConsumer(state, terminal)
    void state.openSend?.then(
      () => {
        const payload: IRpcStreamPayload = {
          event: RpcStreamEvent.cancel,
          seq: state.seq,
          ...(reason === undefined
            ? {}
            : {
                reason: serializeRpcError(reason, {
                  report: (failure) => this.#report(failure.error)
                })
              })
        }
        void this.#sendFrame(state.targetId, state.id, payload, undefined, state.receiverId).catch(
          (error) => {
            this.#report(error)
            this.#resolveCancel(key, error)
          }
        )
      },
      () => this.#resolveCancel(key)
    )
    return acknowledgement
  }

  /** Exact opt-in consumer control uses the original accepted task and physical-hop receiver. */
  #sendRuntimeIntent(
    state: IConsumerState,
    reason: import('../../../contract/types.js').IRpcSerializedError | undefined,
    finish: boolean
  ): Promise<void> {
    /** Open preparation completes before this original control is emitted. */
    const source = state.runtime!.envelope!
    return this.#runtimeOutbound().sendRuntimeFrame({
      profile: RpcRuntimeProfile,
      kind: RpcRuntimeKind.control,
      id: state.id,
      route: { ...source.route, sentAt: this.#kernel.time.timestamp() },
      task: source.task,
      ...(finish
        ? {
            operation: RpcRuntimeOperation.stream,
            stream: {
              event: RpcRuntimeFinish,
              seq: state.seq,
              ...(reason === undefined ? {} : { reason })
            }
          }
        : { operation: RpcRuntimeOperation.cancel, ...(reason === undefined ? {} : { reason }) })
    })
  }

  /** One original consumer final promise merges repeated return and concurrent next/finish. */
  #finishRuntimeConsumer(
    state: IConsumerState,
    reason?: unknown
  ): Promise<IteratorResult<IRpcPortableValue>> {
    /** This method is entered only by a genuinely selected runtime profile. */
    const runtime = state.runtime!
    if (runtime.finishing) return runtime.finishing
    runtime.finishing = new Promise((resolve, reject) => {
      runtime.resolveFinal = resolve
      runtime.rejectFinal = reject
    })
    if (state.terminal) {
      if ('error' in state.terminal) runtime.rejectFinal!(state.terminal.error)
      else runtime.resolveFinal!({ done: true, value: state.terminal.value })
    } else {
      void runtime.prepared
        ?.then(() =>
          this.#sendRuntimeIntent(
            state,
            reason === undefined
              ? undefined
              : serializeRpcError(reason, { report: (failure) => this.#report(failure.error) }),
            runtime.options.cancel === RpcRuntimeCancel
          )
        )
        .catch((error: unknown) => this.#finishConsumer(state, { error }))
    }
    return runtime.finishing
  }

  /** Canonical stream state borrows the existing outbound owner; it allocates no second sender. */
  #runtimeOutbound(): RpcOutboundAttachment {
    return this.#kernel.readOwner(EndpointOwnerKey.outboundAttachment) as RpcOutboundAttachment
  }

  /**
   * Authentication and complete task identity fence replies before they enter the original
   * consumer.
   */
  receiveRuntimeControl(envelope: IRpcRuntimeEnvelope, admission: IInboundIdentityAdmission): void {
    if (
      envelope.kind !== RpcRuntimeKind.control ||
      envelope.operation !== RpcRuntimeOperation.stream
    )
      return
    /** The original consumer Map is the only correlation directory for this credit protocol. */
    const state = this.#consumers.get(tupleKey(envelope.route.senderId, envelope.id))
    if (
      !state?.runtime ||
      !this.#runtimeOutbound().runtimeReplyMatches(envelope, state.runtime.task, admission)
    )
      return
    this.#receiveConsumer(
      envelope.route.senderId,
      envelope.id,
      envelope.stream as IRpcStreamPayload,
      authenticationReplyReceiverId(envelope),
      true
    )
  }

  /** Release a pending cancellation exactly once after peer notification or send rejection. */
  #resolveCancel(key: string, cleanupError?: unknown, keepForLateCancelled = false): void {
    const pending = this.#pendingCancels.get(key)
    if (!pending) return
    if (!keepForLateCancelled) this.#pendingCancels.delete(key)
    if (!pending.settled) {
      pending.settled = true
      pending.resolve(cleanupError)
    }
  }

  /** Build a protocol 1.1 frame using the canonical envelope and outbound owners. */
  #sendFrame(
    targetId: string,
    id: string,
    payload: IRpcStreamPayload,
    admission?: IRpcFrameAdmission,
    receiverId?: string,
    runtime?: IProviderRuntimeStream | IRpcRuntimeEnvelope
  ): Promise<void> {
    const normalized = runtime
      ? normalizeStreamPayload(payload, normalizeRuntimePortable)
      : normalizeStreamPayload(payload)
    if (runtime) {
      /** The protected task is copied from accepted state, never reconstructed from business data. */
      const source = 'seal' in runtime ? runtime.envelope : runtime
      return Promise.resolve().then(async () => {
        if (
          'seal' in runtime &&
          (normalized.event === RpcStreamEvent.end ||
            normalized.event === RpcStreamEvent.fail ||
            normalized.event === RpcStreamEvent.cancelled)
        )
          await runtime.seal(
            normalized.event === RpcStreamEvent.end
              ? {
                  ok: true,
                  ...(normalized.value === undefined ? {} : { result: normalized.value })
                }
              : {
                  ok: false,
                  error:
                    normalized.error ??
                    serializeRpcError(new RpcAbortError(), {
                      report: (failure) => this.#report(failure.error)
                    })
                }
          )
        await this.#runtimeOutbound().sendRuntimeFrame(
          {
            profile: RpcRuntimeProfile,
            kind: RpcRuntimeKind.control,
            id,
            route: {
              ...source.route,
              senderId: this.#prepared.id,
              targetId,
              receiverId: receiverId ?? targetId,
              sentAt: this.#kernel.time.timestamp()
            },
            task: source.task,
            operation: RpcRuntimeOperation.stream,
            stream: normalized
          } as IRpcRuntimeEnvelope,
          admission
        )
      })
    }
    const message = createOutboundEnvelope({
      kind: 'stream',
      id,
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'stream',
          applicationVersion: this.#prepared.options.contract?.version ?? '1.0',
          senderId: this.#prepared.id,
          targetId,
          ...(receiverId === undefined ? {} : { receiverId }),
          sentAt: this.#kernel.time.timestamp()
        },
        payload: normalized
      }
    })
    return this.#outbound.send({
      kind: 'frame',
      message,
      admission: admission ?? { assertCanSend: () => this.#kernel.assertActive() }
    })
  }

  /** Validate one admitted stream event and dispatch it to the peer-isolated role state. */
  async #receive(message: unknown): Promise<void> {
    const record = message as { envelope?: IRpcEnvelope }
    const envelope = record.envelope
    if (envelope?.kind !== 'stream' || envelope.data.route.targetId !== this.#prepared.id) return
    const senderId = envelope.data.route.senderId
    if (this.#capability && !this.#capability.supports(senderId)) {
      this.#report(
        new RpcError(RpcCoreErrorCode.protocolInvalid, RpcStreamErrorText.capabilityMissing)
      )
      return
    }
    let payload: IRpcStreamPayload
    try {
      payload = normalizeStreamPayload(envelope.data.payload)
    } catch (error) {
      this.#report(error)
      const key = tupleKey(senderId, envelope.id)
      const consumer = this.#consumers.get(key)
      if (consumer) void this.#cancelConsumer(consumer, { error }, error)
      const producer = this.#producers.get(key)
      if (producer) {
        this.#finishProducer(producer, error)
        void Promise.resolve()
          .then(() => producer.iterator.return?.())
          .catch((cleanupError) => this.#report(cleanupError))
          .then(() =>
            this.#sendFailure(
              senderId,
              envelope.id,
              producer.seq,
              error,
              undefined,
              producer.receiverId
            )
          )
      }
      return
    }
    if (payload.event === RpcStreamEvent.pull || payload.event === RpcStreamEvent.cancel)
      await this.#receiveProducer(senderId, envelope.id, payload)
    else
      this.#receiveConsumer(senderId, envelope.id, payload, authenticationReplyReceiverId(envelope))
  }

  /** Drive the consumer's one pending credit or terminal notification. */
  #receiveConsumer(
    senderId: string,
    id: string,
    payload: IRpcStreamPayload,
    receiverId?: string,
    runtimeControl = false
  ): void {
    const key = tupleKey(senderId, id)
    const state = this.#consumers.get(key)
    if (state?.runtime && !runtimeControl) return
    if (!state) {
      const pending = this.#pendingCancels.get(key)
      if (pending) {
        if (payload.event === RpcStreamEvent.cancelled && payload.seq !== pending.seq) {
          this.#report(invalidRpcStream(RpcStreamViolation.seq, '/seq'))
          return
        }
        if (
          payload.event === RpcStreamEvent.cancelled ||
          payload.event === RpcStreamEvent.end ||
          payload.event === RpcStreamEvent.fail
        )
          this.#resolveCancel(
            key,
            payload.error === undefined ? undefined : deserializeRpcError(payload.error),
            payload.event !== RpcStreamEvent.cancelled
          )
      } else if (payload.event === RpcStreamEvent.cancelled)
        this.#report(invalidRpcStream(RpcStreamViolation.seq, '/seq'))
      return
    }
    if (payload.event === RpcStreamEvent.open) {
      if (payload.seq !== 0) {
        this.#invalid(state, '/seq')
        return
      }
      if (receiverId !== undefined) state.receiverId = receiverId
      if (state.runtime?.options.cancel === RpcRuntimeCancel) {
        if (state.timer) this.#kernel.time.clearTimeout(state.timer)
        state.timer = undefined
        state.removeAbort?.()
        state.removeAbort = undefined
      }
      state.resolveReady()
      return
    }
    if (state.runtime) {
      if (payload.event === RpcStreamEvent.cancelled) {
        if (
          state.runtime.finishing &&
          state.runtime.options.cancel !== RpcRuntimeCancel &&
          payload.error === undefined
        ) {
          this.#finishConsumer(state, { done: true })
          return
        }
        this.#finishConsumer(state, {
          error:
            payload.error === undefined ? new RpcAbortError() : deserializeRpcError(payload.error)
        })
        return
      }
      if (
        (state.runtime.finishing || !state.pending) &&
        (payload.event === RpcStreamEvent.end || payload.event === RpcStreamEvent.fail)
      ) {
        if (payload.seq < state.seq) {
          this.#invalid(state, '/seq')
          return
        }
        this.#finishConsumer(
          state,
          payload.event === RpcStreamEvent.fail
            ? { error: deserializeRpcError(payload.error!) }
            : { done: true, ...(payload.value === undefined ? {} : { value: payload.value }) }
        )
        return
      }
      if (state.runtime.finishing && payload.event === RpcStreamEvent.item) {
        if (payload.seq !== state.seq) {
          this.#invalid(state, '/seq')
          return
        }
        state.seq += 1
        return
      }
    }
    if (payload.event === RpcStreamEvent.fail && !state.pending && payload.seq === 0) {
      this.#finishConsumer(state, { error: deserializeRpcError(payload.error!) })
      return
    }
    if (
      payload.event === RpcStreamEvent.item ||
      payload.event === RpcStreamEvent.end ||
      payload.event === RpcStreamEvent.fail
    ) {
      if (payload.seq !== state.seq || !state.pending) {
        this.#invalid(state, '/seq')
        return
      }
      if (payload.event === RpcStreamEvent.item) {
        state.pullAdmission?.abort()
        state.pullAdmission = undefined
        state.seq += 1
        state.pending.resolve({ done: false, value: payload.value! })
        state.pending = undefined
        return
      }
      if (payload.event === RpcStreamEvent.fail) {
        const error = deserializeRpcError(payload.error!)
        this.#finishConsumer(state, { error })
      } else
        this.#finishConsumer(state, {
          done: true,
          ...(Object.hasOwn(payload, 'value') ? { value: payload.value } : {})
        })
    }
  }

  /** Report a wrong credit once and terminate only its caller state. */
  #invalid(state: IConsumerState, pointer: string): void {
    const error = invalidRpcStream(RpcStreamViolation.seq, pointer)
    this.#report(error)
    void this.#cancelConsumer(state, { error }, error)
  }

  /** Hand off one admitted ordinary request to the registered stream producer. */
  async #acceptRequest(
    message: unknown,
    run: IRpcStreamRun,
    createContext: (signal: IRpcAbortSignal) => IRpcContext
  ): Promise<void> {
    /** Only the final executor can attach this opt-in start/seal/control provenance. */
    const runtime = (message as { runtime?: IProviderRuntimeStream }).runtime
    const request = (message as { envelope?: IRpcEnvelope }).envelope
    if (request?.kind !== 'request') return
    const senderId = request.data.route.senderId
    /** Original identity admission precedes this proof read; logical names cannot select replies. */
    const receiverId = runtime?.replyReceiverId ?? authenticationReplyReceiverId(request)
    if ((message as { preflightError?: unknown }).preflightError !== undefined) {
      await this.#sendFailure(
        senderId,
        request.id,
        0,
        (message as { preflightError: unknown }).preflightError,
        undefined,
        receiverId,
        runtime
      )
      return
    }
    if ((message as { replayRejected?: boolean }).replayRejected) {
      await this.#sendFailure(
        senderId,
        request.id,
        0,
        new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.requestReplayLedgerIsFull),
        undefined,
        receiverId,
        runtime
      )
      return
    }
    if (this.#capability && !this.#capability.supports(senderId)) {
      this.#report(
        new RpcError(RpcCoreErrorCode.protocolInvalid, RpcStreamErrorText.capabilityMissing)
      )
      return
    }
    const key = tupleKey(senderId, request.id)
    const early = runtime ? undefined : this.#earlyCancels.get(key)
    if (early) {
      this.#earlyCancels.delete(key)
      await this.#sendFrame(
        senderId,
        request.id,
        {
          event: RpcStreamEvent.cancelled,
          seq: early.seq
        },
        undefined,
        receiverId
      )
      return
    }
    if (!runtime && this.#earlyCancelOverflow.has(senderId)) {
      await this.#sendFailure(
        senderId,
        request.id,
        0,
        new RpcError(RpcCoreErrorCode.overloaded, RpcStreamErrorText.peerOverloaded),
        undefined,
        receiverId,
        runtime
      )
      return
    }
    if (this.#producers.has(key)) return
    let peerOpen = 0
    for (const state of this.#producers.values()) if (state.senderId === senderId) peerOpen += 1
    if (peerOpen >= RpcStreamLimit.maxOpenStreamsPerPeer) {
      await this.#sendFailure(
        senderId,
        request.id,
        0,
        new RpcError(RpcCoreErrorCode.overloaded, RpcStreamErrorText.peerOverloaded),
        undefined,
        receiverId,
        runtime
      )
      return
    }
    const scope = new OperationScope(
      this.#kernel.generation,
      runtime ? undefined : request.data.route.timeoutMs,
      runtime?.forwarded
        ? this.#kernel.closingSignal
        : (runtime?.signal ?? this.#kernel.closingSignal),
      () => this.#kernel.time.now()
    )
    let state: IProducerState
    /** Relay open uses the same provider context that constructed this original iterator. */
    let context: IRpcContext
    /** New-profile construction acquires native policy before any downstream relay can begin. */
    let nativeSettlement: IProducerState['nativeSettlement']
    try {
      context = createContext(runtime?.forwarded ? runtime.signal : scope.signal)
      if (runtime) nativeSettlement = readProviderStreamAdmission(run)?.(context)
      const iterable = run(request.data.payload, { signal: scope.signal, context }) as unknown
      const source = iterable as {
        [Symbol.asyncIterator]?: () => AsyncIterator<IRpcPortableValue>
        [Symbol.iterator]?: () => Iterator<IRpcPortableValue>
      } | null
      if (
        typeof iterable !== 'object' ||
        iterable === null ||
        (typeof source?.[Symbol.asyncIterator] !== 'function' &&
          typeof source?.[Symbol.iterator] !== 'function')
      )
        throw new RpcError(RpcCoreErrorCode.payloadInvalid, RpcStreamErrorText.iterableInvalid)
      const iterator =
        typeof source[Symbol.asyncIterator] === 'function'
          ? source[Symbol.asyncIterator]!()
          : source[Symbol.iterator]!()
      /** Legacy streams allocate no added lifetime state or Promise. */
      let lifetime: IProducerState['lifetime']
      if ((message as { activeLifetime?: boolean }).activeLifetime) {
        /** Resolving this producer's settlement cannot release any later same-ID admission. */
        let resolve!: () => void
        /** Open-frame work counts before a timer or cancel can mark the producer terminal. */
        const settled = new Promise<void>((done) => {
          resolve = done
        })
        lifetime = { pending: 1, settled, resolve }
      }
      state = {
        ...(nativeSettlement === undefined ? {} : { nativeSettlement }),
        ...(runtime === undefined ? {} : { runtime }),
        ...(receiverId === undefined ? {} : { receiverId }),
        route: request.data.route.forwardRoute,
        lifetime,
        id: request.id,
        senderId,
        iterator,
        scope,
        seq: 0,
        busy: false,
        terminal: false
      }
      this.#producers.set(key, state)
      runtime?.bindCancel((reason) =>
        this.#receiveProducer(
          senderId,
          request.id,
          {
            event: RpcStreamEvent.cancel,
            seq: state.seq,
            ...(reason === undefined
              ? {}
              : {
                  reason: serializeRpcError(reason, {
                    report: (failure) => this.#report(failure.error)
                  })
                })
          },
          true
        )
      )
      runtime?.bindControl((payload) => {
        if (payload.event === RpcRuntimeFinish) {
          /** Finish may only preserve the start permission selected on this admitted task. */
          if (runtime.envelope.options.cancel !== RpcRuntimeCancel)
            throw invalidRpcStream(RpcStreamViolation.event, '/stream/event')
          if (state.discard || state.terminal) return Promise.resolve()
          state.discard = true
          if (runtime.finishStream)
            return runtime
              .finishStream(
                payload.reason === undefined ? undefined : deserializeRpcError(payload.reason)
              )
              .then(() =>
                state.busy || state.itemAdmission !== undefined || state.terminal
                  ? undefined
                  : this.#receiveProducer(
                      senderId,
                      request.id,
                      { event: RpcStreamEvent.pull, seq: state.seq },
                      true
                    )
              )
          /** An outstanding physical item write retains its original discard-driving invocation. */
          return state.busy || state.itemAdmission !== undefined
            ? Promise.resolve()
            : this.#receiveProducer(
                senderId,
                request.id,
                { event: RpcStreamEvent.pull, seq: state.seq },
                true
              )
        }
        if (payload.event === RpcStreamEvent.pull && !state.discard)
          return this.#receiveProducer(senderId, request.id, payload, true)
        return Promise.resolve()
      })
      if (!runtime && request.data.route.timeoutMs !== undefined)
        state.timer = this.#kernel.time.setTimeout(() => {
          if (state.terminal) return
          if (state.lifetime) state.lifetime.pending += 1
          this.#finishProducer(state, new RpcTimeoutError())
          void Promise.resolve()
            .then(() => state.iterator.return?.())
            .catch((error) => this.#report(error))
            .finally(() => {
              if (state.lifetime) state.lifetime.pending -= 1
              this.#settleProducer(state)
            })
        }, request.data.route.timeoutMs)
    } catch (error) {
      nativeSettlement?.(false)
      scope.abort()
      await this.#sendFailure(
        senderId,
        request.id,
        0,
        error,
        request.data.route.forwardRoute,
        receiverId,
        runtime
      )
      return
    }
    try {
      if (runtime?.prepareStream) await runtime.prepareStream(context)
      try {
        await this.#sendFrame(
          senderId,
          request.id,
          { event: RpcStreamEvent.open, seq: 0 },
          undefined,
          receiverId,
          runtime
        )
      } catch (error) {
        /** Only a physical open-write failure makes delivery uncertain; C's terminal is exact. */
        throw this.#sendFailureReason(error)
      }
    } catch (error) {
      const failure = error
      this.#finishProducer(state, failure)
      try {
        await state.iterator.return?.()
      } catch (cleanupError) {
        this.#report(cleanupError)
      }
      await this.#sendFailure(
        senderId,
        request.id,
        0,
        failure,
        undefined,
        state.receiverId,
        state.runtime
      )
    } finally {
      if (state.lifetime) state.lifetime.pending -= 1
      this.#settleProducer(state)
    }
    if (state.lifetime) await state.lifetime.settled
  }

  /** Grant one producer credit and send exactly its result, never prefetching. */
  async #receiveProducer(
    senderId: string,
    id: string,
    payload: IRpcStreamPayload,
    runtimeControl = false
  ): Promise<void> {
    /** Keep cleanup ownership even after a terminal step removes the publicly indexed state. */
    const state = this.#producers.get(tupleKey(senderId, id))
    if (state?.runtime && !runtimeControl) return
    if (!state?.lifetime) return this.#receiveProducerStep(senderId, id, payload)
    state.lifetime.pending += 1
    try {
      await this.#receiveProducerStep(senderId, id, payload)
    } finally {
      state.lifetime.pending -= 1
      this.#settleProducer(state)
    }
  }

  /**
   * Executes one original producer step; final lifetime tracking never serializes independent
   * credits.
   */
  async #receiveProducerStep(
    senderId: string,
    id: string,
    payload: IRpcStreamPayload
  ): Promise<void> {
    const key = tupleKey(senderId, id)
    const state = this.#producers.get(key)
    if (!state) {
      if (payload.event === RpcStreamEvent.cancel && !this.#earlyCancelOverflow.has(senderId)) {
        if (!this.#earlyCancels.has(key)) {
          let peerCancels = 0
          for (const early of this.#earlyCancels.values())
            if (early.senderId === senderId) peerCancels += 1
          if (peerCancels >= RpcStreamLimit.maxOpenStreamsPerPeer) {
            this.#earlyCancelOverflow.add(senderId)
            return
          }
        }
        this.#earlyCancels.set(key, { senderId, seq: payload.seq })
      }
      return
    }
    if (state.terminal) return
    if (payload.event === RpcStreamEvent.cancel) {
      state.terminal = true
      state.scope.abort(
        payload.reason === undefined ? undefined : deserializeRpcError(payload.reason)
      )
      let cleanupError: unknown
      try {
        await state.iterator.return?.()
      } catch (error) {
        cleanupError = error
      }
      this.#producers.delete(tupleKey(senderId, id))
      await this.#sendFrame(
        senderId,
        id,
        {
          event: RpcStreamEvent.cancelled,
          seq: payload.seq,
          ...(cleanupError === undefined
            ? {}
            : {
                error: serializeRpcError(cleanupError, {
                  report: (failure) => this.#report(failure.error)
                })
              })
        },
        undefined,
        state.receiverId,
        state.runtime
      )
      return
    }
    if (payload.seq !== state.seq || state.busy) {
      const error = invalidRpcStream(RpcStreamViolation.seq, '/seq')
      this.#report(error)
      this.#finishProducer(state, error)
      try {
        await state.iterator.return?.()
      } catch (cleanupError) {
        this.#report(cleanupError)
      }
      await this.#sendFailure(
        senderId,
        id,
        state.seq,
        error,
        undefined,
        state.receiverId,
        state.runtime
      )
      return
    }
    while (!state.terminal) {
      state.busy = true
      let result: IteratorResult<IRpcPortableValue>
      try {
        result = await state.iterator.next()
      } catch (error) {
        this.#finishProducer(state, error)
        let failure = error
        try {
          await state.iterator.return?.()
        } catch (cleanupError) {
          /** A runtime relay can observe the same terminal twice; preserve its original code/cause. */
          if (!state.runtime || cleanupError !== error)
            failure = new AggregateError([error, cleanupError], RpcStreamErrorText.cleanupFailed)
        }
        await this.#sendFailure(
          senderId,
          id,
          state.seq,
          failure,
          state.route,
          state.receiverId,
          state.runtime
        )
        state.busy = false
        return
      }
      if (state.terminal) return
      const outboundPayload: IRpcStreamPayload = {
        event: result.done ? RpcStreamEvent.end : RpcStreamEvent.item,
        seq: state.seq,
        ...(result.done
          ? result.value === undefined
            ? {}
            : { value: result.value }
          : { value: result.value })
      }
      try {
        if (state.runtime) normalizeStreamPayload(outboundPayload, normalizeRuntimePortable)
        else normalizeStreamPayload(outboundPayload)
      } catch (error) {
        const failure = new RpcError(
          RpcCoreErrorCode.payloadInvalid,
          RpcStreamErrorText.valueInvalid,
          error
        )
        this.#report(failure)
        this.#finishProducer(state, failure)
        try {
          await state.iterator.return?.()
        } catch (cleanupError) {
          this.#report(cleanupError)
        }
        await this.#sendFailure(
          senderId,
          id,
          state.seq,
          failure,
          undefined,
          state.receiverId,
          state.runtime
        )
        state.busy = false
        return
      }
      /** A finish keeps this same outstanding next credit and discards validated yields in place. */
      if (state.discard && !result.done) {
        state.seq += 1
        continue
      }
      if (result.done) {
        if (state.nativeSettlement) state.nativeSucceeded = true
        this.#finishProducer(state)
        try {
          await this.#sendFrame(
            senderId,
            id,
            outboundPayload,
            undefined,
            state.receiverId,
            state.runtime
          )
        } catch (error) {
          this.#report(error)
        }
        state.busy = false
        return
      }
      const admission = new AbortController()
      state.itemAdmission = admission
      const seq = state.seq
      /**
       * Legacy transports without a gate commit after completion; batch writers commit at
       * invocation.
       */
      let started = false
      /** Commits this credit once without awaiting physical completion before peer reentry. */
      const commit = () => {
        started = true
        state.seq = seq + 1
        state.busy = false
      }
      try {
        await this.#yieldDataTurn(state)
        await this.#sendFrame(
          senderId,
          id,
          outboundPayload,
          {
            queueSignal: admission.signal,
            assertCanSend: () => {
              this.#kernel.assertActive()
              if (state.terminal || state.seq !== seq) throw new RpcAbortError()
            },
            onStarted: commit
          },
          state.receiverId,
          state.runtime
        )
        if (!started) commit()
      } catch (error) {
        if (state.terminal) return
        const failure = this.#sendFailureReason(error)
        this.#finishProducer(state, failure)
        try {
          await state.iterator.return?.()
        } catch (cleanupError) {
          this.#report(cleanupError)
        }
        await this.#sendFailure(
          senderId,
          id,
          seq,
          failure,
          undefined,
          state.receiverId,
          state.runtime
        )
      }
      admission.abort()
      /** Earlier physical completion must not clear a subsequent credit's active admission. */
      if (state.itemAdmission === admission) {
        state.itemAdmission = undefined
      }
      /** A later pull may already own next; only this unchanged idle credit can drive discard. */
      if (!state.discard || state.busy || state.seq !== seq + 1) return
    }
  }

  /** Release one producer state before any terminal notification can reenter it. */
  #finishProducer(state: IProducerState, reason?: unknown): void {
    state.terminal = true
    this.#producers.delete(tupleKey(state.senderId, state.id))
    if (state.timer) this.#kernel.time.clearTimeout(state.timer)
    state.itemAdmission?.abort()
    state.scope.abort(reason)
    this.#settleProducer(state)
  }

  /** Resolves the admitted stream lifetime only when terminal cleanup and sends have all settled. */
  #settleProducer(state: IProducerState): void {
    if (state.terminal && (!state.lifetime || state.lifetime.pending === 0)) {
      /** Clear before callback execution so reentrant cleanup cannot release the owner twice. */
      const release = state.nativeSettlement
      state.nativeSettlement = undefined
      release?.(state.nativeSucceeded === true)
      state.lifetime?.resolve()
    }
  }

  /** Yield the endpoint scheduler once without leaving a pull suspended on disposal. */
  #yieldDataTurn(state: IProducerState): Promise<void> {
    return new Promise((resolve) => {
      const timer = this.#kernel.time.setTimeout(() => {
        state.scope.signal.removeEventListener('abort', onAbort)
        resolve()
      }, 0)
      const onAbort = (): void => {
        this.#kernel.time.clearTimeout(timer)
        resolve()
      }
      if (state.scope.signal.aborted) onAbort()
      else state.scope.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Send a serialized failure while keeping the producer's original error graph reachable. */
  async #sendFailure(
    targetId: string,
    id: string,
    seq: number,
    error: unknown,
    route?: readonly string[],
    receiverId?: string,
    runtime?: IProviderRuntimeStream
  ): Promise<void> {
    const wire = serializeRpcError(retainProviderFailureRoute(error, route), {
      report: (failure) => this.#report(failure.error)
    })
    try {
      await this.#sendFrame(
        targetId,
        id,
        { event: RpcStreamEvent.fail, seq, error: wire },
        undefined,
        receiverId,
        runtime
      )
    } catch (sendError) {
      this.#report(sendError)
    }
  }

  /** Forward an admitted stream failure through the existing endpoint diagnostic channel. */
  #report(error: unknown): void {
    this.#outbound.send({
      kind: 'report',
      error,
      code: (error as { readonly code?: string })?.code ?? RpcCoreErrorCode.protocolInvalid
    })
  }

  /** A connection failure terminates all live streams without replaying delivered items. */
  #transportFailed(cause: unknown): void {
    const error =
      cause instanceof RpcAbortError
        ? cause
        : new RpcError(
            RpcCoreErrorCode.streamResultUnknown,
            RpcStreamErrorText.resultUnknown,
            cause
          )
    for (const state of this.#consumers.values()) this.#finishConsumer(state, { error })
    for (const key of this.#pendingCancels.keys()) this.#resolveCancel(key, error)
    for (const state of this.#producers.values()) {
      if (state.lifetime) {
        state.lifetime.pending += 1
        this.#finishProducer(state, error)
        void Promise.resolve()
          .then(() => state.iterator.return?.())
          .catch((failure) => this.#report(failure))
          .finally(() => {
            state.lifetime!.pending -= 1
            this.#settleProducer(state)
          })
      } else {
        state.terminal = true
        state.scope.abort(error)
        void Promise.resolve(state.iterator.return?.()).catch((failure) => this.#report(failure))
      }
    }
    this.#producers.clear()
    this.#earlyCancels.clear()
    this.#earlyCancelOverflow.clear()
  }
}

/** This is the stream runtime's sole direct signal-reason read for later guarded replacement. */
function readStreamAbortReason(signal: IAbortSignal): unknown {
  return resolveAbortReason(signal)
}
