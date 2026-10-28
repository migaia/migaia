import {
  toPortableValue,
  asCodecValue,
  normalizeCodecFailure,
  CodecErrorText,
  type ICodecValue
} from '@migaia/serialize/codec'
import { SerializeErrorCode } from '@migaia/serialize/core'
import { encodeUtf8 } from '@migaia/utils/bytes'
import { invalidArgument } from './errors.ts'
import { CacheKeyNormalizer } from './key-canonical.ts'

/** Digest original bytes once; cache request identities and offloaded content share this primitive. */
export async function hashCacheBytes(bytes: Uint8Array): Promise<string> {
  /** The native digest captures these owned encoded bytes synchronously before its Promise settles. */
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  )
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Canonical portable object ordering gives equivalent application requests one SHA-256 key. */
export async function cacheKey(
  ...parts: readonly [ICodecValue, ...ICodecValue[]]
): Promise<string> {
  if (parts.length === 0) throw invalidArgument()
  try {
    /** Preserve the existing projection and value admission before cache-specific key ordering. */
    const projected = parts.map((part) => asCodecValue(toPortableValue(part)))
    /** The cache owner normalizes detached records without reading application getters again. */
    const normalizer = new CacheKeyNormalizer()
    /** Stable JSON bytes retain existing cache identities independently of serialize key order. */
    const text = JSON.stringify(normalizer.normalize(projected))
    return hashCacheBytes(encodeUtf8(text))
  } catch (error) {
    throw normalizeCodecFailure(
      error,
      SerializeErrorCode.invalidOption,
      CodecErrorText.portableValueInvalid
    )
  }
}
