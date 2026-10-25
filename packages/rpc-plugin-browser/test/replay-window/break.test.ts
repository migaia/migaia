import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { coreMemoryServer } from '../../../rpc-host/test/host/core-fixture.js'
import { RpcAuthenticationEnvelope } from '../../../rpc-host/dist/plugins/auth/constants.js'

describe('replay-window r12 authentication break', () => {
  it('rejects a successfully verified legacy frame without replay binding', async () => {
    /** The real JSON carrier and installed auth hook own binding admission after verification. */
    const source = coreMemoryServer('receiver', 'receiver', 'memory', [], [], {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    })
    /** Rejection is observed by the public call and the original receiving Host reporter. */
    const failures: unknown[] = []
    /** Successful signature verification cannot give an unbound value dispatch authority. */
    let verified: unknown
    /** Genuine installation/directory frames remain valid before the selected unbound delivery. */
    let legacy = false
    const server = await createRpcHost({
      ...source.options,
      plugins: [
        auth({
          sign: (value) => value,
          verify: (value) => {
            verified = value
            return value
          }
        }),
        source.transport
      ],
      provide: { echo: (value: unknown) => value },
      report: (error) => failures.push(error)
    })
    /** The signer deliberately emits the same successfully verified old unbound value. */
    const client = await source.connect('sender', {
      plugins: [
        auth({ sign: (value) => (legacy ? { legacy: true } : value), verify: (value) => value })
      ]
    })
    try {
      legacy = true
      await assert.rejects(
        () => client.host.memory.request('echo', 'legacy'),
        { code: 'AUTHENTICATION_FAILED' },
        'a valid legacy signature must not bypass replay binding'
      )
      await vi.waitFor(() => assert.equal(failures.length, 1))
      assert.deepEqual(verified, { legacy: true })
      assert.equal(
        (failures[0] as { code?: unknown }).code,
        'AUTHENTICATION_FAILED',
        'a valid legacy signature must not bypass replay binding'
      )
    } finally {
      await client.host.close()
      await server.close()
    }
  })

  it('rejects encryption without signing during configuration', () => {
    assert.throws(
      () => auth({ encrypt: (value) => value, decrypt: (value) => value }),
      { code: 'INVALID_CONFIG' },
      'encryption must be paired with signed replay binding'
    )
  })

  it('encrypts the binding before signing', async () => {
    /** Capture actual callback input from the installed four-stage JSON codec path. */
    let encryptedInput: unknown
    /** The signer must receive exactly the encryption output, including its replay binding. */
    let signedInput: unknown
    const source = coreMemoryServer('receiver', 'receiver', 'memory', [], [], {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    })
    const server = await createRpcHost({
      ...source.options,
      plugins: [auth({ sign: (value) => value, verify: (value) => value }), source.transport],
      provide: { echo: (value: unknown) => value }
    })
    const client = await source.connect('sender', {
      plugins: [
        auth({
          encrypt: (value) => {
            encryptedInput = value
            return value
          },
          decrypt: (value) => value,
          sign: (value) => {
            signedInput = value
            return value
          },
          verify: (value) => value
        })
      ]
    })
    /** The complete semantic envelope now surrounds this application payload on the wire. */
    const payload = { message: 'binding coverage' }
    try {
      assert.equal(
        ((await client.host.memory.request('echo', payload)) as { message: string }).message,
        payload.message
      )
      assert.notStrictEqual(encryptedInput, payload, 'encrypt must receive the replay wrapper')
      assert.strictEqual(signedInput, encryptedInput, 'sign receives the encrypted binding')
      assert.equal(typeof encryptedInput, 'string')
      /** Inspect the actual signed representation, without constructing another auth path. */
      const binding = JSON.parse(
        (encryptedInput as string).slice(RpcAuthenticationEnvelope.prefix.length)
      ) as { version?: unknown; payload: string }
      assert.equal(binding.version, 1, 'wrapper version')
      /** BC2 replaces the naked payload root with the complete new-profile call envelope. */
      assert.deepEqual(JSON.parse(binding.payload).payload, payload, 'bound payload')
    } finally {
      await client.host.close()
      await server.close()
    }
  })
})
