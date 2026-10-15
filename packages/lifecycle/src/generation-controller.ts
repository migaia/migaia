import { defaultLifecycleScheduler } from './scheduler.js'
import { attachLifecycleSecondaryErrors } from './error-boundary.js'
import { safeReport } from './errors.js'
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  containAsyncRejection,
  createLifecycleError,
  createLifecycleFailure,
  createLifecycleTypeError,
  tagLifecycleError,
  type ILifecycleError
} from './errors.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import { type IAbortController } from './abort.js'
import { captureAbortControllerFactory, createLazyAbortController } from './abort-factory.js'
import {
  observeAbortSubscription,
  type IObservedAbortSubscription
} from './observed-subscription.js'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { resolveSchedulerOption, validateSchedulerDelay } from './scheduler.js'

export type IGenerationToken = object

/** Tracks one parent-abort listener from registration through both normal and admission cleanup. */
type IParentListenerRegistration = IObservedAbortSubscription

export type IGenerationRequest = {
  readonly generation: number
  readonly token: IGenerationToken
  readonly signal: IAbortSignal
}

export type IGenerationControllerOptions = {
  /** When this aborts, the currently-active generation's `signal` aborts too (L-T31). */
  readonly parentSignal?: IAbortSignal
  /**
   * Diagnostic channel fired from `adopt()` whenever `token` is no longer current — before the
   * release attempt, regardless of whether it succeeds. The value is a
   * `GENERATION_SUPERSEDED`-tagged error used purely as a `(source, code)`-bearing carrier; this is
   * explicitly _not_ a failure signal (§4.10.2), just an observability hook for callers that want
   * to notice the race without treating it as an error.
   */
  readonly onSuperseded?: (info: ILifecycleError) => void
  /**
   * Uses a runtime-neutral scheduler for `begin({ timeoutMs })` timing. Defaults to
   * `systemScheduler`.
   */
  readonly scheduler?: IScheduler
  /**
   * Last-boundary reporter for failures that have no caller to receive them: an `adopt()` release
   * failure when that call passes no `onReleaseError`, and timer/parent cleanup failures raised by
   * an asynchronous `begin({ timeoutMs })` timeout. Its own throws and rejections are contained.
   * Without it those failures are dropped.
   */
  readonly report?: (error: unknown) => void
}

export type IGenerationController = {
  readonly generation: number
  readonly disposed: boolean
  /**
   * Starts a new generation, superseding whatever was active. Optionally auto-aborts after
   * `timeoutMs`.
   */
  begin(options?: { readonly timeoutMs?: number }): IGenerationRequest
  isCurrent(token: IGenerationToken): boolean
  /**
   * Releases the matching current token's timer and parent subscription without aborting its
   * signal. Returns false for stale/disposed tokens; cleanup failures retain cancellation codes and
   * causes after invalidating the token.
   */
  complete(token: IGenerationToken): boolean
  /**
   * Invalidates the current generation without disposing the controller — a later `begin()` still
   * works.
   */
  supersede(reason?: unknown): void
  /**
   * Adopts `value` under `token`'s generation. Returns `true` and keeps `value` with the caller if
   * that generation is still current. Otherwise releases `value` via `release` and returns `false`
   * (L-T6) — a release failure is funneled to `onReleaseError` (or the controller `report` when
   * omitted) and never mutates controller state, so it cannot poison whichever generation is
   * current now (L-T30).
   */
  adopt<T>(
    token: IGenerationToken,
    value: T,
    release: (value: T) => void | PromiseLike<void>,
    onReleaseError?: (error: unknown) => void
  ): boolean
  dispose(reason?: unknown): void
}

/**
 * Pushes one cleanup failure onto a collection list, flattening a lifecycle-built AggregateError so
 * each original failure object stays a direct entry. Builds the list only; attaching it to a
 * primary goes through `attachLifecycleSecondaryErrors`.
 */
function flattenCleanupFailure(target: unknown[], error: unknown): void {
  if (error instanceof AggregateError) {
    target.push(...error.errors)
    return
  }
  target.push(error)
}

/**
 * Attaches cleanup failures to a cancellation primary through the package's single attach entry
 * point; a fallback aggregate keeps the generation-cancellation code rather than the scope one.
 */
function attachCancellationErrors(primary: unknown, cleanupErrors: readonly unknown[]): unknown {
  return attachLifecycleSecondaryErrors(
    primary,
    cleanupErrors,
    LifecycleErrorText.generationCancellationFailed,
    LifecycleErrorCode.generationCancellationFailed
  )
}

/** Tags an admission primary failure and keeps any rollback failures independently reachable. */
function createAdmissionFailure(
  primary: unknown,
  cleanupErrors: readonly unknown[]
): ILifecycleError {
  const failure = createLifecycleFailure(
    LifecycleErrorCode.generationCancellationFailed,
    LifecycleErrorText.generationCancellationFailed,
    primary
  )
  return attachCancellationErrors(failure, cleanupErrors) as ILifecycleError
}

