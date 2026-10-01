import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { portableBytes } from '../../core/idempotency-store.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import type { IRpcProviderRejection } from '../../core/provider-admission.js'
import { RpcProviderRejectionReason } from '../../core/semantic-constants.js'
import { RpcTimeoutError } from '../../core/errors.js'
import type {
  IRpcContext,
  IRpcEndpoint,
  IRpcProvider,
  IRpcProviderResult
} from '../../core/typing.js'
import type { IRpcPortableValue } from '../../contract/types.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../remote/types.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import type { IRequiredProcessResilienceOptions } from './session.js'

/** One minute is measured by the injected monotonic scheduler, never wall time. */
const RATE_WINDOW_MS = 60_000

/** A service connection owns its quota counters and frame observer until it closes. */
export type IProcessProviderAdmission = Readonly<{
  /** Attach the canonical local core refusal notification before endpoint construction. */
  limits(
    limits: import('../../core/typing.js').IRpcProviderLimits
  ): import('../../core/typing.js').IRpcProviderLimits
  wrap(endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
  close(): void
}>

/** Enforce per-connection rate, payload, and idle limits at the provider boundary. */
export function createProcessProviderAdmission(
  channel: IRemoteChannel,
  options: IRequiredProcessResilienceOptions,
  scheduler: IScheduler,
  closeSession: () => Promise<void>,
  report: (error: unknown) => void
): IProcessProviderAdmission {
  /** A window starts with its first admitted request, not at process startup. */
  let windowStart = scheduler.now()
  let callsInWindow = 0
  let violations = 0
  let consecutiveTimeouts = 0
  let active = 0
  let lastInboundAt = scheduler.now()
  let closed = false
  let idleTimer: IScheduledTask | undefined
  /** Admission owns its abort subscriptions even when business work never settles. */
  const abortSubscriptions = new Set<() => void>()

  /** A close triggered by policy remains secondary to the provider's primary result. */
  const requestClose = (): void => {
    void closeSession().catch(report)
  }

  /** Only a quiet connection with no provider work is idle. */
  const scheduleIdle = (): void => {
    idleTimer?.cancel()
    if (closed || active > 0) return
    idleTimer = scheduler.schedule(
      () => {
        idleTimer = undefined
        if (closed || active > 0) return
        if (scheduler.now() - lastInboundAt >= options.idleTimeoutMs) requestClose()
        else scheduleIdle()
      },
      Math.max(0, lastInboundAt + options.idleTimeoutMs - scheduler.now())
    )
    idleTimer.unref?.()
  }

  /** Observing after endpoint construction leaves channel's early-frame buffer to core. */
  const unsubscribe = channel.transport.subscribe(() => {
    lastInboundAt = scheduler.now()
    scheduleIdle()
  })
  scheduleIdle()

  /** Both rate/payload and core concurrency refusals share this connection's consecutive count. */
  const violate = (): void => {
    violations += 1
    if (violations >= 2) queueMicrotask(requestClose)
  }

  /** Reject before invoking a provider; the second consecutive violation closes this session. */
  const admit = (context: IRpcContext): void => {
    const now = scheduler.now()
    if (now - windowStart >= RATE_WINDOW_MS) {
      windowStart = now
      callsInWindow = 0
    }
    if (
      callsInWindow >= options.maxCallsPerMinute ||
      portableBytes(context.data as IRpcPortableValue) > options.maxPayloadBytes
    ) {
      violate()
      throw createProcessError(RpcProcessErrorCode.connectionLimit)
    }
    callsInWindow += 1
  }

  /** Observe deadlines at abort time; settlement only releases activity and resets successful work. */
  const track = (context: IRpcContext): ((succeeded: boolean) => void) => {
    /** One operation contributes at most one deadline, including after a late settlement. */
    let timedOut = false
    /** Provider callbacks and stream finally blocks both retire this activity once. */
    let settled = false
    active += 1
    idleTimer?.cancel()
    idleTimer = undefined
    /** The core deadline owner creates this local timeout instance; remote payloads cannot do so. */
    const onAbort = (): void => {
      if (closed || timedOut) return
      /** This guarded read preserves the core-owned cancellation reason. */
      const reason = resolveAbortReason(context.signal)
      if (!(reason instanceof RpcTimeoutError)) return
      timedOut = true
      consecutiveTimeouts += 1
      if (consecutiveTimeouts === options.maxConsecutiveTimeouts) queueMicrotask(requestClose)
    }
    /** Releasing admission removes listeners even from providers that ignore cancellation. */
    const unsubscribeAbort = (): void => context.signal.removeEventListener('abort', onAbort)
    context.signal.addEventListener('abort', onAbort, { once: true })
    abortSubscriptions.add(unsubscribeAbort)
    if (context.signal.aborted) onAbort()
    return (succeeded) => {
      if (settled) return
      settled = true
      unsubscribeAbort()
      abortSubscriptions.delete(unsubscribeAbort)
      if (!closed && succeeded && !context.signal.aborted) {
        consecutiveTimeouts = 0
        violations = 0
      }
      active -= 1
      scheduleIdle()
    }
  }

  /** Preserve the provider's native result and Promise identity while tracking its activity. */
  const guarded =
    (provider: IRpcProvider): IRpcProvider =>
    (context) => {
      admit(context)
      /** The deadline subscription preserves the provider's returned Promise identity. */
      const settle = track(context)
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

  return Object.freeze({
    /** Preserve the caller's limits and observer while linking canonical concurrency refusals. */
    limits(limits) {
      return Object.freeze({
        ...limits,
        /** Only local concurrency refusal joins the connection's consecutive violation count. */
        onRejected(rejection: IRpcProviderRejection) {
          if (rejection.reason === RpcProviderRejectionReason.concurrency) violate()
          return limits.onRejected?.(rejection)
        }
      })
    },
    wrap(endpoint) {
      /** The admission view shadows only provider registration on the frozen core endpoint. */
      const guardedEndpoint: IRpcEndpoint = Object.create(endpoint.endpoint)
      Object.defineProperty(guardedEndpoint, 'provide', {
        value: (method: string, provider: IRpcProvider) => {
          endpoint.endpoint.provide(method, guarded(provider))
          return guardedEndpoint
        }
      })
      Object.freeze(guardedEndpoint)
      const stream = endpoint.stream
        ? Object.freeze({
            ...endpoint.stream,
            provide: (
              method: string,
              run: Parameters<NonNullable<IRemoteServeEndpoint['stream']>['provide']>[1]
            ) =>
              endpoint.stream!.provide(method, (params, streamContext) =>
                (async function* () {
                  const context = streamContext.context
                  admit(context)
                  /** Stream cancellation uses the same single deadline observer as requests. */
                  const settle = track(context)
                  let succeeded = false
                  try {
                    yield* run(params, streamContext)
                    succeeded = true
                  } finally {
                    settle(succeeded)
                  }
                })()
              )
          })
        : undefined
      return Object.freeze({
        ...endpoint,
        endpoint: guardedEndpoint,
        ...(stream ? { stream } : {})
      })
    },
    close(): void {
      if (closed) return
      closed = true
      idleTimer?.cancel()
      for (const unsubscribeAbort of abortSubscriptions) unsubscribeAbort()
      abortSubscriptions.clear()
      unsubscribe()
    }
  })
}
