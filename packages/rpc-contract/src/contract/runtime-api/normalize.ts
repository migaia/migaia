import { normalizeRuntimePortable } from '../normalize.js'
import { normalizeStreamPayload } from '../v1/stream.js'
import { normalizeRuntimeEnvelope as normalizeEnvelope } from './normalize-envelope.js'
import { readDecodedRecord } from './metadata.js'
import type { IRpcPortableValue } from '../types.js'
import type { IRpcRuntimeEnvelope } from './types.js'

export { normalizeRuntimeSteps, normalizeRuntimeGeneration } from './metadata.js'

/** Public explicit normalization retains the full synchronous parser and native error boundary. */
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
