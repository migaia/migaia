import { normalizeRuntimePortable } from '../normalize.js'
import { normalizeStreamPayload } from '../v1/stream.js'
import { normalizeRuntimeEnvelope as normalizeEnvelope } from './normalize-envelope.js'
import { readDecodedRecord } from './metadata.js'
import type { IRpcPortableValue } from '../types.js'
import type { IRpcRuntimeEnvelope } from './types.js'

export { normalizeRuntimeSteps, normalizeRuntimeGeneration } from './metadata.js'

/**
 * Validate a strict runtime-envelope own-data graph synchronously and return frozen metadata
 * snapshots. Metadata accessors and extra fields are rejected without invoking them. Business
 * values default to negotiated-native portable admission; a supplied portable operation owns its
 * payload policy. Invalid grammar throws INVALID_ENVELOPE with the failing pointer and cause;
 * stream grammar keeps its INVALID_STREAM boundary. No execution or replay state is changed.
 */
export function normalizeRuntimeEnvelope(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue = normalizeRuntimePortable
): IRpcRuntimeEnvelope {
  return normalizeEnvelope(value, portable, normalizeStreamPayload) as IRpcRuntimeEnvelope
}

/**
 * Validate only canonical codec output selected by its decoding owner from actual provenance.
 * Reading own enumerable properties executes getters; this entry does not accept or validate
 * caller-constructed objects. Use `normalizeRuntimeEnvelope` for strict object validation. The
 * shared union parser still checks wire fields; calling this entry grants no RPC authority.
 */
export function normalizeRuntimeEnvelopeDecoded(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue = normalizeRuntimePortable
): IRpcRuntimeEnvelope {
  return normalizeEnvelope(
    value,
    portable,
    normalizeStreamPayload,
    readDecodedRecord
  ) as IRpcRuntimeEnvelope
}
