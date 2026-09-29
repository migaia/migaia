import {
  deserializeRpcError,
  invalidRpcStream,
  normalizeRpcEnvelope,
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
import { RpcCoreErrorCode, RpcError, RpcAbortError } from '../../errors.js'
import { RpcCoreErrorText } from '../../error-text.js'
import type { IEndpointKernelHost } from '../../endpoint-kernel.js'
import type {
  IRpcStreamCapabilityPort,
  IRpcStreamRun,
  IRpcStreamRuntime
} from '../../features/stream.js'
import type { IPreparedEndpoint } from '../endpoint-bootstrap.js'
import { allocateRpcId } from '../id.js'
import { OperationScope } from '../operation-scope.js'
import type { IRpcOutboundOperationsPort } from '../plugin-shared-keys.js'
import { tupleKey } from '../safe-value.js'
import type { IAbortSignal } from '../async-control.js'

/** One pending caller pull; the enclosing state owns settlement and its sequence. */
type IConsumerPull = {
  readonly resolve: (result: IteratorResult<IRpcPortableValue>) => void
  readonly reject: (reason: unknown) => void
}

/** Caller state is keyed by the selected target and the initial request id. */
type IConsumerState = {
  readonly id: string
  readonly targetId: string
  readonly method: string
  readonly scope: OperationScope
  readonly timeoutMs: number | undefined
  readonly ready: Promise<void>
  readonly resolveReady: () => void
  readonly rejectReady: (reason: unknown) => void
  seq: number
  pending?: IConsumerPull
  terminal?:
    | { readonly done: true; readonly value?: IRpcPortableValue }
    | { readonly error: unknown }
}

/** Producer state is keyed by admitted sender and id, never by method alone. */
type IProducerState = {
  readonly id: string
  readonly senderId: string
  readonly iterator: AsyncIterator<IRpcPortableValue> | Iterator<IRpcPortableValue>
  readonly scope: OperationScope
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
    handler: (message: unknown) => void | Promise<void>
  ) => () => void
  /** Connection capability decision supplied by the channel owner. */
  readonly #capability: IRpcStreamCapabilityPort | undefined
  /** Caller-owned streams, isolated by target and id. */
  readonly #consumers = new Map<string, IConsumerState>()
  /** Producer-owned streams, isolated by admitted sender and id. */
  readonly #producers = new Map<string, IProducerState>()
  /** Provider registrations released on feature disposal. */
  readonly #registrations = new Set<() => void>()
  /** Kernel route release is idempotent and belongs to this feature. */
  readonly #releaseRoute: () => void
  /** Prevents new streams during reverse feature disposal. */
  #closed = false

  /** Installs the stream route and reuses the provider and outbound feature ports. */
  constructor(
    kernel: IEndpointKernelHost,
    prepared: IPreparedEndpoint<string>,
    outbound: IRpcOutboundOperationsPort,
    registerStream: (
      method: string,
      handler: (message: unknown) => void | Promise<void>
    ) => () => void,
    capability?: IRpcStreamCapabilityPort
  ) {
    this.#kernel = kernel
    this.#prepared = prepared
    this.#outbound = outbound
    this.#registerStream = registerStream
    this.#capability = capability
    this.#releaseRoute = kernel.registerRoute(RpcEnvelopeKind.stream, (message) =>
      this.#receive(message)
    )
  }

  /** Lazily opens one remote stream; no request is sent before the first next. */
  open(
    targetId: string,
    method: string,
    params: unknown,
    options?: Readonly<{ signal?: IAbortSignal; timeoutMs?: number }>
  ): AsyncIterableIterator<IRpcPortableValue> {
    this.#kernel.assertActive()
    if (this.#closed) throw new RpcAbortError()
    let state: IConsumerState | undefined
    let tail = Promise.resolve<unknown>(undefined)
    const next = (): Promise<IteratorResult<IRpcPortableValue>> => {
      const task = tail.then(async () => {
        state ??= this.#start(targetId, method, params, options)
        return this.#next(state)
      })
      tail = task.then(
        () => undefined,
        () => undefined
      )
      return task
    }
    const close = async (
      reason?: unknown,
      thrown = false
    ): Promise<IteratorResult<IRpcPortableValue>> => {
      if (state) this.#finishConsumer(state, thrown ? { error: reason } : { done: true })
      if (thrown) throw reason
      return { done: true, value: undefined }
    }
    return Object.freeze({
      next,
      return: (value?: IRpcPortableValue) => close(value),
      throw: (reason?: unknown) => close(reason, true),
      [Symbol.asyncIterator]() {
        return this
      }
    })
  }

  /** Claim a provider method in the ordinary namespace and release it idempotently. */
  provide(method: string, run: IRpcStreamRun): () => void {
    if (this.#closed) throw new RpcAbortError()
    const release = this.#registerStream(method, (message) => this.#acceptRequest(message, run))
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
    for (const release of this.#registrations) release()
    this.#registrations.clear()
    for (const state of this.#consumers.values())
      this.#finishConsumer(state, { error: new RpcAbortError() })
    for (const state of this.#producers.values()) {
      state.terminal = true
      state.scope.abort()
      await state.iterator.return?.()
    }
    this.#producers.clear()
  }

  /** Allocate the sole operation scope and issue the initial request through outbound. */
  #start(
    targetId: string,
    method: string,
    params: unknown,
    options?: Readonly<{ signal?: IAbortSignal; timeoutMs?: number }>
  ): IConsumerState {
    if (this.#capability && !this.#capability.supports(targetId))
      throw new RpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcCoreErrorText.streamCapabilityMissing
      )
    if (options?.signal?.aborted) throw options.signal.reason
    const id = allocateRpcId(
      this.#prepared.options.uuid ?? {},
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
      timeoutMs: options?.timeoutMs,
      ready,
      resolveReady,
      rejectReady,
      seq: 0
    }
    this.#consumers.set(tupleKey(targetId, id), state)
    if (options?.signal) {
      const onAbort = (): void => this.#finishConsumer(state, { error: options.signal!.reason })
      options.signal.addEventListener('abort', onAbort, { once: true })
      void ready
        .finally(() => options.signal!.removeEventListener('abort', onAbort))
        .catch(() => undefined)
    }
    void this.#outbound
      .send({
        kind: 'stream-open',
        id,
        targetId,
        method,
        data: params,
        timeoutMs: options?.timeoutMs,
        operation: { signal: scope.signal, remaining: () => scope.remaining(options?.timeoutMs) }
      })
      .catch((error) => this.#finishConsumer(state, { error }))
    return state
  }

  /** Send exactly one pull for each awaited caller next and settle it from the matching frame. */
  async #next(state: IConsumerState): Promise<IteratorResult<IRpcPortableValue>> {
    if (state.terminal) return this.#terminalResult(state.terminal)
    await state.ready
    if (state.terminal) return this.#terminalResult(state.terminal)
    return new Promise<IteratorResult<IRpcPortableValue>>((resolve, reject) => {
      state.pending = { resolve, reject }
      void this.#sendFrame(state.targetId, state.id, {
        event: RpcStreamEvent.pull,
        seq: state.seq
      }).catch((error) => this.#finishConsumer(state, { error: this.#sendFailureReason(error) }))
    })
  }

  /** Return sticky terminal completion or throw the original terminal error instance. */
  #terminalResult(
    terminal: NonNullable<IConsumerState['terminal']>
  ): IteratorResult<IRpcPortableValue> {
    if ('error' in terminal) throw terminal.error
    return { done: true, value: undefined }
  }

  /** Only a top-level overload proves no physical frame was sent. */
  #sendFailureReason(error: unknown): unknown {
    if ((error as { readonly code?: unknown })?.code === RpcCoreErrorCode.overloaded) return error
    return new RpcError(
      RpcCoreErrorCode.streamResultUnknown,
      RpcCoreErrorText.streamResultUnknown,
      error
    )
  }

  /** Select one terminal result and release its scope without affecting other streams. */
  #finishConsumer(state: IConsumerState, terminal: NonNullable<IConsumerState['terminal']>): void {
    if (state.terminal) return
    state.terminal = terminal
    state.scope.abort()
    this.#consumers.delete(tupleKey(state.targetId, state.id))
    if ('error' in terminal) {
      state.rejectReady(terminal.error)
      state.pending?.reject(terminal.error)
    } else {
      state.resolveReady()
      state.pending?.resolve({ done: true, value: terminal.value })
    }
    state.pending = undefined
  }

  /** Build a protocol 1.1 frame using the canonical envelope and outbound owners. */
  #sendFrame(targetId: string, id: string, payload: IRpcStreamPayload): Promise<void> {
    const normalized = normalizeStreamPayload(payload)
    const message = normalizeRpcEnvelope({
      kind: 'stream',
      id,
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'stream',
          applicationVersion: this.#prepared.options.contract?.version ?? '1.0',
          senderId: this.#prepared.id,
          targetId,
          sentAt: this.#kernel.time.timestamp()
        },
        payload: normalized
      }
    })
    return this.#outbound.send({ kind: 'frame', message })
  }

  /** Validate one admitted stream event and dispatch it to the peer-isolated role state. */
  async #receive(message: unknown): Promise<void> {
    const record = message as { envelope?: IRpcEnvelope }
    const envelope = record.envelope
    if (envelope?.kind !== 'stream' || envelope.data.route.targetId !== this.#prepared.id) return
    const senderId = envelope.data.route.senderId
    if (this.#capability && !this.#capability.supports(senderId)) {
      this.#report(
        new RpcError(RpcCoreErrorCode.protocolInvalid, RpcCoreErrorText.streamCapabilityMissing)
      )
      return
    }
    let payload: IRpcStreamPayload
    try {
      payload = normalizeStreamPayload(envelope.data.payload)
    } catch (error) {
      this.#report(error)
      return
    }
    if (payload.event === RpcStreamEvent.pull || payload.event === RpcStreamEvent.cancel)
      await this.#receiveProducer(senderId, envelope.id, payload)
    else this.#receiveConsumer(senderId, envelope.id, payload)
  }

  /** Drive the consumer's one pending credit or terminal notification. */
  #receiveConsumer(senderId: string, id: string, payload: IRpcStreamPayload): void {
    const state = this.#consumers.get(tupleKey(senderId, id))
    if (!state) return
    if (payload.event === RpcStreamEvent.open) {
      if (payload.seq !== 0) {
        this.#invalid(state, '/seq')
        return
      }
      state.resolveReady()
      return
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
    this.#finishConsumer(state, { error })
  }

  /** Hand off one admitted ordinary request to the registered stream producer. */
  async #acceptRequest(message: unknown, run: IRpcStreamRun): Promise<void> {
    const request = (message as { envelope?: IRpcEnvelope }).envelope
    if (request?.kind !== 'request') return
    const senderId = request.data.route.senderId
    if (this.#capability && !this.#capability.supports(senderId)) {
      this.#report(
        new RpcError(RpcCoreErrorCode.protocolInvalid, RpcCoreErrorText.streamCapabilityMissing)
      )
      return
    }
    const key = tupleKey(senderId, request.id)
    if (this.#producers.has(key)) return
    const scope = new OperationScope(
      this.#kernel.generation,
      request.data.route.timeoutMs,
      this.#kernel.closingSignal,
      () => this.#kernel.time.now()
    )
    try {
      const iterable = run(request.data.payload, { signal: scope.signal }) as unknown
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
        throw new RpcError(RpcCoreErrorCode.payloadInvalid, RpcCoreErrorText.streamIterableInvalid)
      const iterator =
        typeof source[Symbol.asyncIterator] === 'function'
          ? source[Symbol.asyncIterator]!()
          : source[Symbol.iterator]!()
      this.#producers.set(key, {
        id: request.id,
        senderId,
        iterator,
        scope,
        seq: 0,
        busy: false,
        terminal: false
      })
      await this.#sendFrame(senderId, request.id, { event: RpcStreamEvent.open, seq: 0 })
    } catch (error) {
      scope.abort()
      await this.#sendFailure(senderId, request.id, 0, error)
    }
  }

  /** Grant one producer credit and send exactly its result, never prefetching. */
  async #receiveProducer(senderId: string, id: string, payload: IRpcStreamPayload): Promise<void> {
    const state = this.#producers.get(tupleKey(senderId, id))
    if (!state || state.terminal) return
    if (payload.event === RpcStreamEvent.cancel) {
      state.terminal = true
      state.scope.abort()
      try {
        await state.iterator.return?.()
      } catch (error) {
        this.#report(error)
      }
      this.#producers.delete(tupleKey(senderId, id))
      await this.#sendFrame(senderId, id, { event: RpcStreamEvent.cancelled, seq: payload.seq })
      return
    }
    if (payload.seq !== state.seq || state.busy) {
      this.#report(invalidRpcStream(RpcStreamViolation.seq, '/seq'))
      return
    }
    state.busy = true
    try {
      const result = await state.iterator.next()
      if (result.done) {
        state.terminal = true
        await this.#sendFrame(senderId, id, {
          event: RpcStreamEvent.end,
          seq: state.seq,
          ...(result.value === undefined ? {} : { value: result.value })
        })
        this.#producers.delete(tupleKey(senderId, id))
        state.scope.abort()
      } else {
        await this.#sendFrame(senderId, id, {
          event: RpcStreamEvent.item,
          seq: state.seq,
          value: result.value
        })
        state.seq += 1
      }
    } catch (error) {
      state.terminal = true
      this.#producers.delete(tupleKey(senderId, id))
      state.scope.abort()
      await this.#sendFailure(senderId, id, state.seq, error)
    } finally {
      state.busy = false
    }
  }

  /** Send a serialized failure while keeping the producer's original error graph reachable. */
  async #sendFailure(targetId: string, id: string, seq: number, error: unknown): Promise<void> {
    const wire = serializeRpcError(error, { report: (failure) => this.#report(failure.error) })
    try {
      await this.#sendFrame(targetId, id, { event: RpcStreamEvent.fail, seq, error: wire })
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
}
