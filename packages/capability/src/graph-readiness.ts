import { CapabilityErrorCode } from './error-code.js'
import { CapabilityErrorText } from './error-text.js'
import { createCapabilityError, tagCapabilityError } from './errors.js'
import { isNativeErrorValue } from '@migaia/utils/error'

/** Read-only Host boundary consumed once during Graph admission. */
export type ICapabilityReadinessSource = {
  /** Availability to capture; only ready, blocked, or failed is admitted. */
  readonly state: unknown
  /** Paired diagnostic read after valid state; retained by reference without interpretation. */
  readonly error: unknown | undefined
}

/** Graph availability states admitted by the readiness snapshot contract. */
export const GraphReadinessState = {
  /** Admission may proceed using the current readiness snapshot. */
  ready: 'ready',
  /** Admission is unavailable without declaring a terminal startup failure. */
  blocked: 'blocked',
  /** Admission failed; the paired snapshot error explains why. */
  failed: 'failed'
} as const

/** Admitted availability labels; independent of Host activation and Graph container states. */
export type GraphReadinessState = keyof typeof GraphReadinessState

/** Immutable, one-time readiness fact passed to Graph and direct consumers. */
export type IGraphReadinessSnapshot = {
  /** Availability at capture time; later changes to the source are not observed. */
  readonly state: GraphReadinessState
  /** Exact diagnostic captured with the state; undefined is allowed for any admitted state. */
  readonly error: unknown | undefined
}

/**
 * Captures readiness once in state-then-error order and freezes the two-field record; this does not
 * freeze its error payload or subscribe to source changes. Invalid state throws INVALID_OPTION
 * before error is read. Throwing getters retain native Error identity when annotatable; other
 * failures remain reachable through cause on a coded fallback.
 */
export function snapshotGraphReadiness(
  source: ICapabilityReadinessSource
): IGraphReadinessSnapshot {
  let state: unknown
  try {
    state = source.state
  } catch (error) {
    throw normalizeReadinessGetterFailure(error)
  }
  if (
    state !== GraphReadinessState.ready &&
    state !== GraphReadinessState.blocked &&
    state !== GraphReadinessState.failed
  ) {
    throw createCapabilityError(
      CapabilityErrorCode.invalidOption,
      CapabilityErrorText.invalidReadinessState
    )
  }
  let error: unknown | undefined
  try {
    error = source.error
  } catch (thrown) {
    throw normalizeReadinessGetterFailure(thrown)
  }
  return Object.freeze({ state, error })
}

/**
 * Preserves native Error identity while making non-Error boundary failures traceable through the
 * capability error contract.
 */
function normalizeReadinessGetterFailure(thrown: unknown): Error {
  if (isNativeErrorValue(thrown)) {
    try {
      return tagCapabilityError(thrown, CapabilityErrorCode.invalidOption)
    } catch {
      // Immutable or foreign-coded failures retain their original identity through the fallback cause.
    }
  }
  return createCapabilityError(
    CapabilityErrorCode.invalidOption,
    CapabilityErrorText.optionsSnapshotFailed,
    { cause: thrown }
  )
}
