import { invalidArgument } from './errors.js'
/** The original ordered key bytes travel as fixed-width lowercase ASCII hex on native S3 keys. */
export const encodeObjectWireBytes = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
/** Read only this transport representation; logical key parsing remains with storage-contract. */
export function decodeObjectWireBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw invalidArgument()
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  )
}
