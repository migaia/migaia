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
import { createAbortController, type IAbortController, type IAbortSignal } from './abort.js'
import {
  resolveSchedulerOption,
  systemScheduler,
  validateSchedulerDelay,
  type ILifecycleScheduler,
  type IScheduledTask
} from './scheduler.js'

export type IGenerationToken = object

/** Tracks one parent-abort listener from registration through both normal and admission cleanup. */
type IParentListenerRegistration = {
  readonly signal: IAbortSignal
  readonly listener: () => void
  removed: boolean
  cleanupFailed: boolean
  registrationReturned: boolean
  parentAbortCheckCompleted: boolean
  parentAbortDetected: boolean
  postRegistrationCleanupAttempted: boolean
}

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
  /** Runtime-neutral scheduler（默认 `systemScheduler`）；`begin({ timeoutMs })` 的超时计时经它。 */
  readonly scheduler?: ILifecycleScheduler
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
   * Invalidates the current generation without disposing the controller — a later `begin()` still
   * works.
   */
  supersede(reason?: unknown): void
  /**
   * Adopts `value` under `token`'s generation. Returns `true` and keeps `value` with the caller if
   * that generation is still current. Otherwise releases `value` via `release` and returns `false`
   * (L-T6) — a release failure is funneled to `onReleaseError` and never mutates controller state,
   * so it cannot poison whichever generation is current now (L-T30).
   */
  adopt<T>(
    token: IGenerationToken,
    value: T,
    release: (value: T) => void | PromiseLike<void>,
    onReleaseError?: (error: unknown) => void
  ): boolean
  dispose(reason?: unknown): void
}

/** Appends cleanup failures while preserving each original failure object. */
function appendCleanupErrors(target: unknown[], error: unknown): void {
  if (error instanceof AggregateError) {
    target.push(...error.errors)
    return
  }
  target.push(error)
}

