/** Outbound call ids, source-fenced settlement and cancellation have one runtime owner. */
import {
  RpcWireKind,
  RpcWireProfile,
  RpcCallMode,
  RpcWireCancel,
  normalizeRpcCallOptions,
  normalizeRpcTrace,
  normalizeRpcSteps,
  type IRpcEnvelope
} from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode, RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcProbeObservationKind, type IRpcAttemptOptions } from '@migaia/rpc-contract/interfaces'
import {
  RpcCoreErrorText,
  RpcLifecycleError,
  identifyRpcBoundaryFailure
} from '@migaia/rpc-contract/errors'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  createRpcAbortError,
  createRpcError,
  createRpcLifecycleError,
  isLocalRpcError,
  createRpcPhysicalTransportError
} from '../host/error-owner.js'
import { callEnvelope } from './envelope.js'
import { callTarget } from './target.js'
import { RpcCallIdAllocator } from './id.js'
import { CallRecord, type ICallRecordOwner } from './record.js'
import { CallInvocation, type ICallInvocationOwner } from './invocation.js'
import { reportDiagnostic } from '../host/report.js'
import { createRemoteLayerError } from '../host/remote-error-owner.js'
import { resolveAbortReason } from '../host/abort-reason.js'
import {
  deserializeHostWireError,
  serializeHostWireError,
  hostErrorWireMetadata
} from '../host/error-wire-metadata.js'
import type {
  ICallCommand,
  ICallLocalOptions,
  ICallPreparationCommand,
  ICallTableOptions,
  ICallTargetRef,
  IPreparedCall
} from './types.js'
export type {
  ICallCommand,
  ICallLocalOptions,
  ICallPreparationCommand,
  ICallTableOptions,
  ICallTargetRef,
  ICallSelf,
  ICallWriteOptions,
  IPreparedCall
} from './types.js'

/** Reject invalid method input before directory selection or call preparation can use it. */
export function assertCallMethod(method: unknown): asserts method is string {
  if (typeof method !== 'string' || method.length === 0)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.methodInvalid)
}

/** A source-key index makes retiring k belonging calls O(k), independent of unrelated traffic. */
export class CallTable {
  /** Media/feature/clock ports are explicit collaborators and carry no business input. */
  readonly #options: ICallTableOptions
  /** One allocator is also exposed through prepare for stream/control correlation. */
  readonly allocator: RpcCallIdAllocator
  /** Entries are reply records or compact cancellation routes, never a second protocol stack. */
  readonly #records = new Map<string, CallRecord>()
  /** Each accepted physical source owns only its own records and cancellation subscriptions. */
  readonly #bySource = new Map<string, Set<CallRecord>>()
  /** Originating feature executions can exist between attempts while no reply is pending. */
  readonly #invocations = new Set<CallInvocation>()
  /** Stream preparation without a caller signal still receives the host's close cancellation. */
  readonly #closing = new AbortController()
  /** A separate flag preserves even a deliberate undefined terminal reason. */
  #closed = false
  /** Admission closes before pending native-origin work is allowed to drain. */
  #sealed = false
  /** Every pending/new call observes the exact one owned host close reason. */
  #closeReason: unknown
  /** Monotonic elapsed time drives remaining budgets; no host timer policy is installed here. */
  readonly #now: () => number
  /** Wall time stamps diagnostics only and never renews a link deadline. */
  readonly #timestamp: () => number
  /** Stable record callbacks capture only this named owner. */
  readonly #recordOwner: ICallRecordOwner
  /** Stable invocation callbacks avoid payload-bearing closure components. */
  readonly #invocationOwner: ICallInvocationOwner

