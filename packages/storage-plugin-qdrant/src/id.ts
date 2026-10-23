import { encodeOrderedStorageKey } from '@migaia/storage-contract'
import { QdrantText } from './constants.js'
/** UUID's standard DNS namespace supplies one fixed package-independent v5 namespace. */
const namespace = Uint8Array.of(
  0x6b,
  0xa7,
  0xb8,
  0x10,
  0x9d,
  0xad,
  0x11,
  0xd1,
  0x80,
  0xb4,
  0x00,
  0xc0,
  0x4f,
  0xd4,
  0x30,
  0xc8
)
/** Hash the original canonical UTF-16 key bytes without a lossy text conversion. */
export async function nativeId(parts: readonly string[]): Promise<string> {
  const key = encodeOrderedStorageKey(parts, QdrantText.backend),
    input = new Uint8Array(namespace.length + key.length)
  input.set(namespace)
  input.set(key, namespace.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16)
  digest[6] = (digest[6]! & 15) | 80
  digest[8] = (digest[8]! & 63) | 128
  const hex = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20)
  )
}
