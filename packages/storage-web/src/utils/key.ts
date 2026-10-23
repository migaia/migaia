import type { IBackendKind } from '../types/capabilities.js'
import { StorageError, StorageErrorCode, createStorageTypeError } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { normalizeError } from '../backends/errors.js'
import { utf8ByteLength } from '@migaia/utils/bytes'
import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotStorageKey,
  type IStorageKey
} from '@migaia/storage-contract'
import { encodeFlatStorageKey, decodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'

/** Namespace/key codec boundary. Custom codecs own migration and collision safety. */
export type INamespaceCodec = {
  /**
   * Map a logical namespace/key pair to a physical string; a custom codec owns collision safety and
   * migration.
   */
  encode(namespace: string, key: string): string
  /** Return this namespace's logical key, or undefined for a foreign/malformed physical name. */
  decode(namespace: string, physicalKey: string): string | undefined
  /** Encode typed batch keys without colliding with the codec's original string-key layout. */
  encodeStorageKey?(namespace: string, key: IStorageKey): string
  /** Identify typed and string entries during namespace-wide cleanup and prefix deletion. */
  decodeStorageKey?(namespace: string, physicalKey: string): IStorageKey | undefined
}

/** The original string layout and additive typed layout have disjoint top-level versions. */
const NamespaceWire = { string: 'sw1:', typed: 'sw2:' } as const

/** Both physical wire versions retain the original length-prefixed namespace admission. */
const namespaceBody = (
  namespace: string,
  physicalKey: string,
  wire: string
): string | undefined => {
  if (!physicalKey.startsWith(wire)) return undefined
  /** The remaining header preserves the original byte-length and URI namespace fields. */
  const rest = physicalKey.slice(wire.length)
  /** Only the first colon separates the declared byte length from the encoded namespace. */
  const lengthSeparator = rest.indexOf(':')
  if (lengthSeparator < 0) return undefined
  /** Persisted length describes decoded UTF-8 bytes, not the URI representation. */
  const byteLength = Number(rest.slice(0, lengthSeparator))
  /** URI escaping keeps namespace colons distinct from the final body separator. */
  const encoded = rest.slice(lengthSeparator + 1)
  /** The body remains opaque until the selected wire's existing codec consumes it. */
  const namespaceSeparator = encoded.indexOf(':')
  if (namespaceSeparator < 0) return undefined
  /** Malformed URI data remains a nonmatching physical key during enumeration. */
  let decodedNamespace: string
  try {
    decodedNamespace = decodeURIComponent(encoded.slice(0, namespaceSeparator))
  } catch {
    return undefined
  }
  if (decodedNamespace !== namespace || utf8ByteLength(decodedNamespace) !== byteLength)
    return undefined
  return encoded.slice(namespaceSeparator + 1)
}

/**
 * Default frozen namespace codec using a versioned UTF-8-length-prefixed namespace and the original
 * logical key. Decode returns undefined for foreign or malformed physical names. Persisted data
 * needs explicit migration if the namespace codec changes.
 */
export const lengthPrefixedNamespaceCodec: INamespaceCodec = Object.freeze({
  encode: (namespace, key) => {
    const encodedNamespace = encodeURIComponent(namespace)
    return `${NamespaceWire.string}${utf8ByteLength(namespace)}:${encodedNamespace}:${key}`
  },
  decode: (namespace, physicalKey) => namespaceBody(namespace, physicalKey, NamespaceWire.string),
  encodeStorageKey: (namespace, key) =>
    typeof key === 'string'
      ? lengthPrefixedNamespaceCodec.encode(namespace, key)
      : `${NamespaceWire.typed}${utf8ByteLength(namespace)}:${encodeURIComponent(namespace)}:${encodeFlatStorageKey(key)}`,
  decodeStorageKey: (namespace, physicalKey) => {
    /** String entries retain their raw suffix, including strings resembling typed data. */
    const text = namespaceBody(namespace, physicalKey, NamespaceWire.string)
    if (text !== undefined) return text
    /** Only the new top-level wire may ask the typed-key decoder to interpret its body. */
    const body = namespaceBody(namespace, physicalKey, NamespaceWire.typed)
    if (body === undefined) return undefined
    /** Typed writes never encode strings in this wire; malformed alternatives remain unowned. */
    const key = decodeFlatStorageKey(body)
    return typeof key === 'string' ? undefined : key
  }
})

/**
 * Snapshot a namespace codec descriptor so backend lifetime behavior cannot follow accessor
 * changes.
 */
export const snapshotNamespaceCodec = (
  codec: unknown,
  backend: IBackendKind = 'local'
): INamespaceCodec => {
  if (typeof codec !== 'object' || codec === null || Array.isArray(codec))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(StorageErrorText.namespaceCodecInvalid)
    })
  const candidate = codec as Record<string, unknown>
  let encode: unknown
  let decode: unknown
  /** Optional typed functions are borrowed once after the original string codec pair. */
  let encodeStorageKey: unknown
  /** Cleanup captures the matching decoder before admitting typed physical writes. */
  let decodeStorageKey: unknown
  try {
    encode = candidate.encode
    decode = candidate.decode
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { backend, cause })
  }
  if (typeof encode !== 'function' || typeof decode !== 'function')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(StorageErrorText.namespaceCodecInvalid)
    })
  try {
    encodeStorageKey = candidate.encodeStorageKey
    decodeStorageKey = candidate.decodeStorageKey
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { backend, cause })
  }
  if (
    (encodeStorageKey !== undefined || decodeStorageKey !== undefined) &&
    (typeof encodeStorageKey !== 'function' || typeof decodeStorageKey !== 'function')
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(StorageErrorText.namespaceTypedCodecInvalid)
    })
  return {
    encode,
    decode,
    ...(encodeStorageKey === undefined ? {} : { encodeStorageKey, decodeStorageKey })
  } as INamespaceCodec
}

