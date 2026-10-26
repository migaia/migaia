/**
 * Owns one actual provider iterator's pull credit, terminal response and cleanup/write completion.
 * Contract payload checks and the supplied StreamChannel IO are reused without prefetch or another
 * queue; first terminal and original abort reasons govern the iterator's single lifetime.
 */
import {
  RpcProbeStage,
  RpcProbeDirection,
  RpcProbeOutcome,
  RpcProbeObservationKind,
  rpcProbeEnvelopeFacts,
  rpcProbeEnvelopeKind
} from '@migaia/rpc-contract/interfaces'
import { RpcWireCancel } from '@migaia/rpc-contract/protocol'
/** One original producer owns iterator/credit/backpressure and its actual terminal cleanup. */
import { deferred } from '@migaia/utils/promise'
import { RpcStreamEvent, RpcStreamLimit, measurePortableStreamValue } from '@migaia/rpc-contract'
import {
  RpcWireKind,
  RpcWireStreamFinish,
  RpcStreamViolation,
  RpcWirePointer,
  normalizeRpcPortable,
  checkRpcStreamProducerCredit,
  type IRpcEnvelope,
  type IRpcStreamEvent,
  type IRpcPortableValue,
  type IRpcCompletion
} from '@migaia/rpc-contract/protocol'
import {
  RpcCoreErrorCode,
  RpcContractErrorCode,
  type IRpcCoreErrorCode
} from '@migaia/rpc-contract/error-code'
import {
  safeRead,
  RPC_CONTRACT_SOURCE,
  RpcCoreErrorText,
  identifyRpcBoundaryFailure
} from '@migaia/rpc-contract/errors'
import { RpcStreamErrorText } from './error-text.js'
import { createRpcError, createRpcAbortError, localRpcErrorCode } from '../host/error-owner.js'
import { serializeHostWireError, deserializeHostWireError } from '../host/error-wire-metadata.js'
import { sameTask } from '../call/envelope.js'
import { resolveAbortReason } from '../host/abort-reason.js'
import type { IStreamOwner, IStreamProducerInput } from './types.js'

/** Iterator next/return and physical writes remain tracked until their original Promises settle. */
export class StreamProducer {
  /** The shared owner supplies physical IO and exact source removal. */
  readonly #owner: IStreamOwner
  /** Actual source/task/signal cannot be changed by a same-name replacement. */
  readonly #input: IStreamProducerInput
  /** The original iterator captures one source factory and preserves its receiver. */
  readonly #iterator: AsyncIterator<IRpcPortableValue> | Iterator<IRpcPortableValue>
  /** The producer's lifetime includes every outstanding next, return and write operation. */
  readonly #finished = deferred<void>()
  /** One current credit is captured independently from later reentrant pulls. */
  #seq = 0
  /** Busy blocks duplicate credit while the original next owns it. */
  #busy = false
  /** A reentrant later credit cannot have its busy flag cleared by an older write continuation. */
  #credit: object | undefined
  /** The first terminal fences late iterator results and repeated cleanup. */
  #terminal = false
  /** Work count prevents a cancelled pending next from releasing the original business lease early. */
  #pending = 0
  /** Finish-without-items reuses the same credit and discards validated yields in place. */
  #discard = false
  /** Completion selection stays fixed while cleanup and physical terminal write settle. */
  #completion: IRpcCompletion | undefined
  /** A single retained cancellation Promise makes repeated close idempotent. */
  #closing: Promise<void> | undefined
  /** An in-flight item write observes cancellation before physical carrier handoff. */
  #writeAbort: AbortController | undefined
  /** Only an installed original signal subscription is removed during terminal cleanup. */
  #listening = false

  /** Create the iterator once before announcing open, preserving supported sync and async sources. */
  constructor(owner: IStreamOwner, input: IStreamProducerInput) {
    this.#owner = owner
    this.#input = input
    /** The original iterable checks precede its one factory invocation. */
    const source = input.iterable as AsyncIterable<IRpcPortableValue> & Iterable<IRpcPortableValue>
    if (
      typeof source !== 'object' ||
      source === null ||
      (typeof source[Symbol.asyncIterator as keyof typeof source] !== 'function' &&
        typeof source[Symbol.iterator as keyof typeof source] !== 'function')
    )
      throw createRpcError(RpcCoreErrorCode.payloadInvalid, RpcStreamErrorText.iterableInvalid)
    this.#iterator =
      typeof source[Symbol.asyncIterator] === 'function'
        ? source[Symbol.asyncIterator]()
        : (source as Iterable<IRpcPortableValue>)[Symbol.iterator]()
  }

