/** FNV-1a offset basis is the published initial unsigned 32-bit state. */
const FNV_OFFSET_BASIS = 0x811c9dc5
/** FNV-1a prime advances the hash by one byte with unsigned 32-bit multiplication. */
const FNV_PRIME = 0x01000193

/** Advances one UTF-8 byte without allocating a byte buffer or relying on a platform encoder. */
function hashByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0
}

/** Hashes UTF-8 bytes of senderId + messageId; malformed UTF-16 uses the replacement code point. */
export function rpcProbeSampleKey(senderId: string, messageId: string): number {
  /** Concatenation is the frozen correlation key shared by sender and receiver. */
  const key = senderId + messageId
  /** Hash state never depends on process-local randomness or prior interactions. */
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < key.length; i++) {
    /** Read a full Unicode scalar so equal strings have the same platform-independent UTF-8 key. */
    let point = key.codePointAt(i)!
    if (point > 0xffff) i++
    else if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd
    if (point < 0x80) hash = hashByte(hash, point)
    else if (point < 0x800) {
      hash = hashByte(hash, 0xc0 | (point >>> 6))
      hash = hashByte(hash, 0x80 | (point & 0x3f))
    } else if (point < 0x10000) {
      hash = hashByte(hash, 0xe0 | (point >>> 12))
      hash = hashByte(hash, 0x80 | ((point >>> 6) & 0x3f))
      hash = hashByte(hash, 0x80 | (point & 0x3f))
    } else {
      hash = hashByte(hash, 0xf0 | (point >>> 18))
      hash = hashByte(hash, 0x80 | ((point >>> 12) & 0x3f))
      hash = hashByte(hash, 0x80 | ((point >>> 6) & 0x3f))
      hash = hashByte(hash, 0x80 | (point & 0x3f))
    }
  }
  return hash
}
