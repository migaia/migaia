import { PLUGIN_HOST_SOURCE } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import { invokeCaptured } from './invocation.ts'
import ERROR_TEXT from './error-text.ts'
import { PluginHostError } from './errors.ts'
import { PluginHostErrorCode } from './error-code.ts'
/** Owns the explicit expose receiver and revocation check for one captured Feature method. */
class FeatureExposeInvocation {
  /** Original admitted expose surface remains the callable receiver. */
  readonly #receiver: object
  /** Captured data descriptor value is never re-read from the input object. */
  readonly #value: Function
  /** Registration owner decides when the exposed capability is revoked. */
  readonly #isValid: () => boolean

  /** Captures one method without transferring lifecycle ownership. */
  constructor(receiver: object, value: Function, isValid: () => boolean) {
    this.#receiver = receiver
    this.#value = value
    this.#isValid = isValid
  }

  /** Checks revocation synchronously and forwards the original receiver and arguments. */
  invoke(args: unknown[]): unknown {
    /** Preserve the original standalone predicate receiver. */
    const isValid = this.#isValid
    if (!isValid())
      throw new PluginHostError(
        PluginHostErrorCode.registrationRevoked,
        ERROR_TEXT.REGISTRATION_REVOKED
      )
    return invokeCaptured(this.#value, this.#receiver, args)
  }
}

/** Copies explicit expose methods into a registration-owned immutable facade. */
export const snapshotFeatureExpose = (value: object, isValid: () => boolean): object => {
  /** Null-prototype output owns only explicitly admitted enumerable callable descriptors. */
  const snapshot: Record<PropertyKey, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string')
      throw attachErrorIdentity(new TypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_DATA), {
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.invalidOption
      })
    /** Own-data admission avoids executing accessors while capturing the public facade. */
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !descriptor.enumerable ||
      typeof descriptor.value !== 'function'
    )
      throw attachErrorIdentity(new TypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_DATA), {
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.invalidOption
      })
    /** Invocation state belongs to one explicit owner rather than the descriptor-building loop. */
    const owner = new FeatureExposeInvocation(value, descriptor.value, isValid)
    Object.defineProperty(snapshot, key, {
      value: (...args: unknown[]) => owner.invoke(args),
      enumerable: true,
      configurable: false,
      writable: false
    })
  }
  return Object.freeze(snapshot)
}
