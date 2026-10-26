/**
 * Owns one pending call's first terminal result, abort listeners and physical-handoff receipt.
 * CallTable supplies indexing and IO; this record retains compact source/task facts rather than a
 * Session, business payload or transport facade.
 */
import {
  RpcProbeStage,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  rpcProbeEnvelopeFacts,
  rpcProbeEnvelopeKind,
  type IRpcTargetSource,
  type IRpcProbeObservation
} from '@migaia/rpc-contract/interfaces'
/** One call owns settlement and cancellation metadata, never its payload, envelope or Session. */
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import {
  RpcCallMode,
  RpcWireKind,
  type IRpcEnvelope,
  type IRpcRoute,
  type IRpcTask
} from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcAbortError, createRpcError } from '../host/error-owner.js'
import { resolveAbortReason } from '../host/abort-reason.js'
import { sameTask } from './envelope.js'
import type { ICallWriteOptions } from './types.js'

/** Record collaborators perform actual IO and index removal without exposing another owner. */
export type ICallRecordOwner = Readonly<{
  send(record: CallRecord, frame: IRpcEnvelope, options: ICallWriteOptions): void | Promise<void>
  cancel(record: CallRecord, reason: unknown): void
  remove(record: CallRecord): void
  now(): number
  observe(record: CallRecord, data: IRpcProbeObservation): void
  report(error: unknown): void
}>

/** Setup may synchronously fire before addEventListener returns its successful registration. */
type IAbortRegistration = {
  readonly signal: IAbortSignal
  readonly listener: () => void
  registered: boolean
  removeAfterRegistration: boolean
}

/** One first-terminal guard merges RuntimeOperation with stronger request cleanup semantics. */
export class CallRecord {
  /** The entry-time closing admission is compact metadata retained across writes and cancellation. */
  readonly keepalive: boolean
  /** The globally unique carrier key isolates this source's calls from other namespaces. */
  readonly carrierId: string
  /** Namespace is compact admitted routing metadata, never a retained Session. */
  readonly namespace: string
  /** Actual selected native IO survives only as long as this pending or cancellation route. */
  readonly source: IRpcTargetSource | undefined
  /** Original attempt creation time measures its actual settlement without a new timer. */
  readonly #startedAt: number
  /** The admitted command fixes one numeric logical kind for this attempt. */
  readonly #kind: number
  /** Correlation spans write, original result and any downstream cancellation. */
  readonly id: string
  /** Small identity facts fence source, generation and method without retaining a Session. */
  readonly task: IRpcTask
  /** A bounded metadata route is enough for post-notify cancellation. */
  readonly route: IRpcRoute
  /** The parent owns IO, removal and reporting, never a second provider/Session abstraction. */
  readonly #owner: ICallRecordOwner
  /** Before-start cancellation awaits an original terminal only on reply-bearing calls. */
  readonly #beforeStart: boolean
  /** Forwarded notifications already have a real terminal; their internal caller owns that lifetime. */
  readonly #terminalNotify: boolean
  /** Only before-start, ordered or forwarded notify may retain caller cancellation after sending. */
  readonly #callerSignal: IAbortSignal | undefined
  /** Every successfully acquired listener has exactly one removal receipt. */
  readonly #registrations = new Map<IAbortSignal, IAbortRegistration>()
  /** This deferred disappears at public settlement; compact notifications own no reply waiter. */
  #completion: ReturnType<typeof deferred<unknown>> | undefined = deferred<unknown>()
  /** Only the actual carrier invocation authorizes downstream cancel. */
  #written = false
  /** Public write completion and cancellation-route retirement have separate lifetimes. */
  #publicDone = false
  /** Terminal metadata cannot be revived by late replies or reentrant listener setup. */
  #terminal = false
  /** A refusal/terminal may precede physical write resolution without becoming a receipt. */
  #remoteDone = false
  /** The first abort owns the reason, even if its getter reenters application code. */
  #abortHandled = false
  /** A queued writer throws the exact original terminal failure. */
  #failure: unknown

  /** Capture only identity; the preparation owner keeps business data until media handoff. */
  constructor(
    owner: ICallRecordOwner,
    carrierId: string,
    namespace: string,
    frame: IRpcEnvelope,
    beforeStart: boolean,
    callerSignal?: IAbortSignal,
    terminalNotify = false,
    source?: IRpcTargetSource,
    keepalive = false
  ) {
    this.#owner = owner
    this.source = source
    this.keepalive = keepalive
    this.carrierId = carrierId
    this.namespace = namespace
    this.#startedAt = owner.now()
    this.#kind = rpcProbeEnvelopeKind(frame)
    this.id = frame.id
    this.task = frame.task
    this.route = frame.route
    this.#beforeStart = beforeStart
    this.#callerSignal =
      frame.task.mode === RpcCallMode.notify &&
      (beforeStart ||
        terminalNotify ||
        (frame.kind === RpcWireKind.call && frame.options.orderKey !== undefined))
        ? callerSignal
        : undefined
    this.#terminalNotify = terminalNotify
  }

