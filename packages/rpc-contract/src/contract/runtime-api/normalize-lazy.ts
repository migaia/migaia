import { normalizeRuntimePortable } from '../normalize.js'
import { normalizeStreamPayloadLazy } from '../stream-lazy.js'
import { normalizeRuntimeEnvelope as normalizeEnvelope } from './normalize-envelope.js'
import { readDecodedRecord } from './metadata.js'
import type { IRpcPortableValue } from '../types.js'
import type { IRpcRuntimeEnvelope } from './types.js'

/** Share the complete canonical union; only its actual stream branch may enter cold parsing. */
export function normalizeRuntimeEnvelopeLazy(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue = normalizeRuntimePortable
): IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope> {
  return normalizeEnvelope(value, portable, normalizeStreamPayloadLazy)
}

/**
 * Validate a trusted canonical codec result selected by its decoding owner, without granting RPC
 * authority. The shared union yields only when an actual stream branch loads its parser.
 */
export function normalizeRuntimeEnvelopeDecodedLazy(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue = normalizeRuntimePortable
): IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope> {
  return normalizeEnvelope(value, portable, normalizeStreamPayloadLazy, readDecodedRecord)
}
