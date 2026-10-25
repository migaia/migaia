import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { RPC_CORE_ERROR_SOURCE, RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { walkErrorCauses } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { coreMemoryServer } from '../../host/core-fixture.js'
import { createRpcAuthenticationError } from '../../../dist/host/error-owner.js'

it('hostile outbound authentication preserves native source/code/cause identity', async () => {
  /** The exact original callback failure must remain the public authentication error's cause. */
  const hostile = new Error('outbound encrypt failed')
  /** Canonical v2 negotiation completes before the original business-write failure is armed. */
  const state = { armed: false }
  /** Both original physical endpoints borrow the executing SDK JSON codec, without a new codec. */
  const listener = coreMemoryServer('target', 'target', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The actual remote directory advertises the original target method through the public Host. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [auth({ sign: (value) => value, verify: (value) => value }), listener.transport],
    provide: { method: (value) => value }
  })
  try {
    /** The public auth plugin owns the original throwing encrypt callback and its error boundary. */
    const client = await listener.connect('hostile-auth-client', {
      plugins: [
        auth({
          encrypt: (value) => {
            if (state.armed) throw hostile
            return value
          },
          decrypt: (value) => value,
          sign: (value) => value,
          verify: (value) => value
        })
      ]
    })
    try {
      state.armed = true
      /** One real request reaches prepare, the installed auth hook and the actual local failure. */
      const pending = client.host.memory.send('target', 'method', 'data', { timeout: false })
      await expect(pending).rejects.toMatchObject({
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.authenticationFailed,
        cause: hostile
      })
      /** Preserve native object identity rather than merely comparing a serialized error shape. */
      const failure = await pending.catch((error: unknown) => error)
      expect((failure as Error).cause).toBe(hostile)
    } finally {
      state.armed = false
      await client.host.close()
    }
  } finally {
    await server.close()
  }
})

it.each(['throws synchronously', 'rejects asynchronously', 'returns an invalid encoded value'])(
  'classifies original outbound authentication that %s before any physical write',
  async (label) => {
    /** The original throwing and rejecting callbacks must retain this exact causal Error. */
    const cause = new Error(`authentication ${label}`)
    /** Real bilateral ready completes before the original one-shot business failure is armed. */
    const state = { armed: false }
    /** The actual JSON media codec supplies strings to the installed explicit-string transform. */
    const listener = coreMemoryServer('outbound-auth-provider', undefined, 'memory', [], [], {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    })
    /** The peer owns normal authentication and its genuine public method directory. */
    const server = await createRpcHost({
      ...listener.options,
      plugins: [
        auth({ encodedType: 'string', sign: (value) => value, verify: (value) => value }),
        listener.transport
      ],
      provide: { read: () => 42 }
    })
    try {
      /** Only the public authentication plugin executes the original protect failure conditions. */
      const client = await listener.connect('outbound-auth-client', {
        plugins: [
          auth({
            encodedType: 'string',
            sign: (value) => {
              if (!state.armed) return value
              if (label === 'throws synchronously') throw cause
              if (label === 'rejects asynchronously') return Promise.reject(cause)
              return 42
            },
            verify: (value) => value
          })
        ]
      })
      /** The actual client sender remains a passthrough spy after normal handshake traffic. */
      const writing = vi.spyOn(client.pair[1], 'write')
      try {
        state.armed = true
        /** Namespace request observes the auth failure before the original codec/native handoff. */
        const thrown = await client.host.memory.request('read').then(
          () => undefined,
          (error: unknown) => error
        )
        expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
        if (label !== 'returns an invalid encoded value')
          expect((thrown as { cause: unknown }).cause).toBe(cause)
        expect(writing).toHaveBeenCalledTimes(0)
      } finally {
        state.armed = false
        writing.mockRestore()
        await client.host.close()
      }
    } finally {
      await server.close()
    }
  }
)

