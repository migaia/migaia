/**
 * Owns accepted native-member generation publication, source retirement and shared rebind
 * readiness. Borrows the real supervisor, carrier acquisition and Session attach/detach ports;
 * candidate rollback and waiter cleanup preserve native ownership without exposing a Peer/request
 * facade.
 */
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import { deferTask } from '@migaia/utils/scheduler'
import {
  SupervisorState as S,
  SupervisorEventType as E,
  type ISupervisorEvent
} from '@migaia/supervision'
import type {
  IRpcConnectionContext,
  IRpcSessionHandle,
  IRpcSessionView
} from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode, RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcAuthenticationError } from '@migaia/rpc-contract/errors'
import { createRemoteLayerError } from '../host/remote-error-owner.js'
import { isLocalRpcError, localRpcErrorCode } from '../host/error-owner.js'
import { resolveAbortReason } from '../host/abort-reason.js'
import { memberAggregate } from './member-errors.js'
import { RpcMemberFirstStart } from './member-start.js'
import { RpcMemberResources } from './member-resources.js'
import { nativeMemberStartup } from './flow-setup.js'
import type {
  IRpcMemberGenerationOptions,
  IRpcMemberSource,
  IRpcMemberCurrent
} from './member-types.js'

/** Readiness waiters retain only one target ordinal and their exact optional abort subscription. */
type IMemberWaiter = {
  after: number
  resolve(value: number): void
  reject(error: unknown): void
  signal?: IAbortSignal
  abort?: () => void
}
/** Only an accepted native generation retains its exact Session and one physical cleanup owner. */
type IMemberGeneration = Readonly<{
  number: number
  session: IRpcSessionHandle
  view: IRpcSessionView
  close(reason: unknown, nativeDeparture: boolean): Promise<void>
}>

/**
 * A candidate is owned before attach can fail; cleanup switches to the actual Session once
 * attached.
 */
class MemberCandidate {
  /** The original carrier and physical-retirement hook are borrowed without a Peer facade. */
  #source: IRpcMemberSource
  /** The actual transport context alone attaches and detaches SessionTable resources. */
  readonly #context: IRpcMemberGenerationOptions<unknown, unknown>['context']
  /** Synchronous attach ownership is retained before its ready Promise can reject. */
  session: IRpcSessionHandle | undefined
  /** Reentrant cleanup joins one Promise before physical callbacks can observe close. */
  #closing: Promise<void> | undefined
  /** Native retirement observation is removed after the actual Session/carrier cleanup completes. */
  #stop: (() => void) | undefined

