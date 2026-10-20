import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { authentication } from '@migaia/rpc-core'
import type { IRpcAuthenticationCapability } from '@migaia/rpc-core'
import { installPlugin } from '../../../rpc-core/test/core/middleware/helpers.js'

/** Creates the production plugin port without introducing a substitute authentication path. */
const install = (config: Parameters<typeof authentication>[0]): IRpcAuthenticationCapability =>
  installPlugin(authentication(config)).get(
    'authenticationCapability'
  ) as IRpcAuthenticationCapability

describe('replay-window r12 authentication break', () => {
  it('rejects a successfully verified legacy frame without replay binding', async () => {
    /** Identity transforms represent a valid old signature, leaving binding validation observable. */
    const capability = install({ sign: (value) => value, verify: (value) => value })
    await assert.rejects(
      async () =>
        capability.unprotect(
          { legacy: true },
          {
            direction: 'inbound',
            endpointId: 'receiver',
            platform: 'Memory'
          }
        ),
      { code: 'AUTHENTICATION_FAILED' },
      'a valid legacy signature must not bypass replay binding'
    )
  })

  it('rejects encryption without signing during configuration', () => {
    assert.throws(
      () => install({ encrypt: (value) => value, decrypt: (value) => value }),
      { code: 'INVALID_CONFIG' },
      'encryption must be paired with signed replay binding'
    )
  })

  it('encrypts the binding before signing', async () => {
    /** Captures the encryption input, proving the replay binding is inside its protected value. */
    let encryptedInput: unknown
    /** Production transforms preserve their supported object category in this case. */
    const capability = install({
      encrypt: (value) => {
        encryptedInput = value
        return value
      },
      decrypt: (value) => value,
      sign: (value) => value,
      verify: (value) => value
    })
    /** User payload must be enclosed in the authenticated binding. */
    const payload = { message: 'binding coverage' }
    await capability.protect(payload, {
      direction: 'outbound',
      endpointId: 'sender',
      platform: 'Memory'
    })
    assert.notStrictEqual(encryptedInput, payload, 'encrypt must receive the replay wrapper')
    assert.equal((encryptedInput as { version?: unknown }).version, 1, 'wrapper version')
    assert.strictEqual((encryptedInput as { payload?: unknown }).payload, payload, 'bound payload')
  })
})
