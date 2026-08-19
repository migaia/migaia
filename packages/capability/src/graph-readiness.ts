import { CapabilityErrorCode } from './error-code.js';
import { CapabilityErrorText } from './error-text.js';
import { createCapabilityError } from './errors.js';

/** Read-only Host boundary consumed once during Graph admission. */
export type ICapabilityReadinessSource = {
  readonly state: unknown;
  readonly error: unknown | undefined;
};

/** Graph availability states admitted by the readiness snapshot contract. */
export type IGraphReadinessState = 'ready' | 'blocked' | 'failed';

/** Immutable, one-time readiness fact passed to Graph and direct consumers. */
export type IGraphReadinessSnapshot = {
  readonly state: IGraphReadinessState;
  readonly error: unknown | undefined;
};

/**
 * Reads Host readiness in fixed state-then-error order and freezes the result. Error instances
 * propagate unchanged; foreign thrown values are tagged with their original value as cause.
 */
export function snapshotGraphReadiness(
  source: ICapabilityReadinessSource
): IGraphReadinessSnapshot {
  let state: unknown;
  try {
    state = source.state;
  } catch (error) {
    throw normalizeReadinessGetterFailure(error);
  }
  if (state !== 'ready' && state !== 'blocked' && state !== 'failed') {
    throw createCapabilityError(
      CapabilityErrorCode.invalidOption,
      CapabilityErrorText.invalidReadinessState
    );
  }
  let error: unknown | undefined;
  try {
    error = source.error;
  } catch (thrown) {
    throw normalizeReadinessGetterFailure(thrown);
  }
  return Object.freeze({ state, error });
}

/**
 * Preserves native Error identity while making non-Error boundary failures traceable through the
 * capability error contract.
 */
function normalizeReadinessGetterFailure(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  return createCapabilityError(
    CapabilityErrorCode.invalidOption,
    CapabilityErrorText.optionsSnapshotFailed,
    { cause: thrown }
  );
}