  /** Retain acquired physical ownership before any handshake or publication begins. */
  constructor(
    source: IRpcMemberSource,
    context: IRpcMemberGenerationOptions<unknown, unknown>['context']
  ) {
    this.#source = source
    this.#context = context
  }
  /** The candidate owns this actual native remover independently from Session's single receiver. */
  observe(listener: (reason: unknown) => void): void {
    this.#stop = this.#source.onRetire?.(listener)
  }
  /** Transfer secrets only after cleanup is owned, retaining only physical source collaborators. */
  takeConnection(): readonly [IRpcMemberSource, IRpcConnectionContext | undefined] {
    /** A throwing native source getter still leaves the original acquired carrier rollback-owned. */
    const { connectionContext, ...source } = this.#source
    this.#source = source
    return [source, connectionContext]
  }
  /** Native departure lends physical loss first; explicit release keeps Session-first cleanup. */
  readonly close = (reason?: unknown, nativeDeparture = false): Promise<void> => {
    if (this.#closing) return this.#closing
    /** Publish shared cleanup before a synchronous transport callback can reenter. */
    const completion = deferred<void>()
    this.#closing = completion.promise
    void this.#release(reason, nativeDeparture).then(completion.resolve, completion.reject)
    return this.#closing
  }
  /** Preserve actual native failure, Session cleanup and remover order without losing any primary. */
  async #release(reason: unknown, nativeDeparture: boolean): Promise<void> {
    /** The same collected errors drive candidate rollback and actual accepted retirement. */
    const errors: unknown[] = []
    if (nativeDeparture) {
      try {
        await this.#source.carrier.close(reason)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      if (this.session) await this.#context.detach(this.session, reason)
      else if (!nativeDeparture) await this.#source.carrier.close(reason)
    } catch (error) {
      /** Session may return the same original carrier failure already collected by native close. */
      if (errors.length === 0 || errors[0] !== error) errors.push(error)
    }
    try {
      /** Native removers keep the original detached callback receiver. */
      const stop = this.#stop
      stop?.()
    } catch (error) {
      errors.push(error)
    }
    this.#stop = undefined
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw memberAggregate(errors, RpcRemoteLayerErrorCode.closed)
  }
}

/**
 * Shared native member generation algorithm; supervision policy and business calls stay outside
 * SDK.
 */
export class RpcMemberGeneration<TUnit, TSpec> {
  /** Original context, native supervisor and clock are supplied once by the installing transport. */
  readonly #options: IRpcMemberGenerationOptions<TUnit, TSpec>
  /** The original holder owns reverse rollback and shared replacement preparation. */
  readonly #resources: RpcMemberResources
  /** Only genuinely accepted Session readiness publishes this pointer. */
  #current: IMemberGeneration | undefined
  /** Failed candidates never consume this accepted-session ordinal. */
  #ordinal = -1
  /** Only the most recent departure retains its original failure, independent of restart count. */
  #departed: Readonly<{ generation: number; reason: unknown }> | undefined
  /** A scalar closes forgotten old generations without retaining their errors or subscriptions. */
  #departedThrough = -1
  /** Actual native readiness can remain on an older unit after a newer replacement fails. */
  #readyGeneration: number | undefined
  /** Outstanding physical cleanup survives retirement until the original Promise settles. */
  readonly #closing = new Map<number, Promise<void>>()
  /** Leave observation is source-generation qualified and removed on departure or unsubscribe. */
  readonly #listeners = new Map<number, Set<(reason: unknown) => void>>()
  /** Pending ready observers remove their abort subscription at every terminal path. */
  readonly #waiters = new Set<IMemberWaiter>()
  /** The sole native subscription feeds both lifecycle retirement and coalesced reconciliation. */
  readonly #unsubscribe: () => void
  /** Final cleanup closes admission before callbacks while all joiners share one Promise. */
  #released: Promise<void> | undefined
  /** Late leave observers retain the actual original final-close error. */
  #releaseReason: unknown
  /** Native observations cannot start an extra parallel rebind. */
  #running = false
  /** An observation during a pending prepare requests one later native-state reconciliation. */
  #pending = false
  /** Automatic observation begins only after initial accepted readiness, as in the original owner. */
  #observing = false
  /** Initial callers join one actual setup without allocating another native candidate. */
  #opened: Promise<IRpcSessionView> | undefined