  /**
   * Publish open without pulling; the returned Promise represents the entire actual producer
   * lifetime.
   */
  start(): Promise<void> {
    this.#input.signal.addEventListener('abort', this.#abort, { once: true })
    this.#listening = true
    if (this.#input.signal.aborted) this.#abort()
    if (!this.#terminal) {
      this.#pending += 1
      /** The existing native handoff fact distinguishes uncertain delivery from local admission. */
      const open = { started: false }
      void this.#send({ event: RpcStreamEvent.open, seq: 0 }, undefined, () => {
        open.started = true
      })
        .catch((error) => {
          this.#owner.report(error)
          return this.#fail(
            open.started
              ? createRpcError(
                  RpcCoreErrorCode.streamResultUnknown,
                  RpcStreamErrorText.resultUnknown,
                  error
                )
              : error
          )
        })
        .finally(() => this.#release())
    }
    return this.#finished.promise
  }

  /** One admitted pull advances only its original sequence; finish cannot create a parallel credit. */
  /** Retire only this producer when an admitted correlated hook fails, leaving its carrier live. */
  reject(envelope: IRpcEnvelope, reason: unknown): boolean {
    if (!sameTask(this.#input.envelope.task, envelope.task)) return false
    void this.#fail(reason).catch(this.#owner.report)
    return true
  }

  async accept(envelope: IRpcEnvelope): Promise<void> {
    if (
      this.#terminal ||
      envelope.kind !== RpcWireKind.stream ||
      !sameTask(this.#input.envelope.task, envelope.task)
    )
      return
    /** The semantic validator has already admitted this closed stream event. */
    const event = envelope.stream
    if (event.event === RpcWireStreamFinish) {
      if (
        this.#input.envelope.kind !== RpcWireKind.call ||
        this.#input.envelope.options.cancel !== RpcWireCancel
      ) {
        await this.#fail(
          createRpcError(RpcCoreErrorCode.contractInvalid, RpcStreamErrorText.iterableInvalid)
        )
        return
      }
      if (this.#discard) return
      this.#discard = true
      await this.#owner.finish(
        this.#input.iterable,
        event.reason === undefined ? undefined : deserializeHostWireError(event.reason)
      )
      if (!this.#busy) await this.#drive()
      return
    }
    if (event.event !== RpcStreamEvent.pull) return
    /** Credit validation belongs to the canonical pure contract checker. */
    const error = checkRpcStreamProducerCredit(event, { seq: this.#seq, busy: this.#busy })
    if (error) {
      this.#owner.report(error)
      await this.#fail(error)
      return
    }
    await this.#drive()
  }

  /** Drive exactly one credit, or the same credit's finish discard loop, with no queue/prefetch. */
  async #drive(): Promise<void> {
    if (this.#terminal || this.#busy) return
    this.#busy = true
    /** This token fences cleanup from a later reentrant credit. */
    const token = {}
    this.#credit = token
    this.#pending += 1
    try {
      while (!this.#terminal) {
        /** Observe this exact original iterator result before selecting its wire terminal. */
        const result = await this.#iterator.next()
        if (this.#terminal) return
        /** Validation precedes discard and physical delivery so finish cannot hide a bad yield. */
        const event = this.#payload(result)
        if (result.done) {
          /** Codec admission must precede the original successful terminal commitment. */
          const completion: IRpcCompletion = {
            ok: true,
            ...(event.value === undefined ? {} : { result: event.value })
          }
          await this.#send(event, undefined, () => {
            if (!this.#terminal) this.#mark(completion)
          })
          if (!this.#terminal) this.#mark(completion)
          return
        }
        if (this.#discard) {
          this.#seq += 1
          continue
        }
        /** One credit owns one admission signal until its actual carrier handoff. */
        const admission = new AbortController()
        /** A reentrant pull must see this credit committed before the carrier delivers its item. */
        const credit = { owner: this, seq: this.#seq, started: false }
        this.#writeAbort = admission
        /** One actual outgoing object supplies both IO and its later observation. */
        const frame = this.#owner.frame(this.#input.envelope, event, true)
        try {
          await this.#owner.send(
            this.#input.source.carrierId,
            frame,
            {
              signal: admission.signal,
              onWriteStart: () => {
                if (credit.started) return
                credit.started = true
                if (!credit.owner.#terminal && credit.owner.#seq === credit.seq) {
                  credit.owner.#seq += 1
                  credit.owner.#busy = false
                }
              }
            },
            this.#input.targetSource
          )
        } catch (error) {
          throw this.#valueFailure(error)
        }
        this.#observe(frame, event.value)
        if (!credit.started && !this.#terminal && this.#seq === credit.seq) {
          this.#seq += 1
          this.#busy = false
        }
        if (this.#writeAbort === admission) this.#writeAbort = undefined
        if (!this.#discard || this.#busy) return
        this.#busy = true
      }
    } catch (error) {
      /** The synchronous report boundary observes the same classified native failure as the wire. */
      const failure = this.#boundary(error)
      this.#owner.report(failure)
      await this.#fail(failure)
    } finally {
      if (this.#credit === token) this.#busy = false
      this.#release()
    }
  }

  /** Normalize one original item/final value using the established portable and value budgets. */
  #payload(result: IteratorResult<IRpcPortableValue>): IRpcStreamEvent {
    /**
     * Undefined final values stay omitted; yielded undefined is outside the supported portable
     * domain.
     */
    let value: IRpcPortableValue | undefined
    try {
      value =
        result.done && result.value === undefined ? undefined : normalizeRpcPortable(result.value)
    } catch (cause) {
      throw createRpcError(RpcCoreErrorCode.payloadInvalid, RpcStreamErrorText.valueInvalid, cause)
    }
    if (
      this.#discard &&
      !result.done &&
      value !== undefined &&
      measurePortableStreamValue(value) > RpcStreamLimit.maxItemValueBytes
    )
      throw createRpcError(RpcCoreErrorCode.payloadInvalid, RpcStreamErrorText.valueInvalid)
    return {
      event: result.done ? RpcStreamEvent.end : RpcStreamEvent.item,
      seq: this.#seq,
      ...(value === undefined ? {} : { value })
    }
  }

  /** Preserve the sender's public payload family without disguising unrelated codec failures. */
  #valueFailure(error: unknown): unknown {
    return safeRead(error, 'source') === RPC_CONTRACT_SOURCE &&
      safeRead(error, 'code') === RpcContractErrorCode.invalidEnvelope &&
      safeRead(error, 'violation') === RpcStreamViolation.budget &&
      safeRead(error, 'pointer') === RpcWirePointer.stream
      ? createRpcError(RpcCoreErrorCode.payloadInvalid, RpcStreamErrorText.valueInvalid, error)
      : error
  }

  /** Terminal cleanup preserves the original primary if iterator.return also fails. */
  async #fail(primary: unknown): Promise<void> {
    if (this.#terminal) return
    /** Failure can start while no pull is active; its real return/write must retain this owner. */
    this.#pending += 1
    try {
      /** Only the retained canonical completion can select cancellation without aborting new work. */
      const streamTerminal =
        this.#input.completion?.ok === false ? this.#input.completion.streamTerminal : undefined
      this.#mark(this.#failure(primary, streamTerminal))
      /** Original failures stay first when cleanup produces a different secondary failure. */
      let failure = primary
      try {
        await this.#iterator.return?.()
      } catch (error) {
        if (error !== primary) {
          /** The existing boundary reports the original cleanup object before aggregation. */
          const cleanup = this.#boundary(error)
          this.#owner.report(cleanup)
          /** Only factory-minted Core codes come from this owner map; diagnostics stay mutable. */
          const code = localRpcErrorCode(primary) as IRpcCoreErrorCode | undefined
          failure = identifyRpcBoundaryFailure(
            new AggregateError([primary, cleanup], RpcStreamErrorText.cleanupFailed),
            code ?? RpcCoreErrorCode.internal,
            RpcStreamErrorText.cleanupFailed
          )
        }
      }
      this.#completion = this.#failure(failure, streamTerminal)
      try {
        await this.#send(
          {
            event: streamTerminal ?? RpcStreamEvent.fail,
            seq: this.#seq,
            error: this.#wire(failure)
          },
          failure
        )
      } catch (error) {
        this.#owner.report(error)
      }
    } finally {
      this.#release()
    }
  }

  /** Cancellation keeps outstanding next/return/write work under this same producer lifetime. */
  close(reason: unknown): Promise<void> {
    if (this.#closing) return this.#finished.promise
    if (this.#terminal) return this.#finished.promise
    this.#mark(this.#failure(reason, RpcStreamEvent.cancelled))
    this.#pending += 1
    this.#closing = this.#cancel(reason).finally(() => this.#release())
    return this.#finished.promise
  }

  /** Await actual return and terminal write; cleanup failures remain reachable on the wire. */
  async #cancel(reason: unknown): Promise<void> {
    /**
     * Successful cancellation keeps cancelled's error omitted, preserving ordinary return
     * semantics.
     */
    let cleanup: unknown
    try {
      await this.#iterator.return?.()
    } catch (error) {
      /** Iterator cleanup is an actual provider failure, classified before diagnostics escape. */
      const failure = this.#boundary(error)
      cleanup =
        reason === undefined || reason === error
          ? failure
          : new AggregateError([reason, failure], RpcStreamErrorText.cleanupFailed)
      this.#owner.report(failure)
    }
    if (cleanup !== undefined) this.#completion = this.#failure(cleanup, RpcStreamEvent.cancelled)
    try {
      await this.#send(
        {
          event: RpcStreamEvent.cancelled,
          seq: this.#seq,
          ...(cleanup === undefined ? {} : { error: this.#wire(cleanup) })
        },
        cleanup ?? reason
      )
    } catch (error) {
      this.#owner.report(error)
    }
  }

  /** Abort retains its original reason rather than replacing it with an unrelated cleanup error. */
  readonly #abort = (): void => {
    void this.close(
      createRpcAbortError(undefined, undefined, resolveAbortReason(this.#input.signal))
    )
  }
  /** Classify actual iterator failures once through the shared package boundary rule. */
  #boundary(error: unknown): Error {
    return identifyRpcBoundaryFailure(
      error,
      RpcCoreErrorCode.internal,
      RpcCoreErrorText.providerFailed
    )
  }
  /** Pure error projection reuses the Host's original privacy/route metadata owner. */
  #wire(error: unknown) {
    return serializeHostWireError(this.#boundary(error), {
      report: (failure) => this.#owner.report(failure.error)
    })
  }
  /** Failure completion is selected from one original primary graph. */
  #failure(
    error: unknown,
    streamTerminal?: typeof RpcStreamEvent.cancelled
  ): Extract<IRpcCompletion, { ok: false }> {
    return {
      ok: false,
      error: this.#wire(error),
      ...(streamTerminal === undefined ? {} : { streamTerminal })
    }
  }
  /** Reverse routing changes only immediate media identity; selected task/id remain original. */
  async #send(stream: IRpcStreamEvent, error?: unknown, onWriteStart?: () => void): Promise<void> {
    /** The same actual original envelope is observed only after its physical Promise completes. */
    const frame = this.#owner.frame(this.#input.envelope, stream, true)
    try {
      await this.#owner.send(
        this.#input.source.carrierId,
        frame,
        onWriteStart ? { onWriteStart } : undefined,
        this.#input.targetSource
      )
    } catch (error) {
      throw this.#valueFailure(error)
    }
    this.#observe(frame, stream.value, error)
  }

  /** Outgoing observations borrow original admitted values and local failure identity. */
  #observe(envelope: IRpcEnvelope, content?: unknown, error?: unknown): void {
    this.#owner.observe?.({
      kind: RpcProbeObservationKind.event,
      namespace: this.#input.source.namespace,
      carrierId: this.#input.source.carrierId,
      peerId: this.#input.source.session?.peerId,
      id: envelope.id,
      data: {
        ...rpcProbeEnvelopeFacts(envelope),
        stage: RpcProbeStage.message,
        direction: RpcProbeDirection.outbound,
        kind: rpcProbeEnvelopeKind(envelope),
        outcome: RpcProbeOutcome.sent,
        content,
        error
      }
    })
  }

  /** Remove table/signal/write ownership before any terminal frame can reenter the producer. */
  #mark(completion: IRpcCompletion): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#completion = completion
    this.#owner.removeProducer(this.#input.source.carrierId, this.#input.envelope.id, this)
    this.#writeAbort?.abort()
    this.#writeAbort = undefined
    if (this.#listening) {
      this.#listening = false
      try {
        this.#input.signal.removeEventListener('abort', this.#abort)
      } catch (error) {
        this.#owner.report(error)
      }
    }
  }

  /** Only the last real next/return/write release settles business completion and its lease. */
  #release(): void {
    this.#pending -= 1
    if (this.#terminal && this.#pending === 0) {
      this.#input.complete(this.#completion!)
      this.#finished.resolve()
    }
  }
}
