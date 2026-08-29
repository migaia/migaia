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

/** Instantiates one validated controller from a captured host constructor. */
const instantiate = (constructor: IHostAbortControllerConstructor): IAbortController => {
  try {
    return validateHostController(new constructor())
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