  /** Subscribe to the supplied native owner without starting, attaching or publishing a member. */
  constructor(options: IRpcMemberGenerationOptions<TUnit, TSpec>) {
    this.#options = options
    this.#resources = new RpcMemberResources(this, options.report, true)
    this.#unsubscribe = options.binding.supervisor.subscribe(this.#native)
    nativeMemberStartup(options.context)?.own(this.#resources.release)
  }

  /** Return safe accepted metadata, without exposing a per-session request/notify factory. */
  current(): IRpcMemberCurrent {
    return {
      generation: this.#current?.number ?? this.observedGeneration(),
      active: this.#current !== undefined,
      ...(this.#current ? { session: this.#current.view } : {})
    }
  }
  /** The native source borrows its exact accepted handle without creating another media owner. */
  currentHandle(): IRpcSessionHandle | undefined {
    return this.#current?.session
  }
  /** The original native owner alone chooses execution generation numbers. */
  observedGeneration(): number {
    return this.#options.binding.supervisor.generation
  }

  /** Open once; initial failure releases original native resources without replacing its primary. */
  open(): Promise<IRpcSessionView> {
    return (this.#opened ??= this.#open())
  }
  /** Preserve actual setup rollback and only begin background observation after acceptance. */
  async #open(): Promise<IRpcSessionView> {
    try {
      await this.#resources.prepareInitial(
        this.#options.signal,
        true,
        nativeMemberStartup(this.#options.context)?.failed
      )
      this.#observing = true
      return this.#current!.view
    } catch (primary) {
      try {
        await this.#resources.release()
      } catch (cleanup) {
        this.#options.report(cleanup)
      }
      throw primary
    }
  }
  /** Native observations share preparation; a caller may abandon only its own readiness wait. */
  rebind(signal: IAbortSignal = this.#options.signal): Promise<number> {
    return this.#resources.prepareRebind(this.#options.signal, signal)
  }
  /** Cold lifecycle oracles count only actual acquired resource groups. */
  retainedResourceCount(): number {
    return this.#resources.retainedResourceCount()
  }
  /** Explicit final removal joins the original holder, including any incomplete candidate rollback. */
  close(): Promise<void> {
    return this.#resources.release()
  }

  /** Prepare the exact native unit through carrier acquisition, attach and real accepted readiness. */
  async prepareGeneration(
    signal: IAbortSignal,
    own: (dispose: () => Promise<void>) => void
  ): Promise<number> {
    if (this.#released) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    /** Supervision remains native; only initial idle start has the original first-backoff boundary. */
    const supervisor = this.#options.binding.supervisor
    /** The original native outcome retains its exact unit and execution generation. */
    const outcome =
      supervisor.state === S.idle
        ? await new RpcMemberFirstStart(supervisor, signal, this.#options.report).promise
        : await supervisor.whenReady(signal)
    if (signal.aborted) throw resolveAbortReason(signal)
    if (this.#released) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    if (outcome.state !== S.ready) {
      /** The native failure is retained before candidate acquisition, including capacity refusal. */
      const snapshot = supervisor.inspect()
      throw createRemoteLayerError(
        RpcRemoteLayerErrorCode.startFailed,
        snapshot.terminalError ?? snapshot.lastExit?.error ?? outcome,
        { state: outcome.state }
      )
    }
    /** The actual serving outcome, rather than the latest attempt number, establishes readiness. */
    if (this.#departed?.generation !== outcome.generation)
      this.#readyGeneration = outcome.generation
    this.#assertPreparing(signal, outcome.generation)
    /** Ordinals remain reserved until the accepted pointer commits. */
    const ordinal = this.#ordinal + 1
    /** Physical acquisition keeps its original native failure reachable on the remote error cause. */
    let source: IRpcMemberSource
    try {
      source = await this.#options.binding.openCarrier(outcome.unit, signal, ordinal)
    } catch (cause) {
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.startFailed, cause)
    }
    /** This exact cleanup callback is registered before attach/handshake can fail. */
    const candidate = new MemberCandidate(source, this.#options.context)
    own(candidate.close)
    /** The registered physical cleanup remains authoritative if private context acquisition fails. */
    const [physicalSource, connectionContext] = candidate.takeConnection()
    this.#assertPreparing(signal, outcome.generation)
    candidate.observe((reason) => this.#leave(outcome.generation, reason, true))
    /** Pending native departure settles this same Session before another handshake failure can win. */
    const stopPreparing = this.onLeave(outcome.generation, (reason) => {
      // The original holder already owns and joins this exact close Promise during rollback.
      void candidate.close(signal.aborted ? resolveAbortReason(signal) : reason, true)
    })
    /** Attach and readiness share the same original native startup error boundary as acquisition. */
    let view: IRpcSessionView
    try {
      candidate.session = this.#options.context.attach(
        physicalSource.carrier,
        { ...physicalSource.localSourceFacts, nativeGeneration: this },
        connectionContext
      )
      view = await candidate.session.ready
    } catch (cause) {
      /** Only Session's actual reject receipt preserves its original handshake phase and error. */
      const failure = candidate.session?.handshakeFailure
      if (failure && cause === failure.error) throw cause
      /** Local Auth/config refusal stays primary; an already-aborted caller keeps priority. */
      if (
        !signal.aborted &&
        (isLocalRpcError(cause, RpcAuthenticationError) ||
          localRpcErrorCode(cause) === RpcCoreErrorCode.invalidConfig)
      )
        throw cause
      /** Native departure or caller cancellation keeps its original preparation checkpoint error. */
      this.#assertPreparing(signal, outcome.generation)
      throw createRemoteLayerError(RpcRemoteLayerErrorCode.startFailed, cause)
    } finally {
      stopPreparing()
    }
    this.#assertPreparing(signal, outcome.generation)
    /** Physical closure without a separate native receipt still revokes this exact accepted member. */
    void candidate.session.closed.then(
      () => this.#leave(outcome.generation, undefined, false),
      (reason: unknown) => this.#leave(outcome.generation, reason, false)
    )
    if (this.#current && this.#current.number !== outcome.generation)
      this.#leave(this.#current.number, undefined, true)
    this.#ordinal = ordinal
    this.#current = {
      number: outcome.generation,
      session: candidate.session,
      view,
      close: candidate.close
    }
    try {
      this.#options.onReady?.(view, outcome.generation, outcome.unit, candidate.session)
    } catch (error) {
      this.#options.report(error)
    }
    for (const waiter of this.#waiters)
      if (outcome.generation > waiter.after) this.#settle(waiter, outcome.generation, true)
    return outcome.generation
  }

  /** Cancelled/released/departed candidates cannot publish after a native checkpoint. */
  #assertPreparing(signal: IAbortSignal, generation: number): void {
    if (signal.aborted) throw resolveAbortReason(signal)
    if (this.#released) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    if (this.#hasDeparted(generation)) throw this.#closedGeneration(generation)
  }

  /** Current serving facts remain valid when a newer native replacement candidate has departed. */
  #hasDeparted(generation: number): boolean {
    return (
      generation <= this.#departedThrough &&
      generation !== this.#current?.number &&
      generation !== this.#readyGeneration
    )
  }

  /** Forgotten generations retain their identity on the existing closed error without a cause. */
  #closedGeneration(generation: number): Error {
    return createRemoteLayerError(
      RpcRemoteLayerErrorCode.closed,
      this.#departed?.generation === generation ? this.#departed.reason : undefined,
      { generation }
    )
  }

  /** Revoke publication before leave observers and the original Session/physical disposal. */
  #leave(generation: number, reason: unknown, nativeDeparture: boolean): void {
    if (this.#hasDeparted(generation) || (this.#released && this.#current?.number !== generation))
      return
    this.#departedThrough = Math.max(this.#departedThrough, generation)
    this.#departed = { generation, reason }
    if (this.#readyGeneration === generation) this.#readyGeneration = undefined
    /** Only this exact generation can retire its accepted Session. */
    const current = this.#current?.number === generation ? this.#current : undefined
    if (current) this.#current = undefined
    for (const listener of this.#listeners.get(generation) ?? []) {
      try {
        listener(reason)
      } catch (error) {
        this.#options.report(error)
      }
    }
    this.#listeners.delete(generation)
    if (current) {
      /** Leave observers run first, while actual cleanup remains observable by its original Promise. */
      /** Final registration release keeps logical shutdown even if a native receipt reenters it. */
      const closing = current.close(reason, nativeDeparture && !this.#released)
      this.#closing.set(generation, closing)
      void closing.then(
        () => {
          this.#closing.delete(generation)
        },
        (error: unknown) => {
          this.#closing.delete(generation)
          this.#options.report(error)
        }
      )
    }
  }

  /**
   * Late observers receive the latest original reason or a cause-free closed error on the native
   * clock without synchronous reentry.
   */
  onLeave(generation: number, listener: (reason: unknown) => void): () => void {
    if (this.#released || this.#hasDeparted(generation)) {
      /** Capture only this observation's result before final cleanup releases the latest reason. */
      const receipt = {
        listener,
        reason:
          this.#releaseReason ??
          (this.#departed?.generation === generation
            ? this.#departed.reason
            : this.#closedGeneration(generation))
      }
      deferTask(this.#options.binding.scheduler, () => {
        try {
          receipt.listener(receipt.reason)
        } catch (error) {
          this.#options.report(error)
        }
      })
      return () => undefined
    }
    /** Source generation is the only lookup key; no delimiter-concatenated identity is introduced. */
    const listeners = this.#listeners.get(generation) ?? new Set<(reason: unknown) => void>()
    listeners.add(listener)
    this.#listeners.set(generation, listeners)
    /** One subscription record owns all fields needed by its exact remover. */
    const receipt = { listeners, listener, generation }
    return () => {
      receipt.listeners.delete(receipt.listener)
      if (receipt.listeners.size === 0) this.#listeners.delete(receipt.generation)
    }
  }
  /**
   * Lookup after synchronous leave observers return, when retirement has registered its cleanup.
   * Join that original Promise without treating an already-reported physical failure as a new one.
   */
  whenClosed(generation: number): Promise<void> {
    return Promise.resolve().then(() =>
      this.#closing.get(generation)?.then(
        () => undefined,
        () => undefined
      )
    )
  }
  /**
   * Wait only for a genuinely accepted later execution generation and release exactly one abort
   * hook.
   */
  whenReady(after: number, signal?: IAbortSignal): Promise<number> {
    if (this.#released) return Promise.reject(this.#releaseReason)
    if (this.#current && this.#current.number > after) return Promise.resolve(this.#current.number)
    /** Promise construction borrows one explicit wait input rather than several outer variables. */
    const input = { after, signal }
    return new Promise<number>((resolve, reject) => {
      this.#registerWaiter({ after: input.after, resolve, reject, signal: input.signal })
    })
  }
  /** One explicit waiter owns its abort callback until settlement, cancellation or release. */
  #registerWaiter(waiter: IMemberWaiter): void {
    waiter.abort = () => {
      this.#settle(waiter, resolveAbortReason(waiter.signal!), false)
    }
    if (waiter.signal?.aborted) {
      waiter.abort()
      return
    }
    waiter.signal?.addEventListener('abort', waiter.abort, { once: true })
    this.#waiters.add(waiter)
  }
  /** Clear one waiter and its exact abort remover before invoking its Promise continuation. */
  #settle(waiter: IMemberWaiter, result: unknown, success: boolean): void {
    this.#waiters.delete(waiter)
    if (waiter.abort) waiter.signal?.removeEventListener('abort', waiter.abort)
    if (success) waiter.resolve(result as number)
    else waiter.reject(result)
  }

  /** Native supervision observations retire first; accepted readiness may reconcile once afterwards. */
  readonly #native = (event: ISupervisorEvent<TUnit>): void => {
    /** Retain only this observation's pre-retirement accepted identity for the passive receiver. */
    const current = this.current()
    if (event.type === E.exit) this.#leave(event.generation, event.error, true)
    if (event.type === E.switched) this.#leave(event.from, undefined, true)
    if (
      event.type === E.state &&
      (event.to === S.stopped || event.to === S.disposed) &&
      this.#current
    )
      this.#leave(this.#current.number, undefined, !this.#released)
    if (event.type === E.terminal) {
      if (this.#current) this.#leave(this.#current.number, event.error, true)
      /** Initial and waiting clients retain the original native terminal error as cause. */
      const failure = createRemoteLayerError(RpcRemoteLayerErrorCode.startFailed, event.error, {
        state: E.terminal
      })
      for (const waiter of this.#waiters) this.#settle(waiter, failure, false)
    }
    try {
      this.#options.onNative?.(event, current)
    } catch (error) {
      this.#options.report(error)
    }
    if (!this.#observing || this.#released) return
    if (
      event.type === E.exit ||
      event.type === E.switched ||
      (event.type === E.state && event.to === S.ready)
    ) {
      this.#pending = true
      if (!this.#running) {
        this.#running = true
        deferTask(this.#options.binding.scheduler, this.#drain)
      }
    }
  }
  /** Coalescing uses the original borrowed scheduler; no new supervisor, retry or clock is created. */
  readonly #drain = (): void => {
    void this.#reconcile().catch(this.#options.report)
  }
  /** One native observation loop joins the holder's actual shared replacement preparation. */
  async #reconcile(): Promise<void> {
    try {
      while (this.#pending && this.#observing && !this.#released) {
        this.#pending = false
        if (
          this.#options.signal.aborted ||
          this.#current ||
          this.#options.binding.supervisor.state !== S.ready
        )
          continue
        try {
          await this.rebind()
        } catch {
          /* The original holder reports failed replacement and keeps it revoked. */
        }
      }
    } finally {
      this.#running = false
    }
  }

  /** Holder-only final registration release preserves drain, retirement and native-dispose order. */
  releaseRegistration(): Promise<void> {
    if (this.#released) return this.#released
    /** Publish before native drain or leave observers can reenter close. */
    const completion = deferred<void>()
    this.#released = completion.promise
    this.#releaseReason = createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    this.#observing = false
    this.#unsubscribe()
    for (const waiter of this.#waiters) this.#settle(waiter, this.#releaseReason, false)
    void this.#release().then(completion.resolve, completion.reject)
    return this.#released
  }
  /** Drain failures cannot prevent Session retirement or disposal of an actually owned supervisor. */
  async #release(): Promise<void> {
    /**
     * Native drain precedes the original Session cleanup; every failure remains in acquisition
     * order.
     */
    const failures: unknown[] = []
    try {
      if (this.#options.beforeRelease) {
        try {
          await Promise.resolve().then(this.#options.beforeRelease)
        } catch (failure) {
          failures.push(failure)
        }
      }
      /** Snapshot before revocation so the same actual cleanup Promise is joined below. */
      const current = this.#current
      if (current) {
        this.#leave(current.number, this.#releaseReason, false)
        try {
          await this.#closing.get(current.number)
        } catch (failure) {
          failures.push(failure)
        }
      }
      if (this.#options.binding.ownership === 'owned') {
        try {
          await this.#options.binding.supervisor.dispose()
        } catch (failure) {
          failures.push(failure)
        }
      }
    } finally {
      await Promise.allSettled(this.#closing.values())
      this.#departed = undefined
      this.#readyGeneration = undefined
      this.#listeners.clear()
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw memberAggregate(failures, RpcRemoteLayerErrorCode.closed)
  }
}
