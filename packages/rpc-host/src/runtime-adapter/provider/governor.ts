import { createRuntimeDiagnosticError } from '../byte/diagnostics.js'
import type { IRuntimeDiagnosticError } from '../byte/types.js'
import {
  attachProviderBulkAdmission,
  projectNativeStreamResult,
  retainProviderPreflight,
  wrapProviderStreamAdmission,
  type IProviderBulkAdmission
} from '../../core/internal/provider.js'
import { deferTask, type IScheduledTask } from '@migaia/utils/scheduler'
import { portableBytes } from '../../core/idempotency-store.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import type { IRpcProviderRejection } from '../../core/provider-admission.js'
import { RpcProviderRejectionReason } from '../../core/semantic-constants.js'
import { localRpcErrorCode, RpcCoreErrorCode, tagRpcError } from '../../core/errors.js'
import { runtimeConnectionPrincipal } from '../byte/connection-identity.js'
import { RuntimeAdapterErrorText } from '../byte/error-text.js'
import { readAdapterMessagePreparation } from '../message/resource.js'
import type {
  IRpcContext,
  IRpcEndpoint,
  IRpcProvider,
  IRpcProviderLimits,
  IRpcProviderResult
} from '../../core/typing.js'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../remote/types.js'

/** Numeric connection policies remain chosen by the adapter's existing service governor. */
export type IRuntimeProviderPolicy = Readonly<{
  maxCallsPerMinute: number
  maxPayloadBytes: number
  maxConsecutiveTimeouts: number
  idleTimeoutMs: number
  violationLimit: number
  overflow: IRuntimeDiagnosticError
}>

/** One minute is measured by the injected monotonic scheduler, never wall time. */
const RATE_WINDOW_MS = 60_000

