/** Maps only outbound errors while public local diagnostics retain their original identities. */
import { expect, it, vi } from 'vitest'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { errorMapFeature, type IRpcErrorMap } from '@migaia/rpc-host/plugins/error-map'
import { defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { reachRpcError, RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deserializeRpcWireError } from '@migaia/rpc-contract/protocol'
import type { IRpcFlowContext, IRpcTransportContext } from '@migaia/rpc-contract/interfaces'
import { deferred } from '@migaia/utils/promise'
import { coreMemoryServer } from '../../host/core-fixture.ts'
import { MemoryCarrier } from '../../fixtures/core-carrier.ts'

it.each([false, true])(
  'maps a public business failure while logger and report retain the original error, logger first %s',
  async (loggerFirst) => {
    /** This exact provider-owned graph is never replaced in local diagnostics. */
    const cause = new Error('private business cause')
    const primary = new RpcError(RpcCoreErrorCode.internal, 'private business failure', cause)
    /** The mapped public error intentionally contains no reference to the original graph. */
    const mapped = new RpcError(RpcCoreErrorCode.internal, 'public mapped failure')
    /** Reports remain a separate original-error channel from readonly SDK observation. */
    const reports: unknown[] = []
    /** A real SDK subscriber receives actual provider event diagnostics without a logger framework. */
    const logged: unknown[] = []
    const logger = defineFlowPlugin({
      name: 'a32-business-logger',
      setup: () => ({
        observe(event) {
          /** Only events that carry the genuine local failure belong to this observation. */
          const error = (event.data as { error?: unknown } | undefined)?.error
          if (error !== undefined) logged.push(error)
        }
      })
    })
    /** The actual outbound slot must lend the original error and admitted physical context. */
    const map = vi.fn<IRpcErrorMap>((error: unknown, context: IRpcFlowContext) => {
      expect(error).toBe(primary)
      expect(context).toMatchObject({ namespace: 'memory', direction: 'outbound' })
      return mapped
    })
    const mapping = errorMapFeature(map)
    /** Credentials-only authentication keeps real semantic wire errors observable on this medium. */
    const listener = coreMemoryServer('mapped-provider')
    const host = await createRpcHost({
      ...listener.options,
      plugins: [
        ...(loggerFirst ? [logger, mapping] : [mapping, logger]),
        authFeature({ verifyCredentials: () => ({ principalId: 'a32-client' }) }),
        listener.transport
      ],
      provide: {
        fail: () => {
          throw primary
        }
      },
      report: (error) => reports.push(error)
    })
    /** Only this public caller receives the deliberately mapped remote graph. */
    const client = await listener.connect('mapped-client', {
      plugins: [authFeature({ credentials: 'a32-public-fixture' })]
    })
    try {
      const received = await client.host.memory
        .send('mapped-provider', 'fail')
        .catch((error: unknown) => error)
      expect(received).toMatchObject({
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.internal,
        message: mapped.message,
        stack: mapped.stack
      })
      expect((received as Error).cause).toBeUndefined()
      await vi.waitFor(() => expect(reports).toEqual([primary]))
      expect(logged).toEqual([primary])
      expect(map).toHaveBeenCalledTimes(1)
      /**
       * This is the actual physical terminal supplied by the real native carrier, not another
       * encode.
       */
      const terminal = client.pair[0].written.find((frame) => frame.kind === 'error')
      if (terminal?.kind !== 'error') expect.fail('expected actual mapped error terminal')
      expect(deserializeRpcWireError(terminal.error)).toMatchObject({
        message: mapped.message,
        stack: mapped.stack
      })
      expect(JSON.stringify(terminal.error)).not.toContain(cause.message)
      expect(primary.cause).toBe(cause)
    } finally {
      await Promise.all([client.host.close(), host.close()])
    }
  }
)

it('selects a transport-local mapper only for that namespace and inherits the host mapper elsewhere', async () => {
  /** Both namespaces throw the same genuine local primary so selection is the only changing input. */
  const primary = new RpcError(RpcCoreErrorCode.internal, 'namespace private failure')
  /** Explicit public mappings remain distinct without changing their original semantic code. */
  const shared = new RpcError(RpcCoreErrorCode.internal, 'host mapping')
  const local = new RpcError(RpcCoreErrorCode.internal, 'local mapping')
  /** Real mapper calls expose exact selected placement and the original error identity. */
  const sharedMap = vi.fn<IRpcErrorMap>((error: unknown) => {
    expect(error).toBe(primary)
    return shared
  })
  const localMap = vi.fn<IRpcErrorMap>((error: unknown) => {
    expect(error).toBe(primary)
    return local
  })
  /** The first native transport owns the local override; the second inherits host selection. */
  const first = coreMemoryServer('mapping-scopes', 'mapping-scopes', 'first', [
    errorMapFeature(localMap)
  ])
  const second = coreMemoryServer('mapping-scopes', 'mapping-scopes', 'second')
  /** The public root prepares the one shared mapper through the original native Feature owner. */
  const host = await createRpcHost({
    ...first.options,
    plugins: [errorMapFeature(sharedMap), first.transport, second.transport],
    provide: {
      fail: () => {
        throw primary
      }
    },
    report: () => undefined
  })
  const a = await first.connect('first-client')
  const b = await second.connect('second-client')
  try {
    await expect(a.host.first.send('mapping-scopes', 'fail')).rejects.toMatchObject({
      message: local.message
    })
    await expect(b.host.second.send('mapping-scopes', 'fail')).rejects.toMatchObject({
      message: shared.message
    })
    expect(localMap).toHaveBeenCalledTimes(1)
    expect(sharedMap).toHaveBeenCalledTimes(1)
  } finally {
    await Promise.all([a.host.close(), b.host.close(), host.close()])
  }
})

it.each(['none', 'throw'] as const)(
  'sends the original full graph on an authenticated Session with mapper mode %s',
  async (mode) => {
    /** The original provider failure and cause remain intact before any optional outbound map. */
    const cause = new TypeError('fallback cause')
    const primary = new RpcError(RpcCoreErrorCode.internal, 'fallback primary', cause)
    /** Mapper failure has its own exact identity and never becomes the remote business failure. */
    const mapperFailure = new RangeError('mapper failed')
    const reports: unknown[] = []
    const map = vi.fn<IRpcErrorMap>((error: unknown) => {
      expect(error).toBe(primary)
      throw mapperFailure
    })
    /** A real accepted principal proves the full-graph default is an authenticated business path. */
    const listener = coreMemoryServer('fallback-provider')
    const host = await createRpcHost({
      ...listener.options,
      plugins: [
        ...(mode === 'none' ? [] : [errorMapFeature(map)]),
        authFeature({ verifyCredentials: () => ({ principalId: 'fallback-client' }) }),
        listener.transport
      ],
      provide: {
        fail: () => {
          throw primary
        }
      },
      report: (error) => reports.push(error)
    })
    const client = await listener.connect('fallback-client', {
      plugins: [authFeature({ credentials: 'a32-public-fixture' })]
    })
    try {
      expect(listener.lookup('fallback-client')?.view.authentication?.principalId).toBe(
        'fallback-client'
      )
      await expect(client.host.memory.send('fallback-provider', 'fail')).rejects.toMatchObject({
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.internal,
        message: primary.message,
        stack: primary.stack,
        cause: { name: cause.name, message: cause.message, stack: cause.stack }
      })
      await vi.waitFor(() =>
        expect(reports).toEqual(mode === 'none' ? [primary] : [mapperFailure, primary])
      )
      expect(map).toHaveBeenCalledTimes(mode === 'none' ? 0 : 1)
      expect(primary.cause).toBe(cause)
    } finally {
      await Promise.all([client.host.close(), host.close()])
    }
  }
)

it('falls back to the original remote error and reports one mapped serialization failure', async () => {
  /** The original provider graph remains available even when the mapper's replacement is unreadable. */
  const cause = new TypeError('original serialization fallback cause')
  const primary = new RpcError(RpcCoreErrorCode.internal, 'original serialization fallback', cause)
  /** This one native getter failure must remain reachable from the single serialization diagnostic. */
  const getterFailure = new Error('mapped message getter failed')
  /** Only serialization reads the hostile field; the mapper itself successfully returns this Error. */
  const selected = new Error('unreadable mapped error')
  Object.defineProperty(selected, 'message', {
    get() {
      throw getterFailure
    }
  })
  const map = vi.fn<IRpcErrorMap>(() => selected)
  /** Original provider reporting is counted separately from the one extra mapper diagnostic. */
  const reports: unknown[] = []
  const listener = coreMemoryServer('serialization-fallback-provider')
  const host = await createRpcHost({
    ...listener.options,
    plugins: [errorMapFeature(map), listener.transport],
    provide: {
      fail: () => {
        throw primary
      }
    },
    report: (error) => reports.push(error)
  })
  const client = await listener.connect('serialization-fallback-client')
  try {
    await expect(
      client.host.memory.send('serialization-fallback-provider', 'fail')
    ).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.internal,
      message: primary.message,
      stack: primary.stack,
      cause: { message: cause.message, stack: cause.stack }
    })
    await vi.waitFor(() => expect(reports).toHaveLength(2))
    expect(reports.filter((error) => error === primary)).toHaveLength(1)
    /**
     * The Host's canonical serializer retains its own coded wrapper and the original native getter
     * cause.
     */
    const diagnostic = reports.find((error) => error !== primary)
    expect(diagnostic).toMatchObject({
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.payloadInvalid
    })
    expect([
      ...reachRpcError(diagnostic, {
        report: (failure) => {
          throw failure.error
        }
      })
    ]).toContain(getterFailure)
    expect(map).toHaveBeenCalledTimes(1)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

it('rejects a returned Promise as configuration, sends the original error and reports its late rejection once', async () => {
  /**
   * The provider's original failure remains distinct from both mapper configuration and late
   * rejection.
   */
  const primary = new RpcError(RpcCoreErrorCode.internal, 'returned Promise fallback')
  const mapperFailure = new RangeError('late mapper rejection')
  /** Controlling this genuine Promise proves fallback happens before it settles. */
  const delayed = deferred<unknown>()
  const map = vi.fn((error: unknown) => {
    expect(error).toBe(primary)
    return delayed.promise
  })
  // @ts-expect-error A JavaScript callback can return a Promise; the public TypeScript mapper cannot.
  const mapping = errorMapFeature(map)
  /** Only the public provider increments this actual next-message business observation. */
  const echo = vi.fn((value: string) => value)
  const reports: unknown[] = []
  const listener = coreMemoryServer('promise-fallback-provider')
  const host = await createRpcHost({
    ...listener.options,
    plugins: [mapping, listener.transport],
    provide: {
      fail: () => {
        throw primary
      },
      echo
    },
    report: (error) => reports.push(error)
  })
  const client = await listener.connect('promise-fallback-client')
  /** This actual accepted handle must survive fallback and the following successful message. */
  const accepted = listener.lookup('promise-fallback-client')!.handle
  try {
    await expect(
      client.host.memory.send('promise-fallback-provider', 'fail')
    ).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.internal,
      message: primary.message,
      stack: primary.stack
    })
    expect(
      await client.host.memory.send('promise-fallback-provider', 'echo', 'after-promise')
    ).toBe('after-promise')
    expect(echo).toHaveBeenCalledTimes(1)
    expect(listener.lookup('promise-fallback-client')!.handle).toBe(accepted)
    await vi.waitFor(() => expect(reports).toHaveLength(2))
    expect(reports.filter((error) => error === primary)).toHaveLength(1)
    const configuration = reports.find((error) => error !== primary)
    expect(configuration).toMatchObject({
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.invalidConfig
    })
    /** Only a rejection observer remains attached; it reports this original late failure once. */
    delayed.reject(mapperFailure)
    await vi.waitFor(() => expect(reports).toHaveLength(3))
    expect(reports.filter((error) => error === mapperFailure)).toHaveLength(1)
    expect(reports.filter((error) => error === configuration)).toHaveLength(1)
    expect(map).toHaveBeenCalledTimes(1)
  } finally {
    delayed.resolve(undefined)
    await Promise.all([client.host.close(), host.close()])
  }
})

