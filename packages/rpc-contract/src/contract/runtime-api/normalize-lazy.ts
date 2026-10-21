import { normalizeRuntimePortable } from '../normalize.js'
import { normalizeStreamPayloadLazy } from '../stream-lazy.js'
import { normalizeRuntimeEnvelope as normalizeEnvelope } from './normalize-envelope.js'
import { readDecodedRecord } from './metadata.js'
import type { IRpcPortableValue } from '../types.js'
import type { IRpcRuntimeEnvelope } from './types.js'

/**
 * Apply the same strict runtime-envelope grammar and default native portable policy as the full
 * normalizer. Scalar variants return synchronously; an actual stream branch can return a Promise
 * while its canonical parser loads. Callers must handle both synchronous throws and rejection; this
 * changes loading only, not admission authority or wire shape.
 */
export function normalizeRuntimeEnvelopeLazy(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue = normalizeRuntimePortable
): IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope> {
  return normalizeEnvelope(value, portable, normalizeStreamPayloadLazy)
}

/**
 * Validate only canonical codec output selected by its decoding owner from actual provenance.
 * Reading own enumerable properties executes getters; this entry does not accept or validate
 * caller-constructed objects. Use this subpath's `normalizeRuntimeEnvelope` strict entry instead.
 * The shared union yields only when an actual stream branch loads its parser; no authority is
 * granted by calling this entry.
 */
export function normalizeRuntimeEnvelopeDecodedLazy(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue = normalizeRuntimePortable
): IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope> {
  return normalizeEnvelope(value, portable, normalizeStreamPayloadLazy, readDecodedRecord)
}