/** A service connection owns its quota counters and frame observer until it closes. */
export type IRuntimeProviderGovernor = Readonly<{
  /** Attach the canonical local core refusal notification before endpoint construction. */
  limits(limits: IRpcProviderLimits, configured?: IRpcProviderLimits): IRpcProviderLimits
  /** Apply the held connection's provider policy to its actual prepared endpoint. */
  endpoint(endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
  /** Reuse this connection's original guarded callback and atomic bulk-admission identity. */
  provider(original: IRpcProvider): IRpcProvider
  /** Enter the actual producer's existing activity/deadline lifetime without another iterator. */
  enterStream(context: IRpcContext): (succeeded: boolean) => void
  /** Host producers and the original wrapper borrow the same native terminal-value policy. */
  streamResult: typeof projectNativeStreamResult
  /** Retire this governor's timers and diagnostic subscriptions. */
  close(): void
}>

/** The exact governor retains its original channel; copied methods do not create policy authority. */
const governors = new WeakMap<
  object,
  Readonly<{ channel: IRemoteChannel; governor: IRuntimeProviderGovernor }>
>()

/** Listener attachment reads only the actual governor created over its original connection. */
export function readRuntimeProviderGovernor(governor: IRuntimeProviderGovernor) {
  return governors.get(governor)
}

/** Enforce per-connection rate, payload, and idle limits at the provider boundary. */
export function createRuntimeProviderGovernor(
  channel: IRemoteChannel,
  options: IRuntimeProviderPolicy,
  closeSession: () => Promise<void>,
  report: (error: unknown) => void
): IRuntimeProviderGovernor {
  /** One concrete connection owns counters, subscriptions, and its frozen public policy methods. */
  const governor = Object.freeze(
    new RuntimeProviderGovernor(channel, options, closeSession, report)
  )
  governors.set(governor, Object.freeze({ channel, governor }))
  return governor
}

/** Quota and activity ownership live on the actual held connection, independently of callbacks. */
class RuntimeProviderGovernor implements IRuntimeProviderGovernor {
  /** Adapter-selected policy remains immutable for this original connection. */
  readonly #options: IRuntimeProviderPolicy
  /** Policy retirement delegates to the existing session owner. */
  readonly #closeSession: () => Promise<void>
  /** Cleanup failures retain the original unbound diagnostic callback. */
  readonly #report: (error: unknown) => void
  /** Rate and idle accounting use the connection's original monotonic scheduler. */
  readonly #scheduler: IRemoteChannel['scheduler']
  /** A window begins at connection construction and advances on the next admitted request. */
  #windowStart: number
  /** Ordinary calls and prepaid group members debit the same original bucket. */
  #callsInWindow = 0
  /** Consecutive local quota or concurrency refusals trigger the configured close threshold. */
  #violations = 0
  /** Only core-owned deadline aborts increment the consecutive timeout policy. */
  #consecutiveTimeouts = 0
  /** Actual producer activity prevents idle retirement until its lifetime settles. */
  #active = 0
  /** The physical inbound observer supplies the idle clock's latest activity. */
  #lastInboundAt: number
  /** Retirement is terminal and cannot reschedule an idle deadline. */
  #closed = false
  /** Only the current idle deadline belongs to this governor. */
  #idleTimer: IScheduledTask | undefined
  /** In-flight providers may ignore cancellation, so retirement owns their abort subscriptions. */
  readonly #abortSubscriptions = new Set<() => void>()
  /** Physical activity observation is removed exactly once during retirement. */
  readonly #unsubscribe: () => void
  /** Repeated registration retains each provider's exact guarded callback identity. */
  readonly #guardedProviders = new WeakMap<IRpcProvider, IRpcProvider>()
  /** Core group reservations and ordinary invocation share this one admission identity. */
  readonly #bulkAdmission: IProviderBulkAdmission = {
    reserveMany: (payloads) => this.#reserveMany(payloads)
  }

  /** Validate native provenance before subscribing or starting any connection timer. */
  constructor(
    channel: IRemoteChannel,
    options: IRuntimeProviderPolicy,
    closeSession: () => Promise<void>,
    report: (error: unknown) => void
  ) {
    if (
      runtimeConnectionPrincipal(channel) === undefined &&
      readAdapterMessagePreparation(channel) === undefined
    )
      throw tagRpcError(
        new TypeError(RuntimeAdapterErrorText.connectionRequired),
        RpcCoreErrorCode.invalidConfig
      )
    this.#options = options
    this.#closeSession = closeSession
    this.#report = report
    this.#scheduler = channel.scheduler
    this.#windowStart = this.#scheduler.now()
    this.#lastInboundAt = this.#scheduler.now()
    this.#unsubscribe = channel.transport.subscribe(() => {
      this.#lastInboundAt = this.#scheduler.now()
      this.#scheduleIdle()
    })
    this.#scheduleIdle()
  }

  /** A policy close remains secondary to the provider's primary result. */
  #requestClose = (): void => {
    void (0, this.#closeSession)().catch(this.#report)
  }

  /** Only a quiet connection with no active producer work can retire for idleness. */
  #scheduleIdle = (): void => {
    this.#idleTimer?.cancel()
    if (this.#closed || this.#active > 0) return
    this.#idleTimer = this.#scheduler.schedule(
      () => {
        this.#idleTimer = undefined
        if (this.#closed || this.#active > 0) return
        if (this.#scheduler.now() - this.#lastInboundAt >= this.#options.idleTimeoutMs)
          this.#requestClose()
        else this.#scheduleIdle()
      },
      Math.max(0, this.#lastInboundAt + this.#options.idleTimeoutMs - this.#scheduler.now())
    )
    this.#idleTimer.unref?.()
  }

  /** Local quota and core concurrency refusals retain their shared consecutive count. */
  #violate = (): void => {
    this.#violations += 1
    if (this.#violations >= this.#options.violationLimit)
      deferTask(this.#scheduler, this.#requestClose)
  }

  /** Advance the original minute bucket only when ordinary or grouped work seeks admission. */
  #advanceWindow(): void {
    /** The injected monotonic clock supplies the same timestamp used by both admission paths. */
    const now = this.#scheduler.now()
    if (now - this.#windowStart >= RATE_WINDOW_MS) {
      this.#windowStart = now
      this.#callsInWindow = 0
    }
  }

  /** Reject quota or payload overflow before invoking the actual provider. */
  #admit(context: IRpcContext): void {
    this.#advanceWindow()
    if (
      this.#callsInWindow >= this.#options.maxCallsPerMinute ||
      portableBytes(context.data as IRpcPortableValue, this.#options.maxPayloadBytes) >
        this.#options.maxPayloadBytes
    ) {
      this.#violate()
      throw createRuntimeDiagnosticError(this.#options.overflow)
    }
    this.#callsInWindow += 1
  }

  /** Validate all group payloads once before debiting their shared original minute bucket. */
  #reserveMany(payloads: Parameters<IProviderBulkAdmission['reserveMany']>[0]) {
    this.#advanceWindow()
    if (
      this.#callsInWindow + payloads.length > this.#options.maxCallsPerMinute ||
      payloads.some(
        (payload) =>
          portableBytes(payload as IRpcPortableValue, this.#options.maxPayloadBytes) >
          this.#options.maxPayloadBytes
      )
    ) {
      this.#violate()
      throw createRuntimeDiagnosticError(this.#options.overflow)
    }
    this.#callsInWindow += payloads.length
    return new GovernorReservation(this, this.#windowStart, payloads.length)
  }

  /** Unexecuted group credit can return only to the minute bucket that reserved it. */
  releaseReserved(window: number, remaining: number): void {
    if (this.#windowStart === window) this.#callsInWindow -= remaining
  }

  /** Begin actual producer activity before attaching its canonical deadline observer. */
  beginActivity(): void {
    this.#active += 1
    this.#idleTimer?.cancel()
    this.#idleTimer = undefined
  }

  /** Retirement retains the exact listener only after native attachment succeeds. */
  retainActivity(unsubscribeAbort: () => void): void {
    this.#abortSubscriptions.add(unsubscribeAbort)
  }

  /** Only locally created deadline errors contribute to the connection's timeout policy. */
  observeDeadline(context: IRpcContext): boolean {
    if (this.#closed) return false
    if (localRpcErrorCode(resolveAbortReason(context.signal)) !== RpcCoreErrorCode.deadlineExceeded)
      return false
    this.#consecutiveTimeouts += 1
    if (this.#consecutiveTimeouts === this.#options.maxConsecutiveTimeouts)
      deferTask(this.#scheduler, this.#requestClose)
    return true
  }

  /** A successful uncancelled producer resets refusals; every producer retires activity once. */
  finishActivity(context: IRpcContext, succeeded: boolean, unsubscribeAbort: () => void): void {
    this.#abortSubscriptions.delete(unsubscribeAbort)
    if (!this.#closed && succeeded && !context.signal.aborted) {
      this.#consecutiveTimeouts = 0
      this.#violations = 0
    }
    this.#active -= 1
    this.#scheduleIdle()
  }

  /** Each actual provider or stream receives one independently owned activity receipt. */
  #track(context: IRpcContext): (succeeded: boolean) => void {
    return new GovernorActivity(this, context).settle
  }

  /** Preserve native provider result and Promise identity while retaining one guarded registration. */
  readonly provider = (provider: IRpcProvider): IRpcProvider => {
    /** Repeated lookup must retain the same quota registration and bulk-admission metadata. */
    const retained = this.#guardedProviders.get(provider)
    if (retained) return retained
    /** Settlement observes the provider's result without replacing its returned Promise. */
    const invoke: IRpcProvider = (context) => {
      /** One activity receipt survives either synchronous failure or asynchronous settlement. */
      const settle = this.#track(context)
      /** The original provider result escapes unchanged after its activity observer is attached. */
      let result: IRpcProviderResult | Promise<IRpcProviderResult>
      try {
        result = provider(context)
      } catch (error) {
        settle(false)
        throw error
      }
      void Promise.resolve(result).then(
        (value) => settle(value.ok),
        () => settle(false)
      )
      return result
    }
    /** Preflight admission remains attached to the actual invocation callback. */
    const guardedProvider = attachProviderBulkAdmission(
      retainProviderPreflight(provider, (context: IRpcContext) => {
        this.#admit(context)
        return invoke(context)
      }),
      { admission: this.#bulkAdmission, invoke }
    )
    this.#guardedProviders.set(provider, guardedProvider)
    return guardedProvider
  }

  /** The same state-free callback serves the wrapper and the canonical Host producer. */
  readonly streamResult = projectNativeStreamResult

  /** Runtime stream entry uses the same counters and deadline observer as ordinary provider calls. */
  readonly enterStream = (context: IRpcContext): ((succeeded: boolean) => void) => {
    this.#admit(context)
    return this.#track(context)
  }

  /** Preserve selected limits and both original refusal observers on the same connection. */
  readonly limits = (
    limits: IRpcProviderLimits,
    configured?: IRpcProviderLimits
  ): IRpcProviderLimits => {
    /** Valid selected limits cannot exceed the base; invalid values still reach Core unchanged. */
    const maximum = (base: number | undefined, selected: number | undefined): number | undefined =>
      selected === undefined
        ? base
        : base !== undefined && Number.isSafeInteger(selected) && selected > 0
          ? Math.min(base, selected)
          : selected
    /** This list has exactly two possible observers, so identity deduplication has a fixed bound. */
    const observers = [limits.onRejected, configured?.onRejected].filter(
      (observer, index, all) => observer !== undefined && all.indexOf(observer) === index
    )
    return Object.freeze({
      ...limits,
      ...configured,
      maxGlobal: maximum(limits.maxGlobal, configured?.maxGlobal),
      maxPerPeer: maximum(limits.maxPerPeer, configured?.maxPerPeer),
      onRejected: (rejection: IRpcProviderRejection) => {
        if (rejection.reason === RpcProviderRejectionReason.concurrency) this.#violate()
        if (observers.length < 2) return observers[0]?.(rejection)
        return Promise.allSettled(
          observers.map((observer) => Promise.resolve().then(() => observer!(rejection)))
        ).then((outcomes) => {
          for (const outcome of outcomes)
            if (outcome.status === 'rejected') (0, this.#report)(outcome.reason)
        })
      }
    })
  }

  /** Shadow only provider registration while preserving the frozen endpoint's actual dispatch. */
  readonly endpoint = (endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint => {
    /** The guard inherits the genuine Core endpoint instead of recreating a dispatcher. */
    const guardedEndpoint: IRpcEndpoint = Object.create(endpoint.endpoint)
    Object.defineProperty(guardedEndpoint, 'provide', {
      value: (method: string, provider: IRpcProvider) => {
        endpoint.endpoint.provide(method, this.provider(provider))
        return guardedEndpoint
      }
    })
    Object.freeze(guardedEndpoint)
    /** Stream registration preserves its original producer and retained preflight metadata. */
    const stream = endpoint.stream
      ? Object.freeze({
          ...endpoint.stream,
          provide: (
            method: string,
            run: Parameters<NonNullable<IRemoteServeEndpoint['stream']>['provide']>[1]
          ) =>
            endpoint.stream!.provide(
              method,
              retainProviderPreflight(
                run,
                wrapProviderStreamAdmission(
                  run,
                  (params: unknown, streamContext: Parameters<typeof run>[1]) =>
                    this.#runStream(run, params, streamContext),
                  this.enterStream
                )
              )
            )
        })
      : undefined
    return Object.freeze({ ...endpoint, endpoint: guardedEndpoint, ...(stream ? { stream } : {}) })
  }

  /** Preserve native stream terminal values while pairing the original admission lifetime. */
  async *#runStream(
    run: Parameters<NonNullable<IRemoteServeEndpoint['stream']>['provide']>[1],
    params: unknown,
    streamContext: Parameters<typeof run>[1]
  ) {
    /** Runtime producers already enter through their retained native admission owner. */
    const context = streamContext.context
    if (context.targetGeneration === undefined) this.#admit(context)
    /** Only legacy producer entry needs a new receipt; runtime entry already owns one. */
    const settle = context.targetGeneration === undefined ? this.#track(context) : undefined
    /** Only normal producer completion resets consecutive policy failures. */
    let succeeded = false
    try {
      /** Delegate the exact iterator and preserve its runtime terminal result. */
      const result = yield* run(params, streamContext)
      succeeded = true
      return projectNativeStreamResult(result, context)
    } finally {
      settle?.(succeeded)
    }
  }

  /** Cancel timers and remove original subscriptions without reviving the held connection. */
  readonly close = (): void => {
    if (this.#closed) return
    this.#closed = true
    this.#idleTimer?.cancel()
    for (const unsubscribeAbort of this.#abortSubscriptions) unsubscribeAbort()
    this.#abortSubscriptions.clear()
    ;(0, this.#unsubscribe)()
  }
}

/** One group reservation owns only its unused credit and the bucket that granted it. */
class GovernorReservation {
  /** Counter mutations stay with the original connection governor. */
  readonly #governor: RuntimeProviderGovernor
  /** Rollback never subtracts credit from a later minute's bucket. */
  readonly #window: number
  /** Consumed members cannot be refunded by later cancellation or close. */
  #remaining: number

  /** Capture the original bucket after its one atomic bulk debit. */
  constructor(governor: RuntimeProviderGovernor, window: number, count: number) {
    this.#governor = governor
    this.#window = window
    this.#remaining = count
  }

  /** A member consumes at most one already-reserved call credit. */
  readonly consume = (): void => {
    if (this.#remaining > 0) this.#remaining -= 1
  }

  /** Release unexecuted credit exactly once to its original minute bucket. */
  readonly release = (): void => {
    this.#governor.releaseReserved(this.#window, this.#remaining)
    this.#remaining = 0
  }
}

/** One actual producer owns its deadline subscription and idempotent settlement receipt. */
class GovernorActivity {
  /** Original connection accounting remains the only quota and idle authority. */
  readonly #governor: RuntimeProviderGovernor
  /** The provider context supplies the canonical cancellation signal and reason. */
  readonly #context: IRpcContext
  /** One operation contributes at most one core-owned deadline. */
  #timedOut = false
  /** Provider callbacks and stream finally blocks can retire this activity only once. */
  #settled = false

  /** Enter activity before observing an already-aborted original provider signal. */
  constructor(governor: RuntimeProviderGovernor, context: IRpcContext) {
    this.#governor = governor
    this.#context = context
    governor.beginActivity()
    context.signal.addEventListener('abort', this.#onAbort, { once: true })
    governor.retainActivity(this.#unsubscribeAbort)
    if (context.signal.aborted) this.#onAbort()
  }

  /** Deadline classification reads only the original Core-created abort reason. */
  #onAbort = (): void => {
    if (this.#timedOut) return
    this.#timedOut = this.#governor.observeDeadline(this.#context)
  }

  /** Teardown removes the exact callback installed on the actual provider signal. */
  #unsubscribeAbort = (): void => {
    this.#context.signal.removeEventListener('abort', this.#onAbort)
  }

  /** Late or repeated provider settlement cannot decrement activity or reset policy twice. */
  readonly settle = (succeeded: boolean): void => {
    if (this.#settled) return
    this.#settled = true
    this.#unsubscribeAbort()
    this.#governor.finishActivity(this.#context, succeeded, this.#unsubscribeAbort)
  }
}
