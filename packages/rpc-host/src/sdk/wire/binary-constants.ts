/**
 * Defines the executing binary codec's local tagged representations and integrity diagnostic
 * fields. Profile and storage values reuse canonical rpc-contract constants; this data boundary
 * performs no capture, hashing, restoration or native IO.
 */
import {
  RpcWireBinaryProfile as RpcBinaryProfile,
  RpcWireBinaryStorage as RpcBinaryStorage
} from '@migaia/rpc-contract/protocol'
export { RpcBinaryProfile, RpcBinaryStorage }

/** Each carrier selects one of the two canonical manifest storage representations. */
export type RpcBinaryStorage = (typeof RpcBinaryStorage)[keyof typeof RpcBinaryStorage]

/**
 * Signed native-capable captures inline complete backings through this internal 1125-byte boundary.
 * Claude's 2026-10-26 measurements found inline faster by 2.4 µs at 1126 B and 2.1 µs at 1178 B,
 * but slower by 1.1 µs at 1229 B: the crossover is near 1.2 KiB. The final selected boundary is
 * 1125 bytes; callers do not configure this representation policy.
 */
export const RPC_BINARY_INTEGRITY_INLINE_BYTES = 1125

/** Local codec failures distinguish backing integrity from structural grammar for the core reporter. */
export const RpcBinaryViolation = {
  /** Actual native backing length or SHA-256 differs from the protected manifest. */
  integrity: 'binary-integrity'
} as const

/** Every business node has a tag, so tag-shaped ordinary data cannot become a binary reference. */
export const RpcBinaryTag = {
  /** Represents a business null leaf. */
  null: 'null',
  /** Represents a business boolean leaf. */
  boolean: 'boolean',
  /** Represents a finite business number leaf. */
  number: 'number',
  /** Represents a business string leaf. */
  string: 'string',
  /** Represents an ordered tagged business array. */
  array: 'array',
  /** Represents tagged business record entries in original own-key order. */
  object: 'object',
  /** Represents an ArrayBuffer by inline bytes or native backing reference. */
  buffer: 'buffer',
  /** Represents a Uint8Array with its actual view boundaries. */
  uint8array: 'uint8array'
} as const

/** Manifest and native carrier accept only these fields, never application-controlled options. */
export const RpcBinaryField = {
  /** Closed binary-manifest grammar discriminator. */
  profile: 'profile',
  /** Selected inline or native representation. */
  storage: 'storage',
  /** Runtime metadata with tagged business values. */
  envelope: 'envelope',
  /** Ordered unique native backing integrity records. */
  backings: 'backings',
  /** Actual complete backing length charged before hashing. */
  byteLength: 'byteLength',
  /** Canonical lowercase whole-backing digest. */
  sha256: 'sha256'
} as const