/**
 * Merges `@migaia/reactive`'s `RequestControllerImpl`+`GenerationController` with `web-rpc`'s
 * `OperationScope`: token identity, an `AbortSignal` per generation, an optional per-generation
 * timeout, and automatic abort when a parent's closing signal fires.
 */
export function createGenerationController(
  options: IGenerationControllerOptions = {}
): IGenerationController {
  const scheduler = resolveSchedulerOption(options, defaultLifecycleScheduler)
  const createController = captureAbortControllerFactory()
  const parentSignal = options.parentSignal
  /** Controller-level last-boundary reporter; see `IGenerationControllerOptions.report`. */
  const report = options.report
  let generation = 0
  let currentToken: IGenerationToken | undefined
  let currentController: IAbortController | undefined
  let currentParentRegistration: IParentListenerRegistration | undefined
  let currentTimer: IScheduledTask | undefined
  let disposed = false

  /** Invalidates current ownership before shared timer/parent cleanup, optionally aborting signal. */
  const releaseCurrent = (reason?: unknown, shouldAbort = true): void => {
    const errors: unknown[] = []
    const runCleanup = (cleanup: () => void): void => {
      try {
        cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    const timer = currentTimer
    currentTimer = undefined
    const parentRegistration = currentParentRegistration
    currentParentRegistration = undefined
    const controller = currentController
    currentController = undefined
    currentToken = undefined
    if (timer) runCleanup(() => timer.cancel())
    if (parentRegistration)
      runCleanup(() => {
        parentRegistration.unsubscribe()
        if (parentRegistration.failures.length === 1)
          throw createLifecycleFailure(
            LifecycleErrorCode.generationCancellationFailed,
            LifecycleErrorText.generationCancellationFailed,
            parentRegistration.failures[0]
          )
        if (parentRegistration.failures.length > 1) {
          throw attachCancellationErrors(
            createLifecycleFailure(
              LifecycleErrorCode.generationCancellationFailed,
              LifecycleErrorText.generationCancellationFailed,
              parentRegistration.failures[0]
            ),
            parentRegistration.failures.slice(1)
          )
        }
      })
    if (controller && shouldAbort) runCleanup(() => controller.abort(reason))
    if (errors.length === 1) {
      throw createLifecycleFailure(
        LifecycleErrorCode.generationCancellationFailed,
        LifecycleErrorText.generationCancellationFailed,
        errors[0]
      )
    }
    if (errors.length > 1) {
      throw tagLifecycleError(
        new AggregateError(errors, LifecycleErrorText.generationCancellationFailed),
        LifecycleErrorCode.generationCancellationFailed
      )
    }
  }

  /** Invalidates a parent-driven generation using the reason captured by the subscription. */
  const abortFromParent = (reason: unknown): void => releaseCurrent(reason)

  /** Rolls back a partially admitted generation and throws the original admission failure. */
  const rollbackAdmission = (
    primary: unknown,
    registration: IParentListenerRegistration | undefined
  ): never => {
    const cleanupErrors: unknown[] = []
    registration?.unsubscribe()
    const knownRegistrationFailures = registration?.failures.length ?? 0
    registration?.retryRegistrationCleanup()
    if (registration) {
      for (const failure of registration.failures.slice(knownRegistrationFailures)) {
        flattenCleanupFailure(cleanupErrors, failure)
      }
    }
    try {
      releaseCurrent(primary)
    } catch (error) {
      flattenCleanupFailure(cleanupErrors, error)
    }
    if (
      primary !== null &&
      (typeof primary === 'object' || typeof primary === 'function') &&
      (primary as { code?: unknown }).code === LifecycleErrorCode.invalidOption
    ) {
      // Preserve invalid-option native type and identity: the aggregate fallback for a frozen
      // primary is deliberately not thrown, so cleanup diagnostics attach only when possible.
      attachSecondaryErrors(primary, cleanupErrors)
      throw primary
    }
    throw createAdmissionFailure(primary, cleanupErrors)
  }

  /**
   * Routes an `adopt()` release failure to the per-call `onReleaseError`, else to the controller's
   * `report`. Either callback is the last boundary; its own failures are contained by
   * `safeReport`.
   */
  const reportReleaseError = (
    onReleaseError: ((error: unknown) => void) | undefined,
    error: unknown
  ): void => safeReport(onReleaseError ?? report, error)

  return {
    get generation() {
      return generation
    },
    get disposed() {
      return disposed
    },
    begin(beginOptions) {
      if (disposed) {
        throw createLifecycleError(
          LifecycleErrorCode.generationDisposed,
          LifecycleErrorText.generationDisposed
        )
      }
      let timeoutMs: number | undefined
      try {
        timeoutMs = beginOptions?.timeoutMs
      } catch (error) {
        throw createLifecycleTypeError(
          LifecycleErrorCode.invalidOption,
          LifecycleErrorText.generationTimeoutAccessorFailed,
          { cause: error, detail: { field: 'timeoutMs' } }
        )
      }
      if (timeoutMs !== undefined) validateSchedulerDelay(timeoutMs, 'timeoutMs')
      releaseCurrent(
        currentToken === undefined
          ? undefined
          : createLifecycleError(
              LifecycleErrorCode.generationSuperseded,
              LifecycleErrorText.generationSupersededReason
            )
      )
      generation++
      const token: IGenerationToken = {}
      /** Per-generation signal source, created on the first `request.signal` read (LC-P3). */
      const controller = createLazyAbortController(createController)
      currentToken = token
      currentController = controller
      // parent abort 与 timeout 都原子作废当前 token（AF-14）：作废 = 取消 timer + 移除 parent listener。
      let invalidatedByParent = false
      let admissionRegistration: IParentListenerRegistration | undefined
      try {
        if (parentSignal) {
          if (parentSignal.aborted) {
            // 已 abort 的 parent：本次 generation 立即失效，不建 timer、不建 listener。
            const reason = parentSignal.reason
            releaseCurrent(reason)
            invalidatedByParent = true
          } else {
            const registrationErrors: unknown[] = []
            const registration = observeAbortSubscription(parentSignal, abortFromParent, (error) =>
              registrationErrors.push(error)
            )
            admissionRegistration = registration
            currentParentRegistration = registration
            registration.retryRegistrationCleanup()
            if (registrationErrors.length > 0) {
              currentParentRegistration = undefined
              throw createAdmissionFailure(registrationErrors[0], registrationErrors.slice(1))
            }
            if (currentController === undefined || currentToken === undefined) {
              currentParentRegistration = undefined
              invalidatedByParent = true
            }
          }
        }
        if (!invalidatedByParent && timeoutMs !== undefined) {
          /** True while the injected scheduler is still executing synchronously. */
          let scheduling = true
          /** True when the timeout callback failed before the scheduler returned its task. */
          let callbackFailed = false
          /** Primary failure captured from synchronous timeout invalidation. */
          let callbackFailure: unknown
          let firedSynchronously = false
          let scheduled: IScheduledTask
          try {
            scheduled = scheduler.schedule(() => {
              firedSynchronously = scheduling
              try {
                releaseCurrent(
                  createLifecycleError(
                    LifecycleErrorCode.generationTimedOut,
                    LifecycleErrorText.generationTimedOutReason
                  )
                )
              } catch (error) {
                callbackFailed = true
                callbackFailure = error
                if (!scheduling) {
                  // A host timer has no caller stack to receive cleanup failures; hand them to the
                  // controller's reporter rather than throwing through setTimeout.
                  safeReport(report, error)
                }
              }
            }, timeoutMs)
          } catch (error) {
            scheduling = false
            if (callbackFailed) throw attachCancellationErrors(callbackFailure, [error])
            throw error
          }
          scheduling = false
          if (firedSynchronously) {
            const cancelErrors: unknown[] = []
            try {
              // The task was acquired even when the callback failed; cancellation is exactly once.
              scheduled.cancel()
            } catch (error) {
              flattenCleanupFailure(cancelErrors, error)
            }
            if (callbackFailed) throw attachCancellationErrors(callbackFailure, cancelErrors)
            if (cancelErrors.length > 0) throw cancelErrors[0]
          } else {
            currentTimer = scheduled
          }
        }
      } catch (error) {
        throw rollbackAdmission(error, admissionRegistration)
      }
      /** Generation number captured for this request; `generation` keeps advancing afterwards. */
      const requestGeneration = generation
      return {
        generation: requestGeneration,
        token,
        get signal() {
          return controller.signal
        }
      }
    },
    isCurrent(token) {
      return !disposed && currentToken === token
    },
    /** Completes only the admitted current token; successful release never aborts its signal. */
    complete(token) {
      if (disposed || currentToken !== token) return false
      releaseCurrent(undefined, false)
      return true
    },
    supersede(reason) {
      if (disposed) return
      generation++
      releaseCurrent(reason)
    },
    adopt(token, value, release, onReleaseError) {
      if (!disposed && currentToken === token) return true
      if (options.onSuperseded) {
        try {
          options.onSuperseded(
            createLifecycleError(
              LifecycleErrorCode.generationSuperseded,
              LifecycleErrorText.generationSupersededBeforeAdopt
            )
          )
        } catch {
          // The diagnostic callback is the last boundary for its own synchronous failures.
        }
      }
      let result: void | PromiseLike<void>
      try {
        result = release(value)
      } catch (error) {
        reportReleaseError(onReleaseError, error)
        return false
      }
      containAsyncRejection(result, (error) => reportReleaseError(onReleaseError, error))
      return false
    },
    dispose(reason) {
      if (disposed) return
      disposed = true
      generation++
      releaseCurrent(reason)
    }
  }
}