it('delivers the next message on the same Session without waiting for a never-settling mapper Promise', async () => {
  /**
   * This native provider failure is observed immediately even while the mapper Promise stays
   * pending.
   */
  const primary = new RpcError(RpcCoreErrorCode.internal, 'never-settling mapper fallback')
  /** This Promise is intentionally never resolved or rejected by the fixture. */
  const hanging = new Promise<never>(() => undefined)
  const map = vi.fn(() => hanging)
  // @ts-expect-error The runtime JavaScript misuse is deliberate; Promise returns fail the public mapper type.
  const mapping = errorMapFeature(map)
  const reports: unknown[] = []
  /**
   * Real business completion, rather than elapsed timing, proves the following message was
   * delivered.
   */
  const echo = vi.fn((value: string) => value)
  const listener = coreMemoryServer('nonblocking-mapper-provider')
  const host = await createRpcHost({
    ...listener.options,
    plugins: [mapping, listener.transport],
    provide: {
      fail: () => {
        throw primary
      },
      echo
    },
    report: (error) => reports.push(error)
  })
  const client = await listener.connect('nonblocking-mapper-client')
  const accepted = listener.lookup('nonblocking-mapper-client')!.handle
  /** Register rejection observation before the second public call enters the same original Session. */
  const first = Promise.allSettled([client.host.memory.send('nonblocking-mapper-provider', 'fail')])
  try {
    expect(
      await client.host.memory.send('nonblocking-mapper-provider', 'echo', 'after-never')
    ).toBe('after-never')
    expect(echo).toHaveBeenCalledTimes(1)
    expect(listener.lookup('nonblocking-mapper-client')!.handle).toBe(accepted)
    const [failure] = await first
    if (failure?.status !== 'rejected') expect.fail('expected original provider rejection')
    expect(failure.reason).toMatchObject({
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.internal,
      message: primary.message,
      stack: primary.stack
    })
    await vi.waitFor(() => expect(reports).toHaveLength(2))
    expect(reports.filter((error) => error === primary)).toHaveLength(1)
    expect(reports.find((error) => error !== primary)).toMatchObject({
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.invalidConfig
    })
    expect(map).toHaveBeenCalledTimes(1)
  } finally {
    await Promise.all([client.host.close(), host.close()])
    await first
  }
})

