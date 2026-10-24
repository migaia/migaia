import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { authentication } from '../../../rpc-host/dist/core/middleware/authentication.js'

/** Public test-only key signs the entire inner physical binding; it is never a deployment secret. */
const key = 'native-stream-public-fixture-key'

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
class NativeFixtureAuthentication {
  /**
   * The actual canonical middleware retains signing, verification and installed capability
   * ownership.
   */
  #original
  /** The sender reads only the capability returned by the real middleware installation. */
  #installed
  /** The test installs this original middleware with an observation of its genuine capability. */
  plugin
  /**
   * Retain the real authentication owner and observe its ordinary installation result.
   *
   * @param {'any' | 'string'} encodedType Exact encoded transport output category.
   */
  constructor(encodedType) {
    this.#original = authentication({
      sign: signNativeFixture,
      verify: verifyNativeFixture,
      encodedType
    })
    this.plugin = { ...this.#original, install: this.#install }
  }
  /**
   * Observe the capability only after canonical installation succeeds.
   *
   * @param {Parameters<ReturnType<typeof authentication>['install']>[0]} context Original
   *   middleware installation context.
   * @returns {ReturnType<ReturnType<typeof authentication>['install']>} Original installation
   *   result, unchanged.
   */
  #install = async (context) => {
    const result = await this.#original.install(context)
    this.#installed = result.ports.authentication
    return result
  }
  /**
   * Read the real installed capability without creating a second authentication path.
   *
   * @returns {object | undefined} Capability from successful canonical installation.
   */
  capability = () => this.#installed
}

/**
 * Expose one case-owned observation of the actual canonical authentication installation.
 *
 * @param {'any' | 'string'} [encodedType] Exact encoded transport output category.
 * @returns {{ plugin: object; capability(): object | undefined }} Original middleware and its
 *   installed capability reader.
 */
export function nativeFixtureAuthentication(encodedType = 'any') {
  return new NativeFixtureAuthentication(encodedType)
}