it('keeps the original locally owned authentication failure identity through a public request', async () => {
  /**
   * Reuse the original canonical factory input; the public constructor does not mint local
   * ownership.
   */
  const authenticationError = createRpcAuthenticationError('authentication failure')
  /** Only the original business protect callback rejects, after real handshake admission. */
  const state = { armed: false }
  /** The existing JSON codec and native fixture retain the same ordinary physical connection. */
  const listener = coreMemoryServer('owned-auth-provider', undefined, 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The peer installs the same real authentication flow and public method directory. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [auth({ sign: (value) => value, verify: (value) => value }), listener.transport],
    provide: { read: () => 42 }
  })
  try {
    /** Original factory-minted Error enters the real public hook rather than a private sender call. */
    const client = await listener.connect('owned-auth-client', {
      plugins: [
        auth({
          sign: (value) => (state.armed ? Promise.reject(authenticationError) : value),
          verify: (value) => value
        })
      ]
    })
    try {
      state.armed = true
      /** Preserve the exact original code and Error identity, without constructing a second failure. */
      const thrown = await client.host.memory.request('read').then(
        () => undefined,
        (error: unknown) => error
      )
      expect(thrown).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
      expect(thrown).toBe(authenticationError)
    } finally {
      state.armed = false
      await client.host.close()
    }
  } finally {
    await server.close()
  }
})

it('preserves the original authentication configuration getter cause at the public factory', () => {
  /** The original unreadable configuration throws this same caller-owned Error on its first read. */
  const hostile = new Error('authentication hostile config getter')
  /** The supported public factory must classify an unreadable options object without losing cause. */
  const config = new Proxy(
    {},
    {
      get() {
        throw hostile
      }
    }
  )
  /** Configuration capture now runs at the public factory rather than inside an old native role. */
  let primary: unknown
  try {
    auth(config as never)
  } catch (error) {
    primary = error
  }
  expect(primary).toBeInstanceOf(RpcError)
  expect(primary).toMatchObject({ code: RpcCoreErrorCode.invalidConfig })
  expect((primary as Error).cause).toBe(hostile)
  expect(walkErrorCauses(primary).includes(hostile)).toBe(true)
})

it('preserves the original inbound decrypt failure through the public authentication report', async () => {
  /** This exact original callback failure must survive the actual inbound authentication boundary. */
  const hostile = new Error('authentication unprotect hostile transform')
  /** Genuine ready handshakes finish before the application decrypt failure is armed. */
  const state = { armed: false }
  /** The public reporter supplies a barrier for this original native failure, without fixed sleeps. */
  const observed = deferred<unknown>()
  /** Both real endpoints use the existing executing JSON codec and physical MemoryCarrier pair. */
  const listener = coreMemoryServer('inbound-auth-provider', undefined, 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The public Auth plugin owns verification, decryption and the resulting classified failure. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [
      auth({
        encrypt: (value) => value,
        sign: (value) => value,
        verify: (value) => value,
        decrypt: (value) => {
          if (state.armed) throw hostile
          return value
        }
      }),
      listener.transport
    ],
    provide: { read: () => 42 },
    report: (error) => {
      if (walkErrorCauses(error).includes(hostile)) observed.resolve(error)
    }
  })
  try {
    /** A normal authenticated caller supplies genuine protected metadata to the failing decryptor. */
    const client = await listener.connect('inbound-auth-client', {
      plugins: [auth({ sign: (value) => value, verify: (value) => value })]
    })
    try {
      state.armed = true
      /** Observe caller settlement while the public reporter retains the original hook failure. */
      const pending = client.host.memory
        .send('inbound-auth-provider', 'read', null, {
          timeout: false
        })
        .catch((error: unknown) => error)
      /** Inbound pre-admission rejection is reported without inventing an authenticated reply. */
      const failure = await observed.promise
      expect(failure).toMatchObject({ code: 'AUTHENTICATION_FAILED', cause: hostile })
      expect(walkErrorCauses(failure).includes(hostile)).toBe(true)
      await pending
    } finally {
      state.armed = false
      await client.host.close()
    }
  } finally {
    await server.close()
  }
})
