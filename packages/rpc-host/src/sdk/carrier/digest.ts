/**
 * Captures the available native crypto digest receiver and hashes an original binary backing. The
 * codec supplies capture order and uses the returned SHA-256 text; this helper does not own binary
 * traversal, authentication decisions or native transport acquisition.
 */
import type { IRpcBinaryDigest } from '../wire/binary-types.ts'

/** Encode one native digest byte; the enclosing SHA-256 result has exactly 32 bytes. */
function digestByteHex(byte: number): string {
  return byte.toString(16).padStart(2, '0')
}

/** Move the original stateless whole-backing hash operation; it grants no auth or replay authority. */
export function createRpcBackingDigest(): IRpcBinaryDigest | undefined {
  /** Standard host cryptography stays structurally injected rather than importing Node or DOM code. */
  const subtle = (
    globalThis as unknown as {
      crypto?: { subtle?: { digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer> } }
    }
  ).crypto?.subtle
  if (!subtle || typeof subtle.digest !== 'function') return undefined
  /** Capture the exact original native callable once with its required builtin receiver. */
  const nativeDigest = subtle.digest
  return async (backing) => {
    /** Every byte of the original complete backing contributes to its native integrity digest. */
    const hash = await Reflect.apply(nativeDigest, subtle, ['SHA-256', backing])
    return [...new Uint8Array(hash)].map(digestByteHex).join('')
  }
}
