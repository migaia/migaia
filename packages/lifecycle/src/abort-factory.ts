import type { IAbortController } from './abort.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { createLifecycleError } from './errors.js'

type IHostAbortControllerConstructor = new () => IAbortController

/** Reads and validates the host constructor only at an explicit lifecycle boundary. */
const resolveHostConstructor = (): IHostAbortControllerConstructor => {
  let candidate: unknown
  try {
    candidate = (globalThis as { AbortController?: unknown }).AbortController
  } catch (error) {
    throw createLifecycleError(
      LifecycleErrorCode.envUnsupported,
      LifecycleErrorText.envUnsupported,
      {
        cause: error,
        detail: { capability: 'AbortController' }
      }
    )
  }
  if (typeof candidate !== 'function') {
    throw createLifecycleError(
      LifecycleErrorCode.envUnsupported,
      LifecycleErrorText.envUnsupported,
      {
        detail: { capability: 'AbortController' }
      }
    )
  }
  return candidate as IHostAbortControllerConstructor
}

/** Validates the minimum native controller and signal shape without wrapping the instance. */
const validateHostController = (candidate: unknown): IAbortController => {
  try {
    if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
      throw new TypeError(LifecycleErrorText.envUnsupported)
    }
    const controller = candidate as IAbortController
    const signal = controller.signal
    if (
      signal === null ||
      typeof signal !== 'object' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function' ||
      typeof signal.aborted !== 'boolean' ||
      typeof controller.abort !== 'function'
    ) {
      throw new TypeError(LifecycleErrorText.envUnsupported)
    }
    return controller
  } catch (error) {
    throw createLifecycleError(
      LifecycleErrorCode.envUnsupported,
      LifecycleErrorText.envUnsupported,
      {
        cause: error,
        detail: { capability: 'AbortController' }
      }
    )
  }
}

/**
 * Host constructors whose first instance already passed `validateHostController`. Native
 * constructors produce one fixed instance shape, so later instances skip the five-property check.
 */
const validatedConstructors = new WeakSet<IHostAbortControllerConstructor>()

/** Instantiates one controller, validating its shape only for the constructor's first instance. */
const instantiate = (constructor: IHostAbortControllerConstructor): IAbortController => {
  try {
    if (validatedConstructors.has(constructor)) return new constructor()
    const controller = validateHostController(new constructor())
    validatedConstructors.add(constructor)
    return controller
  } catch (error) {
    if (
      error instanceof Error &&
      (error as { readonly source?: unknown }).source === '@migaia/lifecycle' &&
      typeof (error as { readonly code?: unknown }).code === 'string'
    )
      throw error
    throw createLifecycleError(
      LifecycleErrorCode.envUnsupported,
      LifecycleErrorText.envUnsupported,
      {
        cause: error,
        detail: { capability: 'AbortController' }
      }
    )
  }
}

/** Captures one validated constructor so a long-lived owner cannot drift across realms. */
export const captureAbortControllerFactory = (): (() => IAbortController) => {
  const constructor = resolveHostConstructor()
  return () => instantiate(constructor)
}

/** Creates one controller using the current host realm at call time. */
export const instantiateCurrentAbortController = (): IAbortController =>
  instantiate(resolveHostConstructor())

/**
 * Defers controller creation until `signal` is first read, for owners whose signal is often never
 * observed (a `LifecycleUnit` generation, a scope disposed with nothing owned). An `abort(reason)`
 * before that read only records the first reason; the first `signal` read then creates the
 * controller and aborts it with that reason, so the already-aborted state is preserved. After
 * materialization every call forwards to the real controller, including its failures. A creation
 * failure (`ENV_UNSUPPORTED`) surfaces at the first `signal` read.
 */
export const createLazyAbortController = (create: () => IAbortController): IAbortController => {
  /** Real controller, created on the first `signal` read. */
  let controller: IAbortController | undefined
  /** Whether `abort()` ran before the controller existed. */
  let abortedEarly = false
  /** First reason recorded by an early `abort()`, replayed on materialization. */
  let earlyReason: unknown
  return {
    get signal() {
      if (controller === undefined) {
        controller = create()
        if (abortedEarly) controller.abort(earlyReason)
      }
      return controller.signal
    },
    abort(reason) {
      if (controller !== undefined) {
        controller.abort(reason)
        return
      }
      if (abortedEarly) return
      abortedEarly = true
      earlyReason = reason
    }
  }
}
