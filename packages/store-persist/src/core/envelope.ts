/**
 * Stores state with a schema `version` for `migrate()`.
 *
 * Codec routing already matches output formats to backend capabilities. Persistence does not
 * maintain separate text and byte locations for one key or resolve channel conflicts by revision.
 */
export type IEnvelope<TState> = {
  /** Nonnegative safe schema version used to choose whether migration is necessary. */
  version: number
  /**
   * Decoded archive payload; assertEnvelope rejects null and undefined but accepts other falsy
   * values.
   */
  state: TState
}

/**
 * Tagged TypeError for invalid archive shape/version/state, retaining reflective failures through
 * cause.
 */
export class PersistEnvelopeError extends TypeError {
  /** Preserves the invalid-envelope identity while keeping an original reflective failure reachable. */
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    Object.defineProperty(this, 'source', { value: STORE_PERSIST_SOURCE, enumerable: true })
    Object.defineProperty(this, 'code', {
      value: StorePersistErrorCode.envelopeInvalid,
      enumerable: true
    })
  }
}

import { STORE_PERSIST_SOURCE } from '../errors.js'
import { StorePersistErrorCode } from '../error-code.js'
import { StorePersistErrorText } from '../error-text.js'

/**
 * Validates one decoded archive and returns a new version/state pair without cloning its state. Use
 * before restoration: version must be a nonnegative safe integer and state must be present and
 * non-nullish. Reads each accepted property once, including inherited properties; key only
 * identifies diagnostics. Invalid shape or failed reflection throws PersistEnvelopeError with any
 * underlying failure on cause. This is not application-state schema validation.
 */
export function assertEnvelope<TState>(value: unknown, key: string): IEnvelope<TState> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new PersistEnvelopeError(StorePersistErrorText.archiveEnvelope(key))
    }
    /** Capture version once so validation and the returned envelope use the same observed value. */
    const envelope = value as Record<string, unknown>
    /** A failed property read is an invalid envelope, with the original error retained below. */
    const version = envelope.version
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
      throw new PersistEnvelopeError(StorePersistErrorText.archiveVersion(key))
    }
    /** Read state once after version validation, preserving inherited getter receivers. */
    const state = 'state' in envelope ? envelope.state : undefined
    if (state === null || state === undefined) {
      throw new PersistEnvelopeError(StorePersistErrorText.archiveState(key))
    }
    return { version, state: state as TState }
  } catch (cause) {
    if (cause instanceof PersistEnvelopeError) throw cause
    throw new PersistEnvelopeError(StorePersistErrorText.archiveEnvelope(key), { cause })
  }
}
