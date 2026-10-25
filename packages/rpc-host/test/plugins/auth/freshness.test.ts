/** Signed captured traffic cannot reconstruct a fresh source in the same installed Auth owner. */
import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { probe } from '@migaia/rpc-host/plugins/probe'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { RpcProbeDirection, type IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { MemoryCarrier } from '../../fixtures/core-carrier.js'
import { coreMemoryServer } from '../../host/core-fixture.js'

/** Public test data signs complete Auth transform inputs; this is not a deployed credential. */
const signingKey = 'auth-source-freshness-public-fixture'

/** Real HMAC callbacks protect the existing Auth wrapper without parsing semantic or native frames. */
function authentication() {
  return auth({
    sign: (value) => ({
      value,
      signature: createHmac('sha256', signingKey).update(JSON.stringify(value)).digest('hex')
    }),
    verify: (value) => {
      /** Only the real HMAC signer can produce the original protected input. */
      const signed = value as { value: unknown; signature: string }
      expect(signed.signature).toBe(
        createHmac('sha256', signingKey).update(JSON.stringify(signed.value)).digest('hex')
      )
      return signed.value
    }
  })
}

it('rejects a captured signed handshake and call after the original physical source retires', async () => {
  /** All connections borrow the same installed receiver Auth and real selected JSON codec. */
  const server = coreMemoryServer('server', 'server', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** Only genuine provider entry changes this observation. */
  let providerCalls = 0
  /** Probe capture lends the original physical frames; no second encoder or handshake is built. */
  const captured: IRpcCarrierFrame[] = []
  /** The public host owns its one Auth installation throughout retirement and reconstruction. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [authentication(), ...server.options.plugins],
    provide: {
      echo: (value) => {
        providerCalls += 1
        return value
      }
    }
  })
  /** Both genuine public callers are finally-owned even if their native opening rejects. */
  let first: Awaited<ReturnType<typeof server.connect>> | undefined
  /** A new native source can deliver only captured bytes; it has no signing callback or Host. */
  const receiver = new MemoryCarrier(
    'captured-receiver',
    undefined,
    new RpcJsonCarrierCodec(),
    false
  )
  const sender = new MemoryCarrier('captured-sender', undefined, new RpcJsonCarrierCodec(), false)
  receiver.link(sender)
  sender.link(receiver)
  /** A successful fresh control is retained only for normal final cleanup. */
  let fresh: Awaited<ReturnType<typeof server.connect>> | undefined
  try {
    /** Sender capture is active before the original source's first physical hello. */
    first = await server.connect('caller', {
      plugins: [
        authentication(),
        probe({
          stages: ['carrier'],
          capture: ['carrier'],
          emit: (event) => {
            if (event.direction === RpcProbeDirection.outbound)
              captured.push(event.content as IRpcCarrierFrame)
          }
        })
      ]
    })
    expect(await first.host.memory.send('server', 'echo', 'original')).toBe('original')
    /** Retire the real accepted receipt before reconstructing the physical route. */
    const original = server.lookup('caller')!
    await first.host.close()
    await original.handle.closed
    /** The receiver creates its new local challenge inside the same real native attach. */
    const accepted = server.accept(receiver)
    /** Observe handshake rejection before replay delivery can reject the original ready promise. */
    const rejected = accepted.ready.catch((error: unknown) => error)
    for (const frame of captured) await sender.write(frame)
    expect(await rejected).toMatchObject({ source: 'rpc.endpoint', code: 'AUTHENTICATION_FAILED' })
    expect(providerCalls).toBe(1)
    await accepted.closed
    /** Genuine new signing callbacks can answer the new receiver challenge on the same Host. */
    fresh = await server.connect('caller', { plugins: [authentication()] })
    expect(await fresh.host.memory.send('server', 'echo', 'fresh')).toBe('fresh')
    expect(providerCalls).toBe(2)
  } finally {
    await sender.close()
    await Promise.all([first?.host.close(), fresh?.host.close(), host.close()])
  }
})

it('publishes only an explicit authenticated principal on the actual accepted Session', async () => {
  /** One fixture owns credentials shared by the actual verifier and its two genuine clients. */
  const identity = {
    credential: 'principal-token',
    legacyCredential: 'legacy-token',
    principalId: 'verified-principal'
  }
  /** The verifier's original results are local trusted outputs, not peer names or wire claims. */
  const server = coreMemoryServer('principal-server')
  /** One Auth installation admits both an explicit identity and an old ignored string return. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      auth({
        verifyCredentials: (value) => {
          if (value === identity.credential) return { principalId: identity.principalId }
          if (value === identity.legacyCredential) return 'old-debug-return'
          throw new Error('unrecognized principal fixture credential')
        }
      }),
      ...server.options.plugins
    ],
    provide: { echo: (value) => value }
  })
  /** These actual public Hosts are owned by the same final cleanup regardless of assertion failure. */
  const clients: Awaited<ReturnType<typeof server.connect>>[] = []
  try {
    /** Native identity and authentication identity deliberately have distinct literal values. */
    const authenticated = await server.connect('wire-name', {
      plugins: [auth({ credentials: identity.credential })]
    })
    clients.push(authenticated)
    expect(server.lookup('wire-name')?.view.authentication).toEqual({
      principalId: identity.principalId,
      sessionId: authenticated.pair[0].id
    })
    expect(await authenticated.host.memory.send('principal-server', 'echo', 42)).toBe(42)
    /** A string return remains ignored and cannot silently grant a new principal. */
    const legacy = await server.connect('legacy-name', {
      plugins: [auth({ credentials: identity.legacyCredential })]
    })
    clients.push(legacy)
    expect(server.lookup('legacy-name')?.view.authentication).toBeUndefined()
    expect(await legacy.host.memory.send('principal-server', 'echo', 42)).toBe(42)
  } finally {
    await Promise.all([...clients.map((client) => client.host.close()), host.close()])
  }
})
