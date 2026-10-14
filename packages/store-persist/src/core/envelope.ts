/**
 * Stores state with a schema `version` for `migrate()`.
 *
 * Codec routing already matches output formats to backend capabilities. Persistence does not
 * maintain separate text and byte locations for one key or resolve channel conflicts by revision.
 */
export type IEnvelope<TState> = {
  version: number
  state: TState
}

export class PersistEnvelopeError extends TypeError {
  constructor(message: string) {
    super(message)
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

export function assertEnvelope<TState>(value: unknown, key: string): IEnvelope<TState> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistEnvelopeError(StorePersistErrorText.archiveEnvelope(key))
  }
  const envelope = value as Record<string, unknown>
  if (
    typeof envelope.version !== 'number' ||
    !Number.isSafeInteger(envelope.version) ||
    envelope.version < 0
  ) {
    throw new PersistEnvelopeError(StorePersistErrorText.archiveVersion(key))
  }
  if (!('state' in envelope) || envelope.state === null || envelope.state === undefined) {
    throw new PersistEnvelopeError(StorePersistErrorText.archiveState(key))
  }
  return { version: envelope.version, state: envelope.state as TState }
}
