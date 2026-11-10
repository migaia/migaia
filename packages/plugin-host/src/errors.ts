import type { IPluginHostErrorCode } from './error-code.ts'
import type { IPluginHostErrorDetail } from './error-types.ts'
import { PLUGIN_HOST_SOURCE, PluginHostErrorCode } from './error-code.ts'
import { readHostIdentity } from './host-identity-authority.ts'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  isNativeErrorValue,
  tryReadProperty
} from '@migaia/utils/error'
import ERROR_TEXT, { PLUGIN_HOST_PREFIX } from './error-text.ts'

/**
 * Package semantic failure with a stable code, optional structured detail and native cause chain.
 * Use code/source for classification; detail describes the operation without replacing its cause.
 * Installation and cleanup producers retain original failures through cause or error collections.
 */
export class PluginHostError<TDetail = IPluginHostErrorDetail> extends Error {
  /** The `source` component of `(source, code)`, always `'plugin.host'`. */
  readonly source: string
  /** Stable scenario code from PluginHostErrorCode, independent of the human-readable message. */
  readonly code: IPluginHostErrorCode
  /**
   * Structured diagnostics, such as queue timeout `owner` and `waitedMs`, kept separate from
   * `cause`.
   */
  readonly detail?: TDetail
  /** Constructs a semantic error without rewriting the original error carried by options.cause. */
  constructor(
    code: IPluginHostErrorCode,
    message: string,
    options?: ErrorOptions & {
      /** Optional producer-owned diagnostic payload, retained by identity rather than copied. */
      readonly detail?: TDetail
    }
  ) {
    super(message, options)
    this.name = 'PluginHostError'
    this.source = PLUGIN_HOST_SOURCE
    this.code = code
    if (options?.detail !== undefined) this.detail = options.detail
  }
}

/** Adds the issuing Host identity to a package error without replacing its detail object. */
export function attachPluginHostIdentity<TError extends PluginHostError>(
  error: TError,
  target: object
): TError {
  const identity = readHostIdentity(target)
  if (!identity) return error
  if (error.detail === undefined) {
    Object.defineProperty(error, 'detail', {
      value: { host: identity },
      enumerable: true,
      configurable: true
    })
    return error
  }
  if (
    error.detail !== null &&
    (typeof error.detail === 'object' || typeof error.detail === 'function') &&
    Object.isExtensible(error.detail) &&
    !Object.hasOwn(error.detail, 'host')
  )
    Object.defineProperty(error.detail, 'host', { value: identity, enumerable: true })
  return error
}

/** Prefixes one diagnostic with the identity issued for its exact Host target. */
export function formatPluginHostDiagnostic(target: object, message: string): string {
  const identity = readHostIdentity(target)
  if (!identity) return message
  const body = message.startsWith(PLUGIN_HOST_PREFIX)
    ? message.slice(PLUGIN_HOST_PREFIX.length)
    : message
  return `[plugin-host:${identity.id}] ${body}`
}

/**
 * Gives unclassified callback failures a Host identity while retaining existing owners and native
 * errors.
 */
export function identifyPluginHostCallbackFailure(error: unknown): Error {
  if (isNativeErrorValue(error)) {
    /** A complete semantic identity remains owned by the originating package. */
    const source = tryReadProperty(error as { source?: unknown }, 'source')
    /** Native host codes without a source are not a package semantic identity. */
    const code = tryReadProperty(error as { code?: unknown }, 'code')
    if (
      !source.threw &&
      !code.threw &&
      typeof source.value === 'string' &&
      source.value.length > 0 &&
      typeof code.value === 'string' &&
      code.value.length > 0
    )
      return error
    try {
      return attachErrorIdentity(error, {
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.callbackFailed
      })
    } catch (attachmentError) {
      /** Immutable/conflicting errors retain their original stack and identity through cause. */
      const wrapper = new PluginHostError(
        PluginHostErrorCode.callbackFailed,
        ERROR_TEXT.CALLBACK_FAILED,
        { cause: error }
      )
      return attachSecondaryErrors(wrapper, [attachmentError]) as Error
    }
  }
  return new PluginHostError(PluginHostErrorCode.callbackFailed, ERROR_TEXT.CALLBACK_FAILED, {
    cause: error
  })
}

/**
 * `Array.isArray` for caller input at an admission boundary. A revoked Proxy makes the check throw;
 * that native `TypeError` gets the package source and `code` attached so it never leaves uncoded.
 */
export function isArrayInput(value: unknown, code: IPluginHostErrorCode): boolean {
  try {
    return Array.isArray(value)
  } catch (error) {
    // Only a revoked Proxy throws here, and it throws a fresh native TypeError.
    throw attachErrorIdentity(error as TypeError, { source: PLUGIN_HOST_SOURCE, code })
  }
}
