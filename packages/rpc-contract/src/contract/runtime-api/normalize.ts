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
 * Validate a trusted canonical codec result with the shared union parser. The decoding owner must
 * select this operation from its actual resource provenance; calling it grants no RPC authority.
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
