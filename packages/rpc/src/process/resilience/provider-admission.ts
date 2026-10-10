import {
  attachProviderBulkAdmission,
  retainProviderPreflight,
  wrapProviderStreamAdmission,
  type IProviderBulkAdmission
} from '../../core/internal/provider.js'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { portableBytes } from '../../core/idempotency-store.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import type { IRpcProviderRejection } from '../../core/index.js'
import { RpcProviderRejectionReason } from '../../core/index.js'
import { isRpcTimeoutError } from '../../core/spi.js'
import type {
  IRpcContext,
  IRpcEndpoint,
  IRpcProvider,
  IRpcProviderLimits,
  IRpcProviderResult
} from '../../core/index.js'
import type { IRpcPortableValue } from '../../contract/index.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../remote/index.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import type { IRequiredProcessResilienceOptions } from './session.js'

/** One minute is measured by the injected monotonic scheduler, never wall time. */
const RATE_WINDOW_MS = 60_000

/** A service connection owns its quota counters and frame observer until it closes. */
export type IProcessProviderAdmission = Readonly<{
  /** Attach the canonical local core refusal notification before endpoint construction. */
  limits(limits: IRpcProviderLimits, configured?: IRpcProviderLimits): IRpcProviderLimits
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

  /** Group reservations share these original counters, including ordinary concurrent calls. */
  const bulkAdmission: IProviderBulkAdmission = {
    reserveMany(payloads) {
      /** Advance the same original rate window before validating the entire member set. */
      const now = scheduler.now()
      if (now - windowStart >= RATE_WINDOW_MS) {
        windowStart = now
        callsInWindow = 0
      }
      if (
        callsInWindow + payloads.length > options.maxCallsPerMinute ||
        payloads.some(
          (payload) => portableBytes(payload as IRpcPortableValue) > options.maxPayloadBytes
        )
      ) {
        violate()
        throw createProcessError(RpcProcessErrorCode.connectionLimit)
      }
      callsInWindow += payloads.length
      /** Unexecuted members retain reserved credit until cancellation, refusal, or terminal. */
      let remaining = payloads.length
      /** Rollback cannot subtract unused credit from a subsequent minute's original bucket. */
      const reservedWindow = windowStart
      return {
        consume() {
          if (remaining > 0) remaining -= 1
        },
        release() {
          if (windowStart === reservedWindow) callsInWindow -= remaining
          remaining = 0
        }
      }
    }
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
      if (!isRpcTimeoutError(reason)) return
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
  const guarded = (provider: IRpcProvider): IRpcProvider => {
    /** Ordinary and prepaid invocation share the original activity/deadline tracking body. */
    const invoke: IRpcProvider = (context) => {
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
    return attachProviderBulkAdmission(
      retainProviderPreflight(provider, (context: IRpcContext) => {
        admit(context)
        return invoke(context)
      }),
      { admission: bulkAdmission, invoke }
    )
  }

  return Object.freeze({
    /** Preserve the caller's limits and observer while linking canonical concurrency refusals. */
    limits(limits, configured) {
      /** Keep valid caller limits within the original governor; invalid values reach core unchanged. */
      const maximum = (
        base: number | undefined,
        selected: number | undefined
      ): number | undefined =>
        selected === undefined
          ? base
          : base !== undefined && Number.isSafeInteger(selected) && selected > 0
            ? Math.min(base, selected)
            : selected
      /** Distinct original and selected observers retain their exact connection-level ownership. */
      const observers = [limits.onRejected, configured?.onRejected].filter(
        (observer, index, all) => observer !== undefined && all.indexOf(observer) === index
      )
      return Object.freeze({
        ...limits,
        ...configured,
        maxGlobal: maximum(limits.maxGlobal, configured?.maxGlobal),
        maxPerPeer: maximum(limits.maxPerPeer, configured?.maxPerPeer),
        /** Only local concurrency refusal joins the connection's consecutive violation count. */
        onRejected(rejection: IRpcProviderRejection) {
          if (rejection.reason === RpcProviderRejectionReason.concurrency) violate()
          if (observers.length < 2) return observers[0]?.(rejection)
          /** Every observer failure is reported without suppressing the other refusal observer. */
          return Promise.allSettled(
            observers.map((observer) => Promise.resolve().then(() => observer!(rejection)))
          ).then((outcomes) => {
            for (const outcome of outcomes)
              if (outcome.status === 'rejected') report(outcome.reason)
          })
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
              endpoint.stream!.provide(
                method,
                retainProviderPreflight(
                  run,
                  wrapProviderStreamAdmission(
                    run,
                    (params: unknown, streamContext: Parameters<typeof run>[1]) =>
                      (async function* () {
                        const context = streamContext.context
                        if (context.targetGeneration === undefined) admit(context)
                        /** Stream cancellation uses the same single deadline observer as requests. */
                        const settle =
                          context.targetGeneration === undefined ? track(context) : undefined
                        let succeeded = false
                        try {
                          /**
                           * Preserve the same iterator's actual terminal value through native
                           * policy.
                           */
                          const result = yield* run(params, streamContext)
                          succeeded = true
                          return context.targetGeneration === undefined ? undefined : result
                        } finally {
                          settle?.(succeeded)
                        }
                      })(),
                    (context) => {
                      admit(context)
                      return track(context)
                    }
                  )
                )
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
