import { toError, attachErrorIdentity, IdentifyError } from './error.js'
import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'

/** Presence stays distinct from absence even when the present value itself is undefined. */
export type IMaybe<T> = { readonly some: true; readonly value: T } | { readonly some: false }

/** Narrows an optional value to its present branch without inspecting or copying its payload. */
export function isSome<T>(value: IMaybe<T>): value is Extract<IMaybe<T>, { readonly some: true }> {
  return value.some
}

/** Narrows an optional value to absence without interpreting falsy payloads as missing. */
export function isNone<T>(value: IMaybe<T>): value is Extract<IMaybe<T>, { readonly some: false }> {
  return !value.some
}

/** Returns the present payload unchanged, using the same-domain fallback only for absence. */
export function unwrapOr<T>(value: IMaybe<T>, fallback: NoInfer<T>): T {
  return value.some ? value.value : fallback
}

/**
 * Maps a present payload once; absence preserves identity and a result is neither copied nor
 * awaited.
 */
export function mapMaybe<T, N>(value: IMaybe<T>, mapper: (value: T) => N): IMaybe<N> {
  if (!value.some) return value
  try {
    return { some: true, value: mapper(value.value) }
  } catch (cause) {
    /** Existing coded failures and arbitrary thrown values follow the canonical utils normalization. */
    const failure = toError(cause)
    if (IdentifyError.identityOf(failure)) throw failure
    /**
     * Identity is attached to mutable native errors; frozen/conflicting targets retain the original
     * cause.
     */
    const identity = { source: '@migaia/utils', code: UtilsErrorCode.invalidArgument }
    throw attachErrorIdentity(failure, identity, {
      onConflict: ({ target }) =>
        attachErrorIdentity(
          new Error(UtilsErrorText.maybeMapperFailed, { cause: target }),
          identity
        ),
      onFailure: ({ target, cause: attachmentFailure }) =>
        attachErrorIdentity(
          new AggregateError([target, attachmentFailure], UtilsErrorText.maybeMapperFailed),
          identity
        )
    })
  }
}

/** Converts presence to its exact payload, deliberately collapsing absence and present undefined. */
export function toUndefined<T>(value: IMaybe<T>): T | undefined {
  return value.some ? value.value : undefined
}
