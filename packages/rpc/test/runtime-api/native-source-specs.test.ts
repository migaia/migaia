import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { runtimeTestHost } from './fixture.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createEndpoint } from '../../src/core/index.js'
import type { IRpcEndpoint, IRpcProvider } from '../../src/core/typing.js'
import { createRuntimeApiEndpoint } from '../../src/core/internal/runtime-api-endpoint.js'
import { abort } from '../../src/core/middleware/abort.js'
import { codec } from '../../src/core/middleware/codec.js'
import { framer } from '../../src/core/middleware/framer.js'
import { connect } from '../../src/core/middleware/connect.js'
import { ping } from '../../src/core/middleware/ping.js'
import { createProcessPeer, createProcessPlugin } from '../../src/process/index.js'
import { createThreadPeer } from '../../src/threads/index.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import type { IProcessServeListenerIngress } from '../../src/process/plugin/types.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../src/remote/types.js'
import type { IRuntimePeer, IRuntimePeerSourceResult } from '../../src/remote/runtime-api/peer.js'
import { RUNTIME_API_CAPABILITIES } from '../../src/remote/runtime-api/constants.js'

/** Native endpoints keep the actual negotiated codec, frame owner and IPC Features. */
async function baselineEndpoint(
  channel: IRemoteChannel,
  id: string,
  provider?: Record<string, IRpcProvider>
) {
  /** The selected middleware roots exist before the original deferred receiver is activated. */
  const endpoint = (await createEndpoint({
    id,
    targetIds: [channel.peerId],
    transport: channel.transport,
    provider,
    features: [channel.features[0]!, channel.features[1]!] as const,
    middlewares: [
      codec(channel.pipeline.codec),
      framer(channel.pipeline.framer),
      abort(),
      connect({ transport: channel.transport }),
      ping()
    ]
  })) as unknown as IRpcEndpoint
  ;(channel as IRuntimePeerSourceResult).activateReceive?.()
  return endpoint
}

/** Prove ordinary authenticated native socket business before testing the missing public grammar. */
async function ordinaryNativeSocket(checkIdentity = false): Promise<void> {
  /** Server construction resolves only after the real authenticated channel and provider exist. */
  let ready!: (endpoint: IRpcEndpoint) => void
  /** Preparation failures must reject this fixture rather than hang or count as business RED. */
  let rejectReady!: (error: unknown) => void
  /** One actual server endpoint is retained for exact cleanup. */
  const prepared = new Promise<IRpcEndpoint>((resolve, reject) => {
    ready = resolve
    rejectReady = reject
  })
  /** Observe early startup rejection immediately while preserving it as the awaited primary. */
  const settled = prepared.then(
    (endpoint) => ({ endpoint }),
    (error: unknown) => ({ error })
  )
  /** Both channels own only their genuine accepted/dialed physical socket. */
  let serverChannel: IRemoteChannel | undefined
  /** The baseline caller never owns the server process. */
  let clientChannel: IRemoteChannel | undefined
  /** The native caller endpoint exists independently of the new public source grammar. */
  let client: IRpcEndpoint | undefined
  /** One bounded loopback rendezvous uses no filesystem path or external service. */
  const listener = await listenProcessByteChannel({
    address: 'tcp://127.0.0.1:0',
    auth: {
      mode: 'required',
      verify: (auth) => {
        assert.equal(auth, 'source-fixture-token')
        return 'baseline-principal'
      }
    },
    report: rejectReady,
    onConnection: async (pending) => {
      try {
        const accepted = await pending.accept({
          offer: createNativeProcessOffer({
            peer: { id: 'baseline-server', runtime: 'node' },
            ...(checkIdentity ? { capabilities: RUNTIME_API_CAPABILITIES } : {})
          }),
          peerId: checkIdentity ? 'untrusted-before-authentication' : 'baseline-client',
          ipc: {
            connectionId: 'baseline-server-connection',
            sessionId: 'baseline-server-session',
            log: () => undefined
          },
          report: rejectReady
        })
        serverChannel = accepted.channel
        if (checkIdentity)
          assert.equal(
            serverChannel.peerId,
            'baseline-client',
            '[A2] runtime listener identity comes from the authenticated hello rather than a pre-authentication placeholder'
          )
        ready(
          await baselineEndpoint(serverChannel, 'baseline-server', {
            echo: (context) => context.success(42)
          })
        )
      } catch (error) {
        rejectReady(error)
      }
    }
  })
  try {
    const raw = await dialProcessByteChannel({ address: listener.address })
    clientChannel = await createProcessTransport(raw, {
      role: 'initiator',
      offer: createNativeProcessOffer({
        peer: { id: 'baseline-client', runtime: 'node' },
        auth: 'source-fixture-token',
        ...(checkIdentity ? { capabilities: RUNTIME_API_CAPABILITIES } : {})
      }),
      peerId: 'baseline-server',
      ipc: {
        connectionId: 'baseline-client-connection',
        sessionId: 'baseline-client-session',
        log: () => undefined
      },
      report: rejectReady
    })
    client = await baselineEndpoint(clientChannel, 'baseline-client')
    /** Authentication or construction failure stays distinct from the baseline business assertion. */
    const result = await settled
    if ('error' in result) throw result.error
    assert.equal(await client.send('baseline-server', 'echo', 'ordinary'), 42)
  } finally {
    await client?.dispose()
    /** Failed preparation acquired no endpoint; successful preparation is disposed exactly once. */
    const result = await settled
    if ('endpoint' in result) await result.endpoint.dispose()
    await clientChannel?.close()
    await serverChannel?.close()
    await listener.close()
  }
}

