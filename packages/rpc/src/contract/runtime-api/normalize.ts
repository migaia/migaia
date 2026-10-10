import { normalizeRuntimePortable } from '../normalize.js'
import { normalizeStreamPayload } from '../v1/stream.js'
import { normalizeRuntimeEnvelope as normalizeEnvelope } from './normalize-envelope.js'
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