/** Appends secondary failures without replacing the primary cancellation failure or its order. */
function appendFailureErrors(primary: unknown, cleanupErrors: readonly unknown[]): unknown {
  if (cleanupErrors.length === 0) return primary
  /** Previously attached secondary failures that must remain ahead of later cleanup failures. */
  const existingErrors =
    primary instanceof Error && Array.isArray((primary as ILifecycleError).errors)
      ? [...((primary as ILifecycleError).errors ?? [])]
      : []
  /** Complete ordered secondary-failure list, excluding a duplicate primary object. */
  const combinedErrors = [...existingErrors, ...cleanupErrors.filter((error) => error !== primary)]
  if (combinedErrors.length === 0) return primary
  if (primary instanceof Error) {
    try {
      Object.defineProperty(primary, 'errors', {
        value: Object.freeze(combinedErrors),
        enumerable: true,
        configurable: true
      })
      return primary
    } catch {
      // Frozen or non-configurable errors require a wrapper; keep primary reachable through cause.
    }
  }
  return createLifecycleError(
    LifecycleErrorCode.generationCancellationFailed,
    LifecycleErrorText.generationCancellationFailed,
    { cause: primary, errors: combinedErrors }
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
  return appendFailureErrors(failure, cleanupErrors) as ILifecycleError
}

/**
 * Merges `@migaia/reactive`'s `RequestControllerImpl`+`GenerationController` with `web-rpc`'s
 * `OperationScope`: token identity, an `AbortSignal` per generation, an optional per-generation
 * timeout, and automatic abort when a parent's closing signal fires.
 */
export function createGenerationController(
  options: IGenerationControllerOptions = {}
): IGenerationController {
  const scheduler = resolveSchedulerOption(options, systemScheduler)
  const parentSignal = options.parentSignal
  let generation = 0
  let currentToken: IGenerationToken | undefined
  let currentController: IAbortController | undefined
  let currentParentRegistration: IParentListenerRegistration | undefined
  let currentTimer: IScheduledTask | undefined
  let disposed = false

  /** Removes a parent listener once during normal cleanup, or forcibly after registration returns. */
  const removeParentListener = (
    registration: IParentListenerRegistration,
    force: boolean
  ): void => {
    if (force) {
      if (registration.postRegistrationCleanupAttempted) return
      registration.postRegistrationCleanupAttempted = true
    } else if (registration.removed) {
      return
    }
    registration.removed = true
    try {
      registration.signal.removeEventListener('abort', registration.listener)
    } catch (error) {
      registration.cleanupFailed = true
      throw error
    }
  }

  const abortCurrent = (reason?: unknown): void => {
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
    if (parentRegistration) runCleanup(() => removeParentListener(parentRegistration, false))
    if (controller) runCleanup(() => controller.abort(reason))
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

  /** Invalidates a parent-driven generation even when reading its reason fails. */
  const abortFromParent = (): void => {
    let reason: unknown
    try {
      reason = parentSignal?.reason
    } catch (error) {
      const cleanupErrors: unknown[] = []
      try {
        abortCurrent(error)
      } catch (cleanupError) {
        appendCleanupErrors(cleanupErrors, cleanupError)
      }
      throw createAdmissionFailure(error, cleanupErrors)
    }
    abortCurrent(reason)
  }

  /** Rolls back a partially admitted generation and throws the original admission failure. */
  const rollbackAdmission = (
    primary: unknown,
    registration: IParentListenerRegistration | undefined
  ): never => {
    const cleanupErrors: unknown[] = []
    if (
      registration &&
      !registration.postRegistrationCleanupAttempted &&
      (registration.cleanupFailed ||
        !registration.registrationReturned ||
        !registration.parentAbortCheckCompleted ||
        registration.parentAbortDetected)
    ) {
      try {
        // A hostile signal can register its listener after synchronously invoking it; force a
        // second remove after addEventListener returns to cover that window.
        removeParentListener(registration, true)
      } catch (error) {
        appendCleanupErrors(cleanupErrors, error)
      }
    }
    try {
      abortCurrent(primary)
    } catch (error) {
      appendCleanupErrors(cleanupErrors, error)
    }
    if (
      primary !== null &&
      (typeof primary === 'object' || typeof primary === 'function') &&
      (primary as { code?: unknown }).code === LifecycleErrorCode.invalidOption
    ) {
      if (cleanupErrors.length > 0) {
        try {
          Object.defineProperty(primary, 'errors', {
            value: Object.freeze([...cleanupErrors]),
            enumerable: true
          })
        } catch {
          // Preserve invalid-option native type and identity even when cleanup diagnostics cannot attach.
        }
      }
      throw primary
    }
    throw createAdmissionFailure(primary, cleanupErrors)
  }

  const reportReleaseError = (
    onReleaseError: ((error: unknown) => void) | undefined,
    error: unknown
  ): void => {
    if (!onReleaseError) return
    try {
      onReleaseError(error)
    } catch {
      // The release-error callback is itself the last boundary; it must not manufacture a new
      // unhandled failure by throwing back out.
    }
  }

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
          '[lifecycle] cannot begin a new generation on a disposed GenerationController'
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
      abortCurrent('superseded by a new generation')
      generation++
      const token: IGenerationToken = {}
      const controller = createAbortController()
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
            abortCurrent(reason)
            invalidatedByParent = true
          } else {
            const listener = (): void => abortFromParent()
            const registration: IParentListenerRegistration = {
              signal: parentSignal,
              listener,
              removed: false,
              cleanupFailed: false,
              registrationReturned: false,
              parentAbortCheckCompleted: false,
              parentAbortDetected: false,
              postRegistrationCleanupAttempted: false
            }
            admissionRegistration = registration
            currentParentRegistration = registration
            parentSignal.addEventListener('abort', listener, { once: true })
            registration.registrationReturned = true
            const parentAborted = parentSignal.aborted
            registration.parentAbortCheckCompleted = true
            registration.parentAbortDetected = parentAborted
            if (parentAborted) {
              // Registration may synchronously race with abort and leave a residual listener after
              // invoking `listener`; force removal after the host call has fully returned.
              const reason = parentSignal.reason
              abortCurrent(reason)
              removeParentListener(registration, true)
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
                abortCurrent('generation timed out')
              } catch (error) {
                if (!scheduling) throw error
                callbackFailed = true
                callbackFailure = error
              }
            }, timeoutMs)
          } catch (error) {
            scheduling = false
            if (callbackFailed) throw appendFailureErrors(callbackFailure, [error])
            throw error
          }
          scheduling = false
          if (firedSynchronously) {
            const cancelErrors: unknown[] = []
            try {
              // The task was acquired even when the callback failed; cancellation is exactly once.
              scheduled.cancel()
            } catch (error) {
              appendCleanupErrors(cancelErrors, error)
            }
            if (callbackFailed) throw appendFailureErrors(callbackFailure, cancelErrors)
            if (cancelErrors.length > 0) throw cancelErrors[0]
          } else {
            currentTimer = scheduled
          }
        }
      } catch (error) {
        throw rollbackAdmission(error, admissionRegistration)
      }
      return { generation, token, signal: controller.signal }
    },
    isCurrent(token) {
      return !disposed && currentToken === token
    },
    supersede(reason) {
      if (disposed) return
      generation++
      abortCurrent(reason)
    },
    adopt(token, value, release, onReleaseError) {
      if (!disposed && currentToken === token) return true
      if (options.onSuperseded) {
        try {
          options.onSuperseded(
            createLifecycleError(
              LifecycleErrorCode.generationSuperseded,
              '[lifecycle] generation superseded before its result could be adopted'
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
      abortCurrent(reason)
    }
  }
}
