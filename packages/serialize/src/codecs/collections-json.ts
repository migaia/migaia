import type { ICodec, ICodecValue } from '../codec.ts'
import type { IJsonCodecOptions } from './json.ts'
import { CodecErrorText } from '../codec-text.ts'
import { SerializeErrorCode } from '../error-code.ts'
import { assertCodecVersion, createCodecError } from '../internal/codec.ts'
import { fromCollectionsPortableValue, toCollectionsPortableValue } from '../portable.ts'

/** Portable format values extended with recursively nested collections and intrinsic bytes. */
export type ICollectionsCodecValue =
  | ICodecValue
  | Uint8Array
  | ReadonlyMap<ICollectionsCodecValue, ICollectionsCodecValue>
  | ReadonlySet<ICollectionsCodecValue>
  | readonly ICollectionsCodecValue[]
  | Readonly<{ [key: string]: ICollectionsCodecValue }>

/**
 * Creates a frozen synchronous JSON codec preserving Map and Set insertion order through reserved
 * records. Other values share the strict portable profile. Bytes decode as reserved records.
 * Failures retain the original portable or JSON error directly on the format error's cause.
 */
export function defineCollectionsJsonCodec<const TVersion extends number>(
  options: IJsonCodecOptions<TVersion>
): ICodec<ICollectionsCodecValue, string, 'collections-json', TVersion> & {
  readonly encodedType: 'string'
} {
  /** Capture the admitted revision once; encoding carries no per-call configuration state. */
  const version = assertCodecVersion(options.version)
  return Object.freeze({
    id: 'collections-json' as const,
    version,
    encodedType: 'string' as const,
    encode: (value: ICollectionsCodecValue): string => {
      try {
        return JSON.stringify(toCollectionsPortableValue(value))
      } catch (cause) {
        throw createCodecError(SerializeErrorCode.encodeFailed, CodecErrorText.encodeFailed, cause)
      }
    },
    decode: (value: string): ICollectionsCodecValue => {
      try {
        return fromCollectionsPortableValue(JSON.parse(value)) as ICollectionsCodecValue
      } catch (cause) {
        throw createCodecError(SerializeErrorCode.decodeFailed, CodecErrorText.decodeFailed, cause)
      }
    }
  })
}
