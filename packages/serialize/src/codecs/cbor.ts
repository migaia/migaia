import { toCodecPortableValue } from '../portable.js'
import { Decoder, Encoder } from 'cbor-x'
import { SerializeErrorCode } from '../error-code.js'
import {
  asCodecValue,
  CodecErrorText,
  normalizeCodecFailure,
  type ICodec,
  type ICodecValue
} from '../codec.js'
import { assertCodecVersion, createCodecError } from '../internal/codec.js'

/** Shared CBOR encoder configured without records, tags, or host-specific extensions. */
const cborEncoder = new Encoder({
  mapsAsObjects: true,
  useRecords: false,
  variableMapSize: true,
  tagUint8Array: false
})

/** Shared CBOR decoder matching the portable object profile emitted above. */
const cborDecoder = new Decoder({ mapsAsObjects: true, useRecords: false })

/** Projects cbor-x bigint integers into the portable number domain only when exact. */
function projectDecodedSafeIntegers(value: unknown, active = new Set<object>()): unknown {
  if (typeof value === 'bigint') {
    /** Exact JavaScript number representation of a decoded CBOR integer. */
    const projected = Number(value)
    if (!Number.isSafeInteger(projected))
      throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.portableValueInvalid)
    return projected
  }
  if (value === null || typeof value !== 'object') return value
  if (active.has(value)) return value
  if (Array.isArray(value)) {
    active.add(value)
    try {
      for (const [index, item] of value.entries())
        value[index] = projectDecodedSafeIntegers(item, active)
      return value
    } finally {
      active.delete(value)
    }
  }
  /** Decoded non-record values remain for existing portable validation to reject. */
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  active.add(value)
  try {
    /** Own decoded CBOR record mutated only at safe-integer projection entries. */
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record))
      record[key] = projectDecodedSafeIntegers(record[key], active)
    return record
  } finally {
    active.delete(value)
  }
}

/** Options for the deterministic CBOR codec factory. */
export type ICborCodecOptions<TVersion extends number> = Readonly<{
  /** Required positive safe integer codec revision; no default is supplied. */
  version: TVersion
}>

/**
 * Creates a frozen synchronous cbor codec through the optional peer imported by this subpath.
 * Version must be a positive safe integer. Portable projection avoids records and host-specific
 * encoder extensions; decoded bigint integers become numbers only when safely representable.
 * Decoding then validates the portable profile without reviving inline bytes tags. Classified
 * portable failures keep their code; other format failures retain a coded cause chain.
 */
export function defineCBORCodec<const TVersion extends number>(
  options: ICborCodecOptions<TVersion>
): ICodec<ICodecValue, Uint8Array, 'cbor', TVersion> {
  const version = assertCodecVersion(options.version)
  return Object.freeze({
    id: 'cbor' as const,
    version,
    encodedType: 'uint8array' as const,
    encode: (value: ICodecValue): Uint8Array => {
      try {
        const portable = toCodecPortableValue(value)
        return cborEncoder.encode(portable)
      } catch (error) {
        throw normalizeCodecFailure(
          error,
          SerializeErrorCode.encodeFailed,
          CodecErrorText.encodeFailed
        )
      }
    },
    decode: (value: Uint8Array): ICodecValue => {
      try {
        const decoded = cborDecoder.decode(value) as unknown
        return asCodecValue(projectDecodedSafeIntegers(decoded))
      } catch (error) {
        throw normalizeCodecFailure(
          error,
          SerializeErrorCode.decodeFailed,
          CodecErrorText.decodeFailed
        )
      }
    }
  })
}
