/**
 * Owns one lazy remote stream's demand, source-qualified task, sticky terminal and actual
 * completion. Existing call features and generation cancellation bound the selected invocation;
 * StreamChannel supplies IO/index ownership while this consumer preserves iterator cleanup and
 * credit order.
 */
import {
  RpcProbeStage,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeObservationKind,
  rpcProbeEnvelopeFacts,
  rpcProbeEnvelopeKind
} from '@migaia/rpc-contract/interfaces'
import { RpcWireCancel } from '@migaia/rpc-contract/protocol'
/** Lazy, serialized single-credit consumer migrated from the existing StreamOwner iterator. */
import { createGenerationController } from '@migaia/lifecycle'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import { RpcStreamEvent } from '@migaia/rpc-contract'
import {
  RpcWireKind,
  RpcWireStreamFinish,
  checkRpcStreamInitialSequence,
  checkRpcStreamConsumerCredit,
  checkRpcStreamProgress,
  checkRpcStreamSequence,
  type IRpcEnvelope,
  type IRpcPortableValue
} from '@migaia/rpc-contract/protocol'
import { RpcStreamErrorText } from './error-text.js'
import { createRpcAbortError, createRpcTimeoutError } from '../host/error-owner.js'
import { serializeHostWireError, deserializeHostWireError } from '../host/error-wire-metadata.js'
import { sameTask } from '../call/envelope.js'
import { resolveAbortReason } from '../host/abort-reason.js'
import { callTarget } from '../call/target.js'
import type { ICallLocalOptions, ICallTargetRef, IPreparedCall } from '../call/types.js'
import type { IStreamOwner, IStreamTerminal, IStreamAdmissionFailure } from './types.js'

/** One lazy public iterator owns its input until first physical handoff, then only compact state. */
export class StreamConsumer {
  /** Explicit ports keep media and feature policy outside the consumer state machine. */
  readonly #owner: IStreamOwner
  /** The original selected binding never follows a same-name replacement mid-stream. */
  #target: ICallTargetRef
  /** Method is part of the compact task tuple, independent from retained business input. */
  readonly #method: string
  /** Lazy input is released as soon as the first physical call is handed off. */
  #payload: IRpcPortableValue | undefined
  /** Original options are read at first next; transfer/input are not retained after handoff. */
  #options: ICallLocalOptions | undefined
  /** Namespace directory refusal waits for this consumer's ordinary first-pull terminal path. */
  #admission: IStreamAdmissionFailure | undefined
  /** One inherited deadline is captured only at the actual lazy start. */
  #deadline: number | undefined
  /** First lazy start is the original duration origin, independent from inherited timeouts. */
  #createdAt = 0
  /** Complete feature instances may shorten the actual stream lifetime without a built-in policy. */
  #controller: ReturnType<typeof createGenerationController> | undefined
  /** The feature execution borrows this native parent signal and token once. */
  #request: ReturnType<ReturnType<typeof createGenerationController>['begin']> | undefined
  /** Initial matching open acknowledges readiness independently from the first item pull. */
  readonly #ready = deferred<void>()
  /** The same original business terminal settles features and all concurrent return calls. */
  readonly #finished = deferred<IteratorResult<IRpcPortableValue>>()
  /** Consumer credits grow monotonically; one pending request owns exactly this sequence. */
  #seq = 0
  /** Only one next can wait on an item because the public tail serializes caller demand. */
  #pending: ReturnType<typeof deferred<IteratorResult<IRpcPortableValue>>> | undefined
  /** Terminal sticks across later queued next operations. */
  #terminal: IStreamTerminal | undefined
  /** Original next serialization retains each exact task Promise. */
  #tail = Promise.resolve<unknown>(undefined)
  /** A start flag prevents multiple feature executions from concurrent queued next calls. */
  #started = false
  /** Opened before-start streams detach cancellation but retain explicit finish-without-items. */
  #opened = false
  /** Cancellation before physical stream-open handoff must not send a stray remote task. */
  #handedOff = false
  /** A return changes only this stream into its one retained finishing operation. */
  #finishing: Promise<IteratorResult<IRpcPortableValue>> | undefined
  /** Header/id is prepared exactly once by CallTable; payload disappears at physical handoff. */
  #prepared: IPreparedCall | undefined
  /** A single attempt signal subscription is removed at open/terminal as the original mode requires. */
  #signal: IAbortSignal | undefined
  /** The flag records actual listener ownership for precise cleanup. */
  #listening = false
  /** Before-start semantics are captured before lazy options are released. */
  #beforeStart = false
  /** Frozen own methods preserve the public iterator's existing shape and identity. */
  readonly value: AsyncIterableIterator<IRpcPortableValue>