it('[A2][A16] runtime byte identity is the actual authenticated peer before ready publication', async () => {
  await ordinaryNativeSocket()
  await ordinaryNativeSocket(true)
})

it('[A2][A9][A16][A18][A33] full authenticated listener publishes its actual sessions through the original shared slot', async () => {
  await ordinaryNativeSocket()
  /** Real Host Feature authority is established before the public listener assertion. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Actual listener bind reports the OS-selected loopback address. */
  let address = ''
  /** One original accepted-session context has a distinct local IPC identity. */
  let sequence = 0
  /** Notify completion is independently observed at each actual remote provider. */
  const notifications = [0, 0]
  /** Session preparation failures retain their original code and cause instead of being swallowed. */
  const failures: unknown[] = []
  /** A deliberately held real provider exposes whether the selected core limit was retained. */
  let started = 0
  /** One canonical refusal notification distinguishes concurrency from other OVERLOADED branches. */
  let rejected = 0
  /** Every entered provider settles before physical session cleanup. */
  let release!: () => void
  /** Business completion is controlled by the fixture, without replacing native admission. */
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  /** Rejections are observed immediately so fixture cleanup cannot produce an unhandled Promise. */
  const calls: Promise<unknown>[] = []
  /** Only the genuine client Peer owns its local connection and supervision. */
  const clients: IRuntimePeer[] = []
  /** The original listener grammar includes principal verification and per-session contexts. */
  const ingress: IProcessServeListenerIngress = {
    kind: 'listener',
    address: 'tcp://127.0.0.1:0',
    listen: async (options) => {
      const listener = await listenProcessByteChannel(options)
      address = listener.address
      return listener
    },
    verify: (auth) => {
      assert.equal(auth, 'source-fixture-token')
      return 'source-principal'
    },
    offer: createNativeProcessOffer({
      peer: { id: 'source-server', runtime: 'node' },
      capabilities: RUNTIME_API_CAPABILITIES
    }),
    createConnectionContext: () => ({
      peerId: `client-${++sequence}`,
      ipc: {
        connectionId: `accepted-${sequence}`,
        sessionId: `session-${sequence}`,
        log: () => undefined
      }
    })
  }
  try {
    const [parent] = await host.use(
      definePlugin({
        name: 'parent',
        features: {
          data: defineFeature(() => ({
            echo: () => 42,
            hold: () => {
              started += 1
              return held.then(() => 42)
            }
          }))
        },
        install: () => ({})
      })
    )
    assert.equal(parent.getFeature('data').echo(), 42)
    /** A listener's original offer supplies local identity when the optional self is omitted. */
    const options = {
      name: 'listener',
      listen: ingress,
      expose: ['parent'],
      providerLimits: {
        maxPerPeer: 1,
        onRejected: (rejection: { reason: string }) => {
          assert.equal(rejection.reason, 'concurrency')
          rejected += 1
        }
      },
      report: (error: unknown) => failures.push(error)
    }
    const installed = await host.use(createProcessPlugin(options)).then(
      () => true,
      (error: unknown) => error
    )
    assert.equal(
      installed,
      true,
      '[A2] full native listener grammar installs after ordinary authenticated socket business'
    )
    /** No accepted session exists yet; the actual listener still owns one committed cold record. */
    const empty = await host.process!.list({ filter: { kind: 'listen', direction: 'listen' } })
    assert.equal(empty.connections.length, 1, '[A41] a zero-session listener remains queryable')
    assert.equal((await host.process!.get('listener')).kind, 'listen')
    await assert.rejects(host.process!.get('client-1'), { code: 'TARGET_UNKNOWN' })
    for (const command of ['stop', 'kill', 'restart', 'replace'] as const)
      assert.throws(() => host.process![command]('listener'), { code: 'CAPABILITY_CONFLICT' })
    for (const index of [0, 1]) {
      const peer = await createProcessPeer<IRuntimeDynamicSurface>({
        self: { name: 'same-client', instanceId: `client-${index + 1}` },
        provide: {
          child: {
            echo: () => index + 1,
            note: () => {
              notifications[index]! += 1
            }
          }
        },
        connect: {
          kind: 'connect',
          address,
          token: 'source-fixture-token',
          dial: (path, signal) =>
            dialProcessByteChannel({ address: path, signal: signal as AbortSignal }),
          establish: (raw, options) => {
            assert.equal(raw.kind, 'byte')
            if (raw.kind !== 'byte') assert.fail()
            return createProcessTransport(raw, {
              role: 'initiator',
              offer: options.offer!,
              peerId: 'source-server',
              scheduler: options.scheduler,
              signal: options.signal as AbortSignal,
              ipc: { ...options.session, log: () => undefined },
              report: () => undefined
            })
          }
        },
        report: () => undefined
      })
      clients.push(peer)
      assert.equal(await peer.request('parent.echo'), 42)
      await vi.waitFor(async () => {
        assert.deepEqual(failures, [], '[A2] accepted native sessions have no preparation failure')
        assert.equal(await host.process!.request(`client-${index + 1}`, 'child.echo'), index + 1)
      })
    }
    /** A cold list must retain both genuine listener sessions without choosing a business winner. */
    const overview = await host.process!.list()
    assert.equal(
      overview.connections.length,
      2,
      '[A24] listener overview contains both real accepted sessions'
    )
    assert.deepEqual(
      overview.connections.map((connection) => [connection.kind, connection.direction]),
      [
        ['listen', 'listen'],
        ['listen', 'listen']
      ]
    )
    await assert.rejects(host.process!.get('listener'), { code: 'CAPABILITY_CONFLICT' })
    assert.deepEqual((await host.process!.get('client-1')).identity, {
      name: 'same-client',
      instanceId: 'client-1'
    })
    assert.throws(
      () => host.process!.request('listener', 'child.echo'),
      (error: { code?: string }) => error.code === 'CAPABILITY_CONFLICT'
    )
    assert.equal(
      (await host.process!.broadcast('child.note')).length,
      2,
      '[A18] ambiguous logical name does not remove actual ready instances from broadcast'
    )
    await vi.waitFor(() => assert.deepEqual(notifications, [1, 1]))
    calls.push(
      clients[0]!.request('parent.hold').then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
    )
    await vi.waitFor(() => assert.equal(started, 1))
    calls.push(
      clients[0]!.request('parent.hold').then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
    )
    await vi.waitFor(() => assert.equal(started === 2 || rejected === 1, true))
    assert.equal(
      started,
      1,
      '[A9] full listener retains the selected provider limit before admitting a second call'
    )
    assert.equal(
      rejected,
      1,
      '[A9] canonical concurrency reason reaches the selected observer once'
    )
    release()
    /** Only the actual refused second native call carries OVERLOADED. */
    const second = (await calls[1]!) as { error: { code: string } }
    assert.equal(second.error.code, 'OVERLOADED')
    assert.deepEqual(await calls[0], { value: 42 })
    await clients[0]!.close()
    /** Wait through the existing local query; sending while the slot is still live is real business. */
    await vi.waitFor(async () =>
      assert.equal(
        (await host.process!.list()).connections.some(
          (entry) => 'instanceId' in entry.identity && entry.identity.instanceId === 'client-1'
        ),
        false
      )
    )
    assert.throws(
      () => host.process!.request('client-1', 'child.echo'),
      (error: { code?: string }) => error.code === 'TARGET_UNKNOWN'
    )
    assert.equal(await host.process!.request('client-2', 'child.echo'), 2)
  } finally {
    release()
    await Promise.all(calls)
    for (const peer of clients) await peer.close()
    await host.dispose()
  }
})