  /** Acquire only id entropy; native installation owns rollback if construction fails. */
  constructor(options: ICallTableOptions) {
    this.#options = options
    this.#now = options.now ?? (() => systemScheduler.now())
    this.#timestamp = options.timestamp ?? (() => systemWallClock.timestamp())
    this.allocator = options.allocator ?? new RpcCallIdAllocator(this.#report)
    this.#recordOwner = {
      send: (record, frame, write) => this.#write(record, frame, write),
      cancel: (record, reason) => this.#cancel(record, reason),
      remove: (record) => this.#remove(record),
      now: this.#now,
      observe: (record, data) =>
        this.#options.observe?.({
          kind: RpcProbeObservationKind.event,
          namespace: record.namespace,
          carrierId: record.carrierId,
          id: record.id,
          data
        }),
      report: this.#report
    }
    this.#invocationOwner = {
      features: options.features,
      now: this.#now,
      attempt: (target, command, local, signal, remaining, written, attemptOptions) =>
        this.#attempt(target, command, local, signal, remaining, written, attemptOptions),
      remove: (invocation) => {
        this.#invocations.delete(invocation)
      },
      report: this.#report
    }
  }

  /** Invoke one selected target; Namespace alone owns public 0/1/many and dispatch projection. */
  invoke(
    target: ICallTargetRef,
    command: ICallCommand,
    options: ICallLocalOptions = {}
  ): Promise<unknown> {
    try {
      /** Only admission during this exact Session's closing interval may survive later awaits. */
      const closing = this.#options.canKeepalive?.(target.carrierId, target.source) === true
      /** Ordinary work is refused before arbitrary feature code can suspend the close callback. */
      const keepalive = options.keepalive === true && closing
      if (closing && !keepalive) throw createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
      this.#assertAdmission(keepalive)
      this.#assertTransfer(target, options)
      /** Step admission returns the canonical captured data instead of re-reading caller arrays. */
      const normalized = this.#validate(command, options)
      /** Capture user choices once; transit cannot activate an originating retry implementation. */
      const local = {
        ...options,
        keepalive,
        ...(options.origin === false ? { retry: false as const } : {})
      }
      /** Resolution is the sole cache/precedence owner, including complete call-only instances. */
      const selected = this.#options.features.resolve(target.namespace, local)
      if (!target.origin) return this.#invoke(target, normalized, local, selected)
      /** One native scheduling input retains original selection and time before any task/header. */
      const operation = { normalized, local, selected, startedAt: this.#now() }
      return target.origin.run((selection) => {
        this.#assertOpen()
        return this.#invoke(
          callTarget(selection),
          operation.normalized,
          {
            ...operation.local,
            ...(operation.local.remainingMs === undefined
              ? {}
              : {
                  remainingMs: Math.max(
                    0,
                    operation.local.remainingMs - (this.#now() - operation.startedAt)
                  )
                })
          },
          operation.selected
        )
      }, local.signal ?? this.#closing.signal)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Only an actual selected resource supplies generation and idempotency facts to features. */
  #invoke(
    target: ICallTargetRef,
    command: ICallCommand,
    options: ICallLocalOptions,
    selected: import('@migaia/rpc-contract/interfaces').IRpcCallFeatures
  ): Promise<unknown> {
    const invocation = new CallInvocation(
      this.#invocationOwner,
      target,
      command,
      options,
      selected,
      this.#options.attemptFacts?.(target, command, options)
    )
    this.#invocations.add(invocation)
    return invocation.start()
  }

  /** Transfer checks stay with the actual native resource source or ordinary SessionTable. */
  #assertTransfer(target: ICallTargetRef, options: object): void {
    if (target.source && !target.origin) target.source.assertTransfer(target.carrierId, options)
    else this.#options.assertTransfer(target.carrierId, options)
  }

  /** Prepare a stream/open header with the same allocator; acquire no pending or IO resources. */
  prepare(
    target: ICallTargetRef,
    command: ICallPreparationCommand,
    options: ICallLocalOptions = {}
  ): IPreparedCall {
    this.#assertOpen()
    this.#assertTransfer(target, options)
    /** Stream preparation freezes the same physical fact before the first encode can suspend. */
    const keepalive =
      options.keepalive === true &&
      this.#options.canKeepalive?.(target.carrierId, target.source) === true
    return this.#prepare(target, this.#validate(command, options), options, keepalive)
  }

  /** Already admitted invocations reuse preparation without walking their group steps again. */
  #prepare(
    target: ICallTargetRef,
    command: ICallPreparationCommand,
    options: ICallLocalOptions,
    keepalive = options.keepalive === true
  ): IPreparedCall {
    /** The stream owner retains its own actual signal/iterator and releases its own resources. */
    const signal = options.signal ?? this.#closing.signal
    if (signal.aborted) throw createRpcAbortError(undefined, undefined, resolveAbortReason(signal))
    return {
      target,
      envelope: callEnvelope(
        this.allocator.allocate(),
        target,
        this.#options.self(),
        command,
        options,
        this.#timestamp(),
        options.remainingMs
      ),
      signal,
      keepalive,
      ...(options.remainingMs === undefined ? {} : { remainingMs: options.remainingMs })
    }
  }

  /** Session already admitted shape/source; exact task and binding checks precede settlement. */
  accept(sourceKey: string, envelope: IRpcEnvelope): boolean {
    if (
      envelope.task.mode === RpcCallMode.stream ||
      (envelope.kind !== RpcWireKind.result &&
        envelope.kind !== RpcWireKind.error &&
        !(envelope.kind === RpcWireKind.outcome && envelope.operation === 'result'))
    )
      return false
    /** One id lookup never scans another source or namespace. */
    const record = this.#records.get(envelope.id)
    /** Late replies are consumed here without a completed-id cache or an uncorrelated report. */
    if (!record) return true
    if (!record.matches(sourceKey, envelope)) return false
    if (envelope.kind === RpcWireKind.result) {
      record.received(envelope)
      record.resolve(envelope.result)
    } else if (envelope.kind === RpcWireKind.error) {
      /** One restoration supplies both the actual observer reference and original call settlement. */
      const error = deserializeHostWireError(envelope.error)
      record.received(envelope, error)
      record.remoteError(error)
    } else if (envelope.kind === RpcWireKind.outcome && envelope.operation === 'result') {
      record.received(envelope)
      record.resolve({
        state: envelope.state,
        store: envelope.store,
        ...(envelope.state === 'done' ? { outcome: envelope.outcome } : {})
      })
    } else return false
    return true
  }

  /** An admitted source/task-local hook failure settles only its exact original pending call. */
  reject(sourceKey: string, envelope: IRpcEnvelope, error: unknown): boolean {
    /** Reuse the same full tuple fence as successful results, without adding another index. */
    const record = this.#records.get(envelope.id)
    if (!record?.matches(sourceKey, envelope)) return false
    record.reject(error)
    return true
  }

  /** Retire exactly this accepted binding; replacement never receives an older call's response. */
  retire(
    sourceKey: string,
    reason: unknown,
    physicalFailure = false,
    nativeGeneration?: number
  ): void {
    /** Removing the index first prevents reentrant source retirement from revisiting its records. */
    const records = this.#bySource.get(sourceKey)
    this.#bySource.delete(sourceKey)
    /** Generic physical loss shares one diagnostic; native loss retains each task's own details. */
    let failure: Error | undefined
    /** Explicit close keeps the default lifecycle identity; custom close reasons remain its cause. */
    const closing = isLocalRpcError(reason, RpcLifecycleError)
      ? reason
      : createRpcLifecycleError(RpcCoreErrorText.endpointDisposed, reason)
    if (records)
      for (const record of records)
        record.reject(
          physicalFailure && record.written
            ? nativeGeneration === undefined
              ? (failure ??= createRpcPhysicalTransportError(reason))
              : createRemoteLayerError(RpcRemoteLayerErrorCode.resultUnknown, reason, {
                  method: record.task.method,
                  generation: nativeGeneration
                })
            : closing
        )
  }

  /** Seal only new calls; accepted attempts keep their original native drain lifetime. */
  seal(reason: unknown): void {
    this.#sealed = true
    this.#closeReason = reason
  }

  /** Stop admission once, preserve the original close error, then cancel feature-owned backoff. */
  close(reason: unknown): void {
    if (this.#closed) return
    this.#closed = true
    this.#closeReason = reason
    for (const record of this.#records.values()) record.reject(reason)
    for (const invocation of this.#invocations) invocation.close(reason)
    this.#bySource.clear()
    this.#closing.abort(reason)
  }

  /** Start a fresh attempt only through the owning namespace's constant-time replacement policy. */
  #attempt(
    target: ICallTargetRef,
    command: ICallCommand,
    options: ICallLocalOptions,
    signal: IAbortSignal,
    remainingMs: number | undefined,
    written: () => void,
    attemptOptions?: IRpcAttemptOptions
  ): Promise<unknown> {
    this.#assertOpen()
    if (signal.aborted) throw createRpcAbortError(undefined, undefined, resolveAbortReason(signal))
    /** Only a new originating attempt may choose the namespace's current binding. */
    const current =
      options.origin === false || this.#options.refreshTarget === undefined
        ? target
        : this.#options.refreshTarget(target)
    if (current === undefined)
      throw createRpcError(
        RpcCoreErrorCode.targetUnknown,
        RpcCoreErrorText.unknownTarget(target.name)
      )
    if (
      attemptOptions?.expectedCarrierId !== undefined &&
      current.carrierId !== attemptOptions.expectedCarrierId
    )
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    if (attemptOptions?.expectedGeneration !== undefined) {
      /** Namespace refresh cannot substitute a different native generation for this attempt. */
      const available = this.#options
        .attemptFacts?.(current, command, options)
        .availability?.current()
      if (!available || available.generation !== attemptOptions.expectedGeneration)
        throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed, undefined, {
          generation: attemptOptions.expectedGeneration
        })
    }
    /** A feature-generated logical key is admitted by the same canonical options grammar. */
    const keyed =
      attemptOptions?.idempotencyKey === undefined
        ? options
        : {
            ...options,
            ...normalizeRpcCallOptions(
              {
                ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
                idempotencyKey: attemptOptions.idempotencyKey
              },
              command.mode,
              hostErrorWireMetadata
            )
          }
    /** Preparation is temporary; the record copies only compact identity fields. */
    const prepared = this.#prepare(current, command, { ...keyed, signal, remainingMs })
    /** Caller signal remains independent from the feature's per-attempt signal for BC6. */
    const record = new CallRecord(
      this.#recordOwner,
      current.carrierId,
      current.namespace,
      prepared.envelope,
      options.cancel === 'before-start',
      options.signal,
      options.origin === false &&
        command.mode === RpcCallMode.notify &&
        (options.forwardRoute?.length ?? 0) > 0,
      current.source,
      options.keepalive === true
    )
    /** Capture before send; synchronous carrier delivery is allowed to settle immediately. */
    const promise = record.promise
    this.#records.set(record.id, record)
    /** Only this source's record membership changes on its terminal transition. */
    let source = this.#bySource.get(current.carrierId)
    if (source === undefined) {
      source = new Set()
      this.#bySource.set(current.carrierId, source)
    }
    source.add(record)
    if (current.source) current.source.track(current.carrierId, promise)
    else this.#options.track?.(current.carrierId, promise)
    /** Feature hooks keep each physical handoff; forward observations borrow only the first one. */
    record.start(
      prepared.envelope,
      signal,
      options.transfer,
      written,
      attemptOptions?.onWriteStart,
      options.onWriteStart
    )
    return promise
  }

  /** Cancellation uses metadata only, including notifications whose public Promise already settled. */
  #cancel(record: CallRecord, reason: unknown): void {
    try {
      /** Serialize through the contract owner, preserving native name/stack/cause topology. */
      const frame: IRpcEnvelope = {
        profile: RpcWireProfile,
        kind: RpcWireKind.cancel,
        id: record.id,
        route: { ...record.route, sentAt: this.#timestamp() },
        task: record.task,
        reason: serializeHostWireError(reason, { report: (failure) => this.#report(failure.error) })
      }
      if (this.#closed || this.#records.get(record.id) !== record) return
      Promise.resolve(
        this.#options.send(
          record.carrierId,
          frame,
          record.keepalive ? { keepalive: true } : undefined,
          record.source
        )
      ).then(() => record.cancelSent(), this.#report)
    } catch (error) {
      this.#report(error)
    }
  }

  /** Media failures retain their native object and existing identity through the canonical rule. */
  #write(
    record: CallRecord,
    frame: IRpcEnvelope,
    options: import('./types.js').ICallWriteOptions
  ): Promise<void> {
    try {
      return Promise.resolve(
        this.#options.send(record.carrierId, frame, options, record.source)
      ).catch((error: unknown) => {
        throw identifyRpcBoundaryFailure(
          error,
          RpcCoreErrorCode.transport,
          RpcCoreErrorText.transportSendFailed
        )
      })
    } catch (error) {
      return Promise.reject(
        identifyRpcBoundaryFailure(
          error,
          RpcCoreErrorCode.transport,
          RpcCoreErrorText.transportSendFailed
        )
      )
    }
  }

  /** Diagnostic callback failure cannot interrupt cleanup or overwrite the original call result. */
  readonly #report = (error: unknown): void => reportDiagnostic(this.#options.report, error)

  /** All map/set memberships are deleted in O(1), including compact one-way cancellation routes. */
  #remove(record: CallRecord): void {
    this.#records.delete(record.id)
    /** An empty source set retains no retired binding key. */
    const source = this.#bySource.get(record.carrierId)
    source?.delete(record)
    if (source?.size === 0) this.#bySource.delete(record.carrierId)
  }

  /** Keep entry checks at supported boundaries; carrier/contract own payload and codec admission. */
  #validate<T extends ICallPreparationCommand>(command: T, options: ICallLocalOptions): T {
    if ('method' in command) assertCallMethod(command.method)
    if (
      options.signal !== undefined &&
      (typeof options.signal.addEventListener !== 'function' ||
        typeof options.signal.removeEventListener !== 'function')
    )
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.abortSignalInvalid)
    if (options.trace !== undefined) normalizeRpcTrace(options.trace, hostErrorWireMetadata)
    /** Preserve the original option getter order before choosing the local unsupported-mode error. */
    const wireOptions = {
      ...(options.orderKey === undefined ? {} : { orderKey: options.orderKey }),
      ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey })
    }
    if (
      command.mode === RpcCallMode.stream &&
      wireOptions.idempotencyKey !== undefined &&
      wireOptions.cancel !== RpcWireCancel
    )
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    normalizeRpcCallOptions(wireOptions, command.mode, hostErrorWireMetadata)
    return command.mode === RpcCallMode.group
      ? { ...command, steps: normalizeRpcSteps(command.steps, undefined, hostErrorWireMetadata) }
      : command
  }

  /** A host closing fence rejects new calls without aborting already accepted work. */
  #assertAdmission(keepalive = false): void {
    if (this.#sealed && !keepalive)
      throw isLocalRpcError(this.#closeReason, RpcLifecycleError)
        ? this.#closeReason
        : createRpcLifecycleError(RpcCoreErrorText.endpointDisposed, this.#closeReason)
    this.#assertOpen()
  }

  /** Close reasons are passed through unchanged, including deliberately non-Error thrown values. */
  #assertOpen(): void {
    if (this.#closed) throw this.#closeReason
  }
}
