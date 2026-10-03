import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { authentication } from '../../dist/core/middleware/authentication.js'

/** Public test-only key signs the entire inner physical binding; it is never a deployment secret. */
const key = 'r12-native-stream-public-fixture-key'

/**
 * Produces exact HMAC input for each supported physical category.
 *
 * @param {unknown} value Complete signed inner frame.
 * @returns {string | Uint8Array} Original bytes/string or deterministic object JSON.
 */
function input(value) {
  return typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)
}

/**
 * Protects a complete frame while retaining typed byte transports.
 *
 * @param {unknown} value Canonical authentication's bound physical input.
 * @returns {unknown} Same-category signed bytes/string or structured-clone object.
 */
export function signNativeFixture(value) {
  const mac = createHmac('sha256', key).update(input(value)).digest()
  if (value instanceof Uint8Array) {
    const result = new Uint8Array(value.length + mac.length)
    result.set(value)
    result.set(mac, value.length)
    return result
  }
  if (typeof value === 'string') return mac.toString('hex') + ':' + value
  return { value, mac: mac.toString('hex') }
}

/**
 * Validates captured signatures without changing any replay counter or trusted-session proof.
 *
 * @param {unknown} frame Original protected physical frame.
 * @returns {unknown} Exact signed inner category.
 * @throws {import('node:assert').AssertionError} Altered fixture signatures never reach core.
 */
export function verifyNativeFixture(frame) {
  const value =
    frame instanceof Uint8Array
      ? frame.subarray(0, -32)
      : typeof frame === 'string'
        ? frame.slice(65)
        : frame.value
  const mac =
    frame instanceof Uint8Array
      ? Buffer.from(frame.subarray(-32)).toString('hex')
      : typeof frame === 'string'
        ? frame.slice(0, 64)
        : frame.mac
  assert.equal(mac, createHmac('sha256', key).update(input(value)).digest('hex'))
  return value
}

/**
 * Exposes only the actual canonical installed capability to a package-owned sender fixture.
 *
 * @param {'any' | 'string'} [encodedType] Exact transport output category after signing.
 * @returns {{ plugin: object; capability(): object | undefined }} Normal middleware plus exact
 *   port.
 */
export function nativeFixtureAuthentication(encodedType = 'any') {
  const original = authentication({
    sign: signNativeFixture,
    verify: verifyNativeFixture,
    encodedType
  })
  let installed
  return {
    plugin: {
      ...original,
      install: async (context) => {
        const result = await original.install(context)
        installed = result.ports.authentication
        return result
      }
    },
    capability: () => installed
  }
}