it('[A9][A33] full owned Worker source uses the caller-selected original endpoint factory before registering runtime routes', async () => {
  /** The child is a real dedicated Worker that executes forward and reverse business. */
  const entry = fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url))
  /** Original unit admission limits the fixture to one owned native execution. */
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  /** The explicit factory invocation is observed at the original construction boundary. */
  let constructed = 0
  /** Only cold provider registration is observed; no production diagnostic hook is added. */
  const registered: string[] = []
  /** Exact native ownership is closed even when the product discriminator remains red. */
  let peer: IRuntimePeer | undefined
  try {
    const options = {
      self: { name: 'custom-parent', instanceId: 'custom-parent' },
      provide: { parent: { echo: () => 42 } },
      report: () => undefined,
      spawn: {
        spec: { entry, name: 'custom-child' },
        budget,
        scheduler: systemScheduler,
        launcher: createNodeThreadLauncher(),
        channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
        report: () => undefined
      },
      endpointFactory: async (channel: IRemoteChannel): Promise<IRemoteServeEndpoint> => {
        constructed += 1
        const endpoint = await createRuntimeApiEndpoint(
          {
            id: 'custom-parent',
            targetIds: [channel.peerId],
            transport: channel.transport,
            features: channel.features,
            scheduler: channel.scheduler,
            middlewares: [
              codec(channel.pipeline.codec),
              framer(channel.pipeline.framer),
              abort(),
              connect({ transport: channel.transport }),
              ping()
            ]
          },
          { supports: () => true },
          true
        )
        const view: IRpcEndpoint = Object.create(endpoint)
        Object.defineProperty(view, 'provide', {
          value: (name: string, provider: IRpcProvider) => {
            registered.push(name)
            endpoint.provide(name, provider)
            return view
          }
        })
        return { endpoint: Object.freeze(view), oneWay: endpoint, stream: endpoint.stream }
      }
    }
    peer = await createThreadPeer<IRuntimeDynamicSurface>(options)
    assert.equal(((await peer.request('probe', 'ordinary')) as { parent: number }).parent, 42)
    assert.equal(
      constructed,
      1,
      '[A9] native business cannot silently discard an explicit original endpoint factory'
    )
    assert.ok(
      registered.includes('parent.echo'),
      '[A33] actual runtime providers are registered through the selected endpoint view'
    )
  } finally {
    await peer?.close()
    await vi.waitFor(() => assert.equal(budget.inUse, 0), { timeout: 3000 })
  }
})