  /** No frame, id, timer, listener or business invocation is allocated before first next. */
  constructor(
    owner: IStreamOwner,
    target: ICallTargetRef,
    method: string,
    payload?: IRpcPortableValue,
    options?: ICallLocalOptions,
    admission?: IStreamAdmissionFailure
  ) {
    this.#owner = owner
    this.#target = target
    this.#method = method
    this.#payload = payload
    this.#options = options
    this.#admission = admission
    this.value = Object.freeze({
      next: this.#next,
      return: (value?: IRpcPortableValue) => this.#return(value),
      throw: (reason?: unknown) => this.#return(reason, true),
      [Symbol.asyncIterator]() {
        return this
      }
    })
    /** Deferred rejection has its public next/return consumers; prevent orphaned early rejection. */
    void this.#ready.promise.catch(() => undefined)
    void this.#finished.promise.catch(() => undefined)
  }

  /** The existing relay seam starts this same consumer without granting an item pull. */
  ready(): Promise<void> {
    if (!this.#started && !this.#terminal) {
      try {
        this.#start()
      } catch (error) {
        this.#finish({ error })
      }
    }
    return this.#ready.promise
  }

  /** Internal relay finish preserves a supplied reason without inventing a thrown caller value. */
  finish(reason?: unknown): Promise<IteratorResult<IRpcPortableValue>> {
    return this.#finishIntent(reason)
  }

  /** Each queued next returns its own original Promise and cannot issue a parallel pull. */
  readonly #next = (): Promise<IteratorResult<IRpcPortableValue>> => {
    /** One continuation captures only its named consumer owner. */
    const task = this.#tail.then(() => this.#pull())
    this.#tail = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  /** Start the complete timeout instance once, then wait for the matching producer open. */
  async #pull(): Promise<IteratorResult<IRpcPortableValue>> {
    if (this.#terminal) return this.#result(this.#terminal)
    if (!this.#started) {
      try {
        this.#start()
      } catch (error) {
        this.#finish({ error })
      }
    }
    await this.#ready.promise
    if (this.#terminal) return this.#result(this.#terminal)
    if (this.#finishing) return this.#finishing
    this.#pending = deferred<IteratorResult<IRpcPortableValue>>()
    /** Capture one credit before send so a reentrant response can consume it immediately. */
    const pending = this.#pending
    try {
      await this.#send({ event: RpcStreamEvent.pull, seq: this.#seq })
    } catch (error) {
      this.close(error)
    }
    return pending.promise
  }

  /**
   * Cold start resolves the selected timeout only; stream retry remains the existing non-replay
   * path.
   */
  #start(): void {
    this.#owner.assertOpen()
    this.#started = true
    this.#createdAt = this.#now()
    this.#owner.trackConsumer(this.#target.carrierId, this)
    /** Options are read once at the actual first next, preserving lazy caller observation. */
    const options = this.#options ?? {}
    this.#beforeStart = options.cancel === RpcWireCancel
    if (this.#admission) throw this.#admission.error
    this.#deadline =
      options.remainingMs === undefined ? undefined : this.#now() + options.remainingMs
    this.#controller = createGenerationController({
      parentSignal: options.signal,
      report: this.#owner.report
    })
    this.#request = this.#controller.begin()
    if (this.#target.origin) {
      void this.#target.origin
        .run(
          (selection) => this.#selectedStart(callTarget(selection), options),
          this.#request.signal
        )
        .catch((error) => this.close(error))
    } else this.#selectedStart(this.#target, options)
  }