it.each(['verifier', 'resolver'] as const)(
  'preserves the original local %s error through a public transport construction rejection',
  async (mode) => {
    /** This same local native exception must stay reachable by identity, even with private text. */
    const primary = new Error(`local ${mode} credential cause`)
    const listener = coreMemoryServer('credential-cause-server')
    const host = await createRpcHost({
      ...listener.options,
      plugins: [
        authFeature({ credentials: 'a32-server', verifyCredentials: () => undefined }),
        listener.transport
      ]
    })
    try {
      /** Only the client's actual credential callback fails inside its real Session handshake. */
      const failure = await listener
        .connect('credential-cause-client', {
          plugins: [
            authFeature({
              credentials:
                mode === 'resolver'
                  ? () => {
                      throw primary
                    }
                  : 'a32-client',
              ...(mode === 'verifier'
                ? {
                    verifyCredentials: () => {
                      throw primary
                    }
                  }
                : {})
            })
          ]
        })
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'AUTHENTICATION_FAILED' })
      expect((failure as Error).cause).toBe(primary)
    } finally {
      await host.close()
    }
  }
)

it('keeps an unauthenticated wire rejection redacted while the local verifier cause remains original', async () => {
  /** A unique local credential-bearing error distinguishes local retention from wire disclosure. */
  const primary = new Error('pre-auth credential detail')
  /** The original memory media expose the exact real rejection written before authentication. */
  const pair = [
    new MemoryCarrier('redaction-server'),
    new MemoryCarrier('redaction-client')
  ] as const
  pair[0].link(pair[1])
  pair[1].link(pair[0])
  /** The receiving public root owns the rejecting verifier and original accepted-source lifetime. */
  const listener = coreMemoryServer('redaction-server')
  const host = await createRpcHost({
    ...listener.options,
    plugins: [
      authFeature({
        verifyCredentials() {
          throw primary
        }
      }),
      listener.transport
    ]
  })
  /** The server's real local ready rejection remains separate from the remote client's result. */
  let local: Promise<unknown> | undefined
  /** Unexpected successful construction still releases the actual native client root. */
  let client: Pick<IRpcHost, 'close'> | undefined
  /**
   * Only the genuine SDK attachment starts either Session; no handshake or rejection is
   * synthesized.
   */
  const open = async (context: IRpcTransportContext) => {
    local = listener.accept(pair[0]).ready.catch((error: unknown) => error)
    await context.attach(pair[1]).ready
    return { dispose() {} }
  }
  try {
    await expect(
      createRpcHost({
        self: { name: 'redaction-client', instanceId: 'redaction-client' },
        plugins: [
          authFeature({ credentials: 'a32-untrusted-token' }),
          defineTransportPlugin({ name: 'redaction-client', namespace: 'memory', open })
        ],
        report: () => undefined
      }).then((created) => {
        client = created
      })
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(((await local) as Error).cause).toBe(primary)
    /** This is the actual original physical reject, observed without a second decoder. */
    const rejected = pair[0].written.find(
      (frame) => frame.kind === 'handshake' && frame.step === 'reject'
    )
    if (rejected?.kind !== 'handshake' || rejected.step !== 'reject')
      expect.fail('expected actual pre-auth rejection')
    const remote = deserializeRpcWireError(rejected.error)
    expect(remote).toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    expect(remote.cause).toBeUndefined()
    expect(JSON.stringify(rejected)).not.toContain(primary.message)
    expect(JSON.stringify(rejected)).not.toContain('a32-untrusted-token')
  } finally {
    await Promise.all([client?.close(), host.close(), ...pair.map((carrier) => carrier.close())])
    await local
  }
})
