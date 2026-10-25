/** Original authentication transforms run through the public Host and the sole native codec. */
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import { expect, it } from 'vitest'
import { RpcAuthenticationEnvelope } from '../../dist/features/auth/constants.js'
import { coreMemoryServer } from './core-fixture.js'

/** The original callback observations exclude the retired endpoint-context DTO. */
type IAuthenticationCall = Readonly<{ name: string; value: unknown }>

it('preserves original authentication transform order and values through actual provider delivery', async () => {
  /** Preserve the original opaque object returned by the supplied encryption callback. */
  const encrypted = Object.freeze({ stage: 'encrypted', value: 'frame' })
  /** Signing receives the exact encrypted value; the native codec transports its ordinary data. */
  const signed = Object.freeze({ stage: 'signed', value: encrypted })
  /** One bounded observation record retains only this original transform invocation's facts. */
  const state = {
    armed: false,
    boundFrame: undefined as unknown,
    encrypted,
    signed,
    calls: [] as IAuthenticationCall[]
  }
  /** Provider entry proves that actual verify/decrypt and codec admission completed. */
  const delivered = deferred<unknown>()
  /** Both native endpoints borrow the canonical JSON codec rather than a test protocol or parser. */
  const listener = coreMemoryServer(
    'auth-order-provider',
    'auth-order-provider',
    'memory',
    [],
    [],
    {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    }
  )
  /** Default any admits these original opaque object outputs; no old encodedType metadata is faked. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [
      auth({
        encrypt: (value) => value,
        sign: (value) => value,
        verify: (value) => {
          if (!state.armed) return value
          state.calls.push({ name: 'verify', value })
          return state.encrypted
        },
        decrypt: (value) => {
          if (!state.armed) return value
          state.calls.push({ name: 'decrypt', value })
          return state.boundFrame
        }
      }),
      listener.transport
    ],
    provide: {
      deliver: (value: unknown) => {
        delivered.resolve(value)
      }
    }
  })
  try {
    /** Real ready handshakes precede the one original business transform sequence. */
    const client = await listener.connect('auth-order-client', {
      plugins: [
        auth({
          encrypt: (value) => {
            if (!state.armed) return value
            state.boundFrame = value
            state.calls.push({ name: 'encrypt', value })
            return state.encrypted
          },
          sign: (value) => {
            if (!state.armed) return value
            state.calls.push({ name: 'sign', value })
            return state.signed
          },
          verify: (value) => value,
          decrypt: (value) => value
        })
      ]
    })
    try {
      state.armed = true
      await client.host.memory.notify('deliver', 'frame')
      expect(await delivered.promise).toBe('frame')
      expect(state.calls.map(({ name }) => name)).toEqual(['encrypt', 'sign', 'verify', 'decrypt'])
      expect(state.calls).toEqual([
        { name: 'encrypt', value: state.boundFrame },
        { name: 'sign', value: encrypted },
        { name: 'verify', value: signed },
        { name: 'decrypt', value: encrypted }
      ])
      expect(String(state.boundFrame).startsWith(RpcAuthenticationEnvelope.prefix)).toBe(true)
    } finally {
      state.armed = false
      await client.host.close()
    }
  } finally {
    await server.close()
  }
})
