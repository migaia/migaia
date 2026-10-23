import { createHmac, timingSafeEqual } from 'node:crypto'

/** Test-only shared secret stays in this fixture and grants no library capability facts. */
const fixtureKey = 'rpc-dx-signed-binary-fixture'

/** Sign the existing authentication envelope; Core supplies the native backing integrity digest. */
export function createFixtureAuthentication() {
  /** Deterministic HMAC input covers the complete existing signed semantic envelope. */
  const signature = (value) =>
    createHmac('sha256', fixtureKey).update(JSON.stringify(value)).digest()
  return {
    sign: (value) => ({ value, signature: signature(value).toString('hex') }),
    verify: (frame) => {
      /** Forged envelopes never reach provider dispatch or become authentication trust facts. */
      const received = Buffer.from(frame.signature, 'hex')
      const expected = signature(frame.value)
      if (received.length !== expected.length || !timingSafeEqual(received, expected))
        throw new TypeError('fixture signature does not match')
      return frame.value
    }
  }
}