/** Typed batches preserve old string identities and reject unsupported custom codecs before I/O. */
export const namespacedStorageKey = (
  namespace: string,
  key: IStorageKey,
  codec: INamespaceCodec,
  backend: IBackendKind
): string => {
  if (typeof key === 'string') return namespacedKey(namespace, key, codec, backend)
  if (codec.encodeStorageKey === undefined || codec.decodeStorageKey === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported, { backend })
  try {
    /** One extension result determines this key's native physical identity. */
    const physicalKey = codec.encodeStorageKey(namespace, key)
    if (typeof physicalKey !== 'string')
      throw createStorageTypeError(
        StorageErrorCode.extensionFailed,
        StorageErrorText.namespaceCodecEncodeInvalid
      )
    return physicalKey
  } catch (cause) {
    throw normalizeError(
      cause,
      backend,
      StorageErrorCode.extensionFailed,
      'namespace.encode',
      'codec'
    )
  }
}

/** Namespace-wide operations recognize both wire versions without exposing typed keys as strings. */
export const stripStorageNamespace = (
  namespace: string,
  physicalKey: string,
  codec: INamespaceCodec,
  backend: IBackendKind
): IStorageKey | undefined => {
  if (codec.decodeStorageKey === undefined)
    return stripNamespace(namespace, physicalKey, codec, backend)
  try {
    /** Enumeration admits only a detached canonical key from the captured decoder. */
    const key = codec.decodeStorageKey(namespace, physicalKey)
    if (key === undefined) return undefined
    try {
      return snapshotStorageKey(key, backend)
    } catch (cause) {
      throw new StorageError(StorageErrorCode.extensionFailed, {
        backend,
        operation: 'namespace.decode',
        extensionStage: 'codec',
        cause
      })
    }
  } catch (cause) {
    throw normalizeError(
      cause,
      backend,
      StorageErrorCode.extensionFailed,
      'namespace.decode',
      'codec'
    )
  }
}

/** Namespace-aware physical key encoding. */
export const namespacedKey = (
  namespace: string,
  key: string,
  codec: INamespaceCodec = lengthPrefixedNamespaceCodec,
  backend: IBackendKind = 'local'
): string => {
  if (typeof namespace !== 'string' || typeof key !== 'string')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(StorageErrorText.namespaceKeyInvalid)
    })
  try {
    const physicalKey = codec.encode(namespace, key)
    if (typeof physicalKey !== 'string')
      throw createStorageTypeError(
        StorageErrorCode.extensionFailed,
        StorageErrorText.namespaceCodecEncodeInvalid
      )
    return physicalKey
  } catch (cause) {
    throw normalizeError(
      cause,
      backend,
      StorageErrorCode.extensionFailed,
      'namespace.encode',
      'codec'
    )
  }
}

/** Decode a physical key, returning undefined only when it belongs to another namespace. */
export const stripNamespace = (
  namespace: string,
  physicalKey: string,
  codec: INamespaceCodec = lengthPrefixedNamespaceCodec,
  backend: IBackendKind = 'local'
): string | undefined => {
  if (typeof namespace !== 'string' || typeof physicalKey !== 'string')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(StorageErrorText.namespacePhysicalKeyInvalid)
    })
  try {
    const key = codec.decode(namespace, physicalKey)
    if (key !== undefined && typeof key !== 'string')
      throw createStorageTypeError(
        StorageErrorCode.extensionFailed,
        StorageErrorText.namespaceCodecDecodeInvalid
      )
    return key
  } catch (cause) {
    throw normalizeError(
      cause,
      backend,
      StorageErrorCode.extensionFailed,
      'namespace.decode',
      'codec'
    )
  }
}
