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
import { RpcCoreErrorCode, RpcError, RpcAbortError, RpcTimeoutError } from '../../errors.js'
import { RpcStreamErrorText } from './error-text.js'
import type { IEndpointKernelHost } from '../../endpoint-kernel.js'
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
import type { IAbortSignal } from '../async-control.js'
import type { IEndpointTimer } from '../time-port.js'
import { RpcStreamLimit } from '../../../contract/stream-constants.js'

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
    handler: (message: unknown) => void | Promise<void>
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
      handler: (message: unknown) => void | Promise<void>
    ) => () => void,
    capability?: IRpcStreamCapabilityPort
  ) {
    this.#kernel = kernel
    this.#prepared = prepared
    this.#outbound = outbound
    this.#registerStream = registerStream
    this.#capability = capability
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
    options?: Readonly<{ signal?: IAbortSignal; timeoutMs?: number }>
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
            state = this.#start(targetId, method, params, options)
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
    this.#releaseTransportFailure?.()
    for (const release of this.#registrations) release()
    this.#registrations.clear()
    for (const state of this.#consumers.values())
      this.#finishConsumer(state, { error: new RpcAbortError() })
    for (const state of this.#producers.values()) {
      this.#finishProducer(state, new RpcAbortError())
      try {
        await state.iterator.return?.()
      } catch (error) {
        this.#report(error)
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
    options?: Readonly<{ signal?: IAbortSignal; timeoutMs?: number }>
  ): IConsumerState {
    if (this.#capability && !this.#capability.supports(targetId))
      throw new RpcError(RpcCoreErrorCode.capabilityConflict, RpcStreamErrorText.capabilityMissing)
    if (options?.signal?.aborted) throw readStreamAbortReason(options.signal)
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
    state.openSend = Promise.resolve().then(() =>
      this.#outbound.send({
        kind: 'stream-open',
        id,
        targetId,
        method,
        data: params,
        timeoutMs: options?.timeoutMs,
        operation: { signal: scope.signal, remaining: () => scope.remaining(options?.timeoutMs) }
      })
    )
    void state.openSend.catch((error) => {
      if (!state.terminal) this.#finishConsumer(state, { error: this.#sendFailureReason(error) })
    })
    if (options?.timeoutMs !== undefined) {
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
    if (state.terminal) return this.#terminalResult(state.terminal)
    await state.ready
    if (state.terminal) return this.#terminalResult(state.terminal)
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
        }
      ).catch((error) => {
        if (state.terminal) return
        void this.#cancelConsumer(state, { error: this.#sendFailureReason(error) }, error)
      })
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
        void this.#sendFrame(state.targetId, state.id, payload).catch((error) => {
          this.#report(error)
          this.#resolveCancel(key, error)
        })
      },
      () => this.#resolveCancel(key)
    )
    return acknowledgement
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
    admission?: IRpcFrameAdmission
  ): Promise<void> {
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
          .then(() => this.#sendFailure(senderId, envelope.id, producer.seq, error))
      }
      return
    }
    if (payload.event === RpcStreamEvent.pull || payload.event === RpcStreamEvent.cancel)
      await this.#receiveProducer(senderId, envelope.id, payload)
    else this.#receiveConsumer(senderId, envelope.id, payload)
  }

  /** Drive the consumer's one pending credit or terminal notification. */
  #receiveConsumer(senderId: string, id: string, payload: IRpcStreamPayload): void {
    const key = tupleKey(senderId, id)
    const state = this.#consumers.get(key)
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
  async #acceptRequest(message: unknown, run: IRpcStreamRun): Promise<void> {
    const request = (message as { envelope?: IRpcEnvelope }).envelope
    if (request?.kind !== 'request') return
    const senderId = request.data.route.senderId
    if (this.#capability && !this.#capability.supports(senderId)) {
      this.#report(
        new RpcError(RpcCoreErrorCode.protocolInvalid, RpcStreamErrorText.capabilityMissing)
      )
      return
    }
    const key = tupleKey(senderId, request.id)
    const early = this.#earlyCancels.get(key)
    if (early) {
      this.#earlyCancels.delete(key)
      await this.#sendFrame(senderId, request.id, {
        event: RpcStreamEvent.cancelled,
        seq: early.seq
      })
      return
    }
    if (this.#earlyCancelOverflow.has(senderId)) {
      await this.#sendFailure(
        senderId,
        request.id,
        0,
        new RpcError(RpcCoreErrorCode.overloaded, RpcStreamErrorText.peerOverloaded)
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
        new RpcError(RpcCoreErrorCode.overloaded, RpcStreamErrorText.peerOverloaded)
      )
      return
    }
    const scope = new OperationScope(
      this.#kernel.generation,
      request.data.route.timeoutMs,
      this.#kernel.closingSignal,
      () => this.#kernel.time.now()
    )
    let state: IProducerState
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
        throw new RpcError(RpcCoreErrorCode.payloadInvalid, RpcStreamErrorText.iterableInvalid)
      const iterator =
        typeof source[Symbol.asyncIterator] === 'function'
          ? source[Symbol.asyncIterator]!()
          : source[Symbol.iterator]!()
      state = {
        id: request.id,
        senderId,
        iterator,
        scope,
        seq: 0,
        busy: false,
        terminal: false
      }
      this.#producers.set(key, state)
      if (request.data.route.timeoutMs !== undefined)
        state.timer = this.#kernel.time.setTimeout(() => {
          if (state.terminal) return
          this.#finishProducer(state, new RpcTimeoutError())
          void Promise.resolve()
            .then(() => state.iterator.return?.())
            .catch((error) => this.#report(error))
        }, request.data.route.timeoutMs)
    } catch (error) {
      scope.abort()
      await this.#sendFailure(senderId, request.id, 0, error)
      return
    }
    try {
      await this.#sendFrame(senderId, request.id, { event: RpcStreamEvent.open, seq: 0 })
    } catch (error) {
      const failure = this.#sendFailureReason(error)
      this.#finishProducer(state, failure)
      try {
        await state.iterator.return?.()
      } catch (cleanupError) {
        this.#report(cleanupError)
      }
      await this.#sendFailure(senderId, request.id, 0, failure)
    }
  }

  /** Grant one producer credit and send exactly its result, never prefetching. */
  async #receiveProducer(senderId: string, id: string, payload: IRpcStreamPayload): Promise<void> {
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
      await this.#sendFrame(senderId, id, {
        event: RpcStreamEvent.cancelled,
        seq: payload.seq,
        ...(cleanupError === undefined
          ? {}
          : {
              error: serializeRpcError(cleanupError, {
                report: (failure) => this.#report(failure.error)
              })
            })
      })
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
      await this.#sendFailure(senderId, id, state.seq, error)
      return
    }
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
        failure = new AggregateError([error, cleanupError], RpcStreamErrorText.cleanupFailed)
      }
      await this.#sendFailure(senderId, id, state.seq, failure)
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
      normalizeStreamPayload(outboundPayload)
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
      await this.#sendFailure(senderId, id, state.seq, failure)
      state.busy = false
      return
    }
    if (result.done) {
      this.#finishProducer(state)
      try {
        await this.#sendFrame(senderId, id, outboundPayload)
      } catch (error) {
        this.#report(error)
      }
      state.busy = false
      return
    }
    const admission = new AbortController()
    state.itemAdmission = admission
    const seq = state.seq
    try {
      await this.#yieldDataTurn(state)
      await this.#sendFrame(senderId, id, outboundPayload, {
        queueSignal: admission.signal,
        assertCanSend: () => {
          this.#kernel.assertActive()
          if (state.terminal || state.seq !== seq) throw new RpcAbortError()
        }
      })
      state.seq += 1
    } catch (error) {
      if (state.terminal) return
      const failure = this.#sendFailureReason(error)
      this.#finishProducer(state, failure)
      try {
        await state.iterator.return?.()
      } catch (cleanupError) {
        this.#report(cleanupError)
      }
      await this.#sendFailure(senderId, id, state.seq, failure)
    }
    admission.abort()
    state.itemAdmission = undefined
    state.busy = false
  }

  /** Release one producer state before any terminal notification can reenter it. */
  #finishProducer(state: IProducerState, reason?: unknown): void {
    state.terminal = true
    this.#producers.delete(tupleKey(state.senderId, state.id))
    if (state.timer) this.#kernel.time.clearTimeout(state.timer)
    state.itemAdmission?.abort()
    state.scope.abort(reason)
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
      state.terminal = true
      state.scope.abort(error)
      void Promise.resolve(state.iterator.return?.()).catch((failure) => this.#report(failure))
    }
    this.#producers.clear()
    this.#earlyCancels.clear()
    this.#earlyCancelOverflow.clear()
  }
}

/** This is the stream runtime's sole direct signal-reason read for later guarded replacement. */
function readStreamAbortReason(signal: IAbortSignal): unknown {
  return signal.reason
}