  /** Selection starts the original feature execution and holds its real terminal in the pool. */
  #selectedStart(
    target: ICallTargetRef,
    options: ICallLocalOptions
  ): Promise<IteratorResult<IRpcPortableValue>> {
    if (this.#terminal) return this.#finished.promise
    if (this.#target !== target) {
      this.#owner.removeConsumer(this.#target.carrierId, undefined, this)
      this.#target = target
      this.#owner.trackConsumer(target.carrierId, this)
    }
    if (target.source) target.source.track(target.carrierId, this.#finished.promise)
    else this.#owner.track?.(target.carrierId, this.#finished.promise)
    /** Inherited elapsed time includes native queueing; no hop restarts the chain budget. */
    const remainingMs =
      this.#deadline === undefined
        ? undefined
        : Math.max(0, Math.floor(this.#deadline - this.#now()))
    const operation = this.#owner.features.execute(
      target.namespace,
      { ...options, retry: false },
      { signal: this.#request!.signal, remainingMs, invoke: this.#invoke },
      target.callTimeoutCap
    )
    void operation.catch((error) => {
      if (this.#beforeStart && this.#opened) this.#owner.report(error)
      else this.close(error)
    })
    return this.#finished.promise
  }

  /** Intersect elapsed inherited time with the timeout feature's actual selected attempt budget. */
  readonly #invoke = (
    signal: IAbortSignal,
    remainingMs?: number
  ): Promise<IteratorResult<IRpcPortableValue>> => {
    /** These are fixed bounds, not a second feature policy. */
    const inherited =
      this.#deadline === undefined
        ? undefined
        : Math.max(0, Math.floor(this.#deadline - this.#now()))
    /** A timeout may shorten but never renew an upstream deadline. */
    const budget =
      inherited === undefined
        ? remainingMs
        : remainingMs === undefined
          ? inherited
          : Math.min(inherited, remainingMs)
    if (budget !== undefined && budget <= 0) return Promise.reject(createRpcTimeoutError())
    try {
      this.#prepared = this.#owner.prepare(
        this.#target,
        {
          mode: 'stream',
          method: this.#method,
          ...(this.#payload === undefined ? {} : { payload: this.#payload })
        },
        { ...this.#options, signal, remainingMs: budget }
      )
      this.#owner.registerConsumer(this.#target.carrierId, this.#prepared.envelope.id, this)
      this.#observe(this.#prepared.envelope, RpcProbeOutcome.created, RpcProbeDirection.outbound)
      this.#signal = signal
      signal.addEventListener('abort', this.#abort, { once: true })
      this.#listening = true
      if (signal.aborted) this.#abort()
      if (!this.#terminal) {
        /** Physical handoff releases business input even when open/terminal has not returned. */
        const write = { signal, transfer: this.#options?.transfer, onWriteStart: this.#handoff }
        void Promise.resolve(
          this.#owner.send(
            this.#target.carrierId,
            this.#prepared.envelope,
            write,
            this.#target.source
          )
        ).then(
          () => {
            if (this.#prepared)
              this.#observe(
                this.#prepared.envelope,
                RpcProbeOutcome.sent,
                RpcProbeDirection.outbound
              )
            if (!this.#terminal) this.#written()
          },
          (error) => this.close(error, true)
        )
      }
    } catch (error) {
      this.close(error)
    }
    return this.#finished.promise
  }

  /** Exact selected task/source admission precedes every sequence or credit transition. */
  /** A local hook failure settles only the exact admitted task and preserves its native error. */
  reject(envelope: IRpcEnvelope, reason: unknown): boolean {
    if (!this.#prepared || !sameTask(this.#prepared.envelope.task, envelope.task)) return false
    this.close(reason, true)
    return true
  }

  accept(envelope: IRpcEnvelope): void {
    if (!this.#prepared || !sameTask(this.#prepared.envelope.task, envelope.task) || this.#terminal)
      return
    if (envelope.kind === RpcWireKind.error) {
      this.#finish({ error: deserializeHostWireError(envelope.error) }, envelope)
      return
    }
    if (envelope.kind !== RpcWireKind.stream) return
    /** Validated wire event is borrowed once from the same admitted envelope. */
    const event = envelope.stream
    if (event.event === RpcStreamEvent.open) {
      /** Duplicate open cannot recreate state or grant another item credit. */
      const error = checkRpcStreamInitialSequence(event)
      if (error) {
        this.close(error)
        return
      }
      this.#observe(envelope, RpcProbeOutcome.received, RpcProbeDirection.inbound)
      this.#opened = true
      if (this.#beforeStart) this.#removeAbort()
      this.#ready.resolve()
      return
    }
    if (event.event === RpcStreamEvent.cancelled) {
      if (this.#finishing && !this.#beforeStart && event.error === undefined)
        this.#finish({ done: true }, envelope)
      else
        this.#finish(
          {
            error:
              event.error === undefined
                ? createRpcAbortError()
                : deserializeHostWireError(event.error)
          },
          envelope
        )
      return
    }
    if (
      (this.#finishing || !this.#pending) &&
      (event.event === RpcStreamEvent.end || event.event === RpcStreamEvent.fail)
    ) {
      /** Finishing may discard items but a terminal must never retreat behind held progress. */
      const error = checkRpcStreamProgress(event, { seq: this.#seq })
      if (error) {
        this.close(error)
        return
      }
    } else if (this.#finishing && event.event === RpcStreamEvent.item) {
      /** A finishing item consumes this original outstanding credit without becoming a new pull. */
      const error = checkRpcStreamSequence(event, { seq: this.#seq })
      if (error) this.close(error)
      else {
        this.#observe(envelope, RpcProbeOutcome.received, RpcProbeDirection.inbound, event.value)
        this.#seq += 1
      }
      return
    } else {
      /** A failure at seq zero is a legal refusal before initial item demand. */
      const error =
        event.event === RpcStreamEvent.fail && !this.#pending && event.seq === 0
          ? undefined
          : checkRpcStreamConsumerCredit(event, { seq: this.#seq, pending: this.#pending })
      if (error) {
        this.close(error)
        return
      }
    }
    if (event.event === RpcStreamEvent.item) {
      this.#observe(envelope, RpcProbeOutcome.received, RpcProbeDirection.inbound, event.value)
      this.#seq += 1
      this.#pending?.resolve({ done: false, value: event.value! })
      this.#pending = undefined
    } else if (event.event === RpcStreamEvent.end)
      this.#finish(
        { done: true, ...(event.value === undefined ? {} : { value: event.value }) },
        envelope
      )
    else if (event.event === RpcStreamEvent.fail)
      this.#finish({ error: deserializeHostWireError(event.error!) }, envelope)
  }

  /** Caller return and throw share one original finishing Promise; unopened return performs no IO. */
  async #return(value?: unknown, thrown = false): Promise<IteratorResult<IRpcPortableValue>> {
    if (!this.#started) {
      this.#terminal = { done: true }
      if (thrown) throw value
      return { done: true, value: value as IRpcPortableValue }
    }
    if (this.#terminal && !thrown && !this.#beforeStart)
      return { done: true, value: value as IRpcPortableValue }
    /** Preserve the exact retained finish Promise while TypeScript sees its definite ownership. */
    const finishing = this.#finishIntent(thrown ? value : undefined)
    try {
      /** A thrown primary remains first if producer cleanup also rejects. */
      const result = await finishing
      if (thrown) throw value
      return result
    } catch (error) {
      if (thrown && error !== value)
        throw new AggregateError([value, error], RpcStreamErrorText.cleanupFailed)
      throw error
    }
  }

  /** One retained finish sends the original before-start drain or ordinary cancellation intent. */
  #finishIntent(reason?: unknown): Promise<IteratorResult<IRpcPortableValue>> {
    if (!this.#finishing) {
      this.#finishing = this.#finished.promise
      if (this.#target.origin && !this.#prepared) {
        this.#finish(reason === undefined ? { done: true } : { error: reason })
        return this.#finishing
      }
      void this.#ready.promise
        .then(() =>
          this.#send(
            this.#beforeStart
              ? {
                  event: RpcWireStreamFinish,
                  seq: this.#seq,
                  ...(reason === undefined ? {} : { reason: this.#wire(reason) })
                }
              : undefined,
            reason
          )
        )
        .catch((error) => this.#finish({ error }))
    }
    return this.#finishing
  }

  /** Local timeout/abort sends intent but settles public waiters immediately as the old owner did. */
  close(reason: unknown, force = false): void {
    if (this.#terminal) return
    if (!force && this.#beforeStart && this.#handedOff) {
      if (!this.#opened)
        void this.#send(undefined, reason).catch((error) => this.#finish({ error }))
      this.#removeAbort()
      return
    }
    if (this.#prepared && this.#handedOff)
      void this.#send(undefined, reason).catch(this.#owner.report)
    this.#finish({ error: reason })
  }

  /** A local stream abort keeps the exact caller reason, including the timeout feature's error. */
  readonly #abort = (): void => {
    if (!(this.#beforeStart && this.#opened)) this.close(resolveAbortReason(this.#signal!))
  }
  /** Queued cancellation cannot hand a frame to the carrier after its original local terminal. */
  readonly #handoff = (): void => {
    if (this.#terminal)
      throw 'error' in this.#terminal ? this.#terminal.error : createRpcAbortError()
    this.#options?.onWriteStart?.()
    this.#written()
  }
  /** Drop payload/options immediately before a real carrier write. */
  readonly #written = (): void => {
    this.#handedOff = true
    this.#payload = undefined
    this.#options = undefined
    if (this.#prepared) {
      /** Only compact task/header facts survive physical handoff, never the original payload. */
      const { profile, id, route, task } = this.#prepared.envelope
      this.#prepared = {
        ...this.#prepared,
        envelope: { profile, id, route, task, kind: RpcWireKind.call, options: {} }
      }
    }
  }
  /** Borrow the host monotonic clock; diagnostics use wall time only at frame construction. */
  #now(): number {
    return this.#owner.now?.() ?? performance.now()
  }
  /** The existing bounded flat projection retains the exact original error chain. */
  #wire(value: unknown) {
    return serializeHostWireError(value, { report: (failure) => this.#owner.report(failure.error) })
  }

  /** Send either the held stream credit/finish or its correlated cancellation frame. */
  async #send(
    stream?: import('@migaia/rpc-contract/protocol').IRpcStreamEvent,
    reason?: unknown
  ): Promise<void> {
    if (!this.#prepared) return
    /** Cancellation is semantic call intent; stream pull/finish retains the same task and id. */
    const frame: IRpcEnvelope = stream
      ? this.#owner.frame(this.#prepared.envelope, stream, false)
      : {
          profile: this.#prepared.envelope.profile,
          id: this.#prepared.envelope.id,
          route: this.#prepared.envelope.route,
          task: this.#prepared.envelope.task,
          kind: RpcWireKind.cancel,
          reason: this.#wire(reason)
        }
    await this.#owner.send(this.#target.carrierId, frame, undefined, this.#target.source)
    this.#observe(frame, RpcProbeOutcome.sent, RpcProbeDirection.outbound, undefined, reason)
  }

  /** Remove every table/listener/input reference before publishing the sticky business terminal. */
  #finish(terminal: IStreamTerminal, received?: IRpcEnvelope): void {
    if (this.#terminal) return
    this.#terminal = terminal
    this.#admission = undefined
    if (this.#prepared)
      this.#observe(
        received ?? this.#prepared.envelope,
        'error' in terminal ? RpcProbeOutcome.failed : RpcProbeOutcome.settled,
        received ? RpcProbeDirection.inbound : RpcProbeDirection.local,
        'error' in terminal ? undefined : terminal.value,
        'error' in terminal ? terminal.error : undefined,
        RpcProbeKind.streamClose
      )
    this.#removeAbort()
    this.#owner.removeConsumer(this.#target.carrierId, this.#prepared?.envelope.id, this)
    try {
      if (this.#target.origin)
        this.#controller?.supersede('error' in terminal ? terminal.error : createRpcAbortError())
      else this.#controller?.complete(this.#request!.token)
    } catch (error) {
      this.#owner.report(error)
    }
    this.#payload = undefined
    this.#options = undefined
    if ('error' in terminal) {
      this.#ready.reject(terminal.error)
      this.#pending?.reject(terminal.error)
      this.#finished.reject(terminal.error)
    } else {
      this.#ready.resolve()
      this.#pending?.resolve({ done: true, value: terminal.value })
      this.#finished.resolve({ done: true, value: terminal.value })
    }
    this.#pending = undefined
  }

  /** Actual accepted items and original terminals share one pure header/kind projection. */
  #observe(
    envelope: IRpcEnvelope,
    outcome: number,
    direction: number,
    content?: unknown,
    error?: unknown,
    kind = rpcProbeEnvelopeKind(envelope)
  ): void {
    this.#owner.observe?.({
      kind: RpcProbeObservationKind.event,
      namespace: this.#target.namespace,
      carrierId: this.#target.carrierId,
      peerId: this.#target.peerId,
      id: envelope.id,
      data: {
        ...rpcProbeEnvelopeFacts(envelope),
        stage: RpcProbeStage.message,
        direction,
        kind,
        outcome,
        content,
        error,
        durationMs:
          outcome === RpcProbeOutcome.settled || outcome === RpcProbeOutcome.failed
            ? Math.max(0, this.#now() - this.#createdAt)
            : -1
      }
    })
  }

  /** Only an actually installed signal bridge is removed, preserving exactly-once cleanup. */
  #removeAbort(): void {
    if (!this.#listening) return
    this.#listening = false
    try {
      this.#signal!.removeEventListener('abort', this.#abort)
    } catch (error) {
      this.#owner.report(error)
    }
  }

  /** Sticky errors and final return values keep their original public identity. */
  #result(terminal: IStreamTerminal): IteratorResult<IRpcPortableValue> {
    if ('error' in terminal) throw terminal.error
    return { done: true, value: terminal.value }
  }
}
