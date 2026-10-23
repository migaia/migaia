import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'
import { encode, decode } from 'cborg'
import { RpcTransportEncoding } from '@migaia/rpc-host/plugin'

/** Test-only material belongs to this fixture and is never returned or printed by either host. */
const fixtureKey = Buffer.alloc(32, 41)

/** These diagnostics are fixture assertions, not new production error-code families. */
const AuthText = {
  signatureInvalid: 'Devtools fixture signature mismatch',
  algorithm: 'aes-256-gcm',
  digest: 'sha256',
  encoding: 'base64'
}

/**
 * Install genuine frame signing and encryption through Core's public authentication contract.
 * Process native transport carries strings; CBOR plus Base64 supplies that actual wire category
 * while restoring the original string, byte or structured frame on decryption.
 *
 * @returns {import('@migaia/rpc-host').IRpcAuthenticationConfig} Paired protection transforms.
 * @throws {TypeError} When a received fixture signature is not authentic.
 */
export function fixtureAuthentication() {
  return {
    /** Process's native carrier declares string; MessagePort's any category also admits strings. */
    encodedType: RpcTransportEncoding.string,
    /**
     * Sign the actual encrypted representation and encode its signed envelope as wire text.
     *
     * @param {unknown} value Actual encrypted representation supplied by Core.
     * @returns {string} Base64 CBOR text accepted by the actual Process and MessagePort transports.
     */
    sign(value) {
      return Buffer.from(
        encode({
          value,
          signature: createHmac(AuthText.digest, fixtureKey)
            .update(encode(value))
            .digest(AuthText.encoding)
        })
      ).toString(AuthText.encoding)
    },
    /**
     * Decode signed wire text and verify its encrypted representation before exposing it.
     *
     * @param {unknown} input Protected string received through Core's actual transport.
     * @returns {string} Original encrypted text produced by the paired encrypt transform.
     * @throws {TypeError} If the fixture MAC does not match its actual encrypted contents.
     */
    verify(input) {
      /** The fixture signer owns this concrete public-transform output shape. */
      const signed = /** @type {{ value: string; signature: string }} */ (
        decode(Buffer.from(/** @type {string} */ (input), AuthText.encoding))
      )
      /** Decode the received MAC independently from the MAC recomputed over the actual frame. */
      const received = Buffer.from(signed.signature, AuthText.encoding)
      /** A real HMAC covers the entire protected representation, including all ciphertext fields. */
      const expected = createHmac(AuthText.digest, fixtureKey).update(encode(signed.value)).digest()
      if (received.length !== expected.length || !timingSafeEqual(received, expected))
        throw new TypeError(AuthText.signatureInvalid)
      return signed.value
    },
    /**
     * Encrypt the original frame and encode its GCM envelope as native-compatible text.
     *
     * @param {unknown} value Original replay-bound frame supplied by Core.
     * @returns {string} GCM envelope represented as CBOR plus Base64 text.
     */
    encrypt(value) {
      /** A distinct nonce prevents ciphertext reuse across otherwise identical fixture frames. */
      const iv = randomBytes(12)
      /** Node crypto owns authenticated encryption; the fixture supplies no replacement RPC codec. */
      const cipher = createCipheriv(AuthText.algorithm, fixtureKey, iv)
      /** CBOR preserves the replay-bound Process string and structured Worker frame types. */
      const encrypted = Buffer.concat([cipher.update(encode(value)), cipher.final()])
      return Buffer.from(
        encode({
          iv: iv.toString(AuthText.encoding),
          ciphertext: encrypted.toString(AuthText.encoding),
          tag: cipher.getAuthTag().toString(AuthText.encoding)
        })
      ).toString(AuthText.encoding)
    },
    /**
     * Decode GCM text and restore the exact original frame representation expected by Core.
     *
     * @param {unknown} input Verified encrypted text returned by the paired verify transform.
     * @returns {unknown} Original Process string or structured/byte MessagePort frame.
     * @throws {Error} Original Node authenticated-decryption failure for an invalid GCM tag.
     */
    decrypt(input) {
      /** This shape is owned only by the paired fixture encrypt transform. */
      const encrypted = /** @type {{ iv: string; ciphertext: string; tag: string }} */ (
        decode(Buffer.from(/** @type {string} */ (input), AuthText.encoding))
      )
      /** Node validates the GCM authentication tag before the original frame becomes observable. */
      const decipher = createDecipheriv(
        AuthText.algorithm,
        fixtureKey,
        Buffer.from(encrypted.iv, AuthText.encoding)
      )
      decipher.setAuthTag(Buffer.from(encrypted.tag, AuthText.encoding))
      return decode(
        Buffer.concat([
          decipher.update(Buffer.from(encrypted.ciphertext, AuthText.encoding)),
          decipher.final()
        ])
      )
    }
  }
}

/**
 * Preserve native failure classification while keeping fixture credentials out of diagnostics.
 *
 * @param {unknown} error Original failure from the actual Peer, collector or hub.
 * @returns {void} Writes one redacted diagnostic record to the standalone host's stderr.
 */
export function reportFailure(error) {
  /** Native stacks stay on the original Error; diagnostics classify it without rebuilding it. */
  const original = /** @type {Error & { source?: string; code?: string; reason?: string }} */ (
    error
  )
  console.error(
    JSON.stringify({
      source: original?.source ?? null,
      code: original?.code ?? null,
      name: original?.name ?? typeof error,
      reason: original?.reason ?? null,
      message: String(original?.message ?? error).replaceAll(
        fixtureKey.toString('hex'),
        '<REDACTED>'
      )
    })
  )
}