  /** Capture before start, since native send may synchronously deliver its matching reply. */
  get promise(): Promise<unknown> {
    return this.#completion!.promise
  }

  /** Only the original physical handoff can make a departed result unknown. */
  get written(): boolean {
    return this.#written
  }

  /** Authenticated source plus the complete selected tuple must agree before settlement. */
  matches(sourceKey: string, envelope: IRpcEnvelope): boolean {
    return (
      !this.#terminal &&
      sourceKey === this.carrierId &&
      envelope.route.senderId === this.route.targetId &&
      envelope.route.receiverId === this.route.senderId &&
      envelope.route.targetId === this.route.senderId &&
      sameTask(this.task, envelope.task)
    )
  }

  /** Register before send; asynchronous encoding/queueing stays cancellable until actual handoff. */
  start(
    frame: IRpcEnvelope,
    signal: IAbortSignal,
    transfer: readonly ArrayBuffer[] | undefined,
    onWritten: () => void,
    onWriteStart?: () => void,
    onFirstWriteStart?: () => void
  ): void {
    try {
      this.#observe(RpcProbeOutcome.created)
      if (this.#terminal) return
      this.#listen(signal)
      if (this.#callerSignal !== undefined && this.#callerSignal !== signal)
        this.#listen(this.#callerSignal)
      if (this.#terminal) return
      /** Session invokes this receiver-free guard directly before the actual carrier.write. */
      const handoff = (): void => {
        if (this.#terminal) throw this.#failure
        /**
         * Chunking reuses this guard; the existing written fact identifies the logical first
         * handoff.
         */
        const first = !this.#written
        this.#written = true
        onWriteStart?.()
        if (first) onFirstWriteStart?.()
      }
      /** Media owns this temporary frame until its physical write settles. */
      const writing = this.#owner.send(this, frame, {
        signal,
        transfer,
        ...(this.keepalive ? { keepalive: true } : {}),
        onWriteStart: handoff
      })
      Promise.resolve(writing).then(
        () => {
          this.#observe(RpcProbeOutcome.sent)
          onWritten()
          this.#writeComplete()
        },
        (error: unknown) => {
          onWritten()
          this.reject(error)
        }
      )
    } catch (error) {
      onWritten()
      this.reject(error)
    }
  }

  /** The actual correlated cancel write has fulfilled, independently from the call terminal. */
  cancelSent(): void {
    this.#observe(RpcProbeOutcome.sent, undefined, RpcProbeKind.cancel)
  }

  /** A matched real reply is observed before the original terminal settles its exact record. */
  received(envelope: IRpcEnvelope, error?: unknown): void {
    this.#owner.observe(this, {
      ...rpcProbeEnvelopeFacts(envelope),
      stage: RpcProbeStage.message,
      direction: RpcProbeDirection.inbound,
      kind: rpcProbeEnvelopeKind(envelope),
      outcome: RpcProbeOutcome.received,
      error
    })
  }

  /** Matching notification terminals retire metadata without adding a provider-completion waiter. */
  resolve(value: unknown): void {
    if (this.#terminal) return
    if (this.task.mode === RpcCallMode.notify) {
      if (this.#terminalNotify) {
        this.#settle(true, undefined)
        return
      }
      this.#remoteDone = true
      this.#removeSignals()
      if (this.#publicDone) this.#finish()
      return
    }
    this.#settle(true, value)
  }

  /** A remote notification refusal is reported, while public completion still follows media. */
  remoteError(error: unknown): void {
    if (this.task.mode !== RpcCallMode.notify || this.#terminalNotify) {
      this.reject(error)
      return
    }
    if (this.#terminal) return
    this.#owner.report(error)
    this.resolve(undefined)
  }

  /** The exact first local failure releases all acquired state before becoming observable. */
  reject(error: unknown): void {
    if (this.#terminal) return
    this.#failure = error
    this.#settle(false, error)
  }

  /** Ordinary notify finishes at physical completion; special modes keep their cancellation route. */
  #writeComplete(): void {
    if (this.#terminal || this.task.mode !== RpcCallMode.notify || this.#terminalNotify) return
    this.#publicDone = true
    /** Remove Promise callbacks before exposing completion to application continuations. */
    const completion = this.#completion
    this.#completion = undefined
    this.#removeSignals(this.#remoteDone ? undefined : this.#callerSignal)
    if (this.#remoteDone || this.#callerSignal === undefined) this.#finish()
    completion?.resolve(undefined)
  }

  /** Terminal is published before cleanup, so reentrancy cannot settle another result. */
  #settle(success: boolean, value: unknown): void {
    /** A post-write notification abort cannot change its already fulfilled Promise. */
    const completion = this.#completion
    this.#completion = undefined
    this.#publicDone = true
    this.#finish()
    if (!success || this.task.mode !== RpcCallMode.notify || this.#terminalNotify)
      this.#observe(
        success ? RpcProbeOutcome.settled : RpcProbeOutcome.failed,
        success ? undefined : value
      )
    if (success) completion?.resolve(value)
    else completion?.reject(value)
  }

  /** Listener cleanup failures report independently and never skip pending/index removal. */
  #finish(): void {
    if (this.#terminal) return
    this.#terminal = true
    this.#removeSignals()
    this.#owner.remove(this)
  }

  /** Registration bookkeeping survives synchronous abort during addEventListener. */
  #listen(signal: IAbortSignal): void {
    if (this.#registrations.has(signal) || this.#terminal) return
    /** This callback captures only its signal and owning record. */
    const registration: IAbortRegistration = {
      signal,
      listener: () => this.#abort(signal),
      registered: false,
      removeAfterRegistration: false
    }
    this.#registrations.set(signal, registration)
    try {
      signal.addEventListener('abort', registration.listener, { once: true })
    } catch (cause) {
      registration.registered = true
      this.#removeRegistration(registration)
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.abortSignalInvalid,
        cause
      )
    }
    registration.registered = true
    if (registration.removeAfterRegistration) this.#removeRegistration(registration)
    if (signal.aborted) this.#abort(signal)
  }

  /** Unwritten abort emits no frame; written abort preserves before-start acceptance semantics. */
  #abort(signal: IAbortSignal): void {
    if (this.#terminal || this.#abortHandled) return
    this.#abortHandled = true
    /** Keep the original reason or reason-getter failure reachable through cause. */
    const reason = resolveAbortReason(signal)
    /** The local coded error and remote cancellation share the one original reason read. */
    const error = createRpcAbortError(undefined, undefined, reason)
    if (this.#terminal) return
    this.#observe(RpcProbeOutcome.created, error, RpcProbeKind.cancel)
    if (this.#terminal) return
    if (this.#written && this.task.mode !== RpcCallMode.outcome) this.#owner.cancel(this, reason)
    if (
      !this.#written ||
      (!this.#beforeStart && !this.#terminalNotify) ||
      this.task.mode === RpcCallMode.outcome
    )
      this.reject(error)
    else {
      this.#removeSignals()
      if (this.#publicDone) this.#finish()
    }
  }

  /** Fixed original headers survive settlement; successful observations retain no payload. */
  #observe(outcome: number, error?: unknown, kind = this.#kind): void {
    this.#owner.observe(this, {
      ...rpcProbeEnvelopeFacts(this),
      stage: RpcProbeStage.message,
      direction: RpcProbeDirection.outbound,
      kind,
      outcome,
      error,
      durationMs:
        outcome === RpcProbeOutcome.settled || outcome === RpcProbeOutcome.failed
          ? Math.max(0, this.#owner.now() - this.#startedAt)
          : -1
    })
  }

  /** Reverse registration cleanup is bounded by the two local signals, never all pending calls. */
  #removeSignals(keep?: IAbortSignal): void {
    /** This tiny snapshot preserves reverse order during reentrant removals. */
    const registrations = Array.from(this.#registrations.values())
    for (let index = registrations.length - 1; index >= 0; index--) {
      /** A receipt knows whether registration has actually completed. */
      const registration = registrations[index]!
      if (registration.signal !== keep) this.#removeRegistration(registration)
    }
  }

  /** Synchronous setup abort defers removal until the original add operation succeeds. */
  #removeRegistration(registration: IAbortRegistration): void {
    if (!registration.registered) {
      registration.removeAfterRegistration = true
      return
    }
    this.#registrations.delete(registration.signal)
    registration.registered = false
    try {
      registration.signal.removeEventListener('abort', registration.listener)
    } catch (error) {
      this.#owner.report(error)
    }
  }
}
