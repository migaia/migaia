import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '@migaia/rpc-contract'
import {
  observeProcessListenerSessions,
  readObservedProcessSessionAdmission
} from '../fixtures/process-diagnostics.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import {
  createRuntimePeer,
  type IRuntimePeer
} from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { readRuntimePeerConnection } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES as RUNTIME_API_CAPABILITIES } from '../../../rpc-host/test/runtime-api/fixture.js'

it('the real authenticated process listener injects one logical provider scope across accepted sockets', async () => {
  /** Source offers are independent of defaults until all runtime-api ports are implemented. */
  const capabilities = [
    ...RUNTIME_API_CAPABILITIES,
    RpcCapability.generation,
    RpcCapability.order,
    RpcCapability.deadline
  ]
  /** The OS supplies one fresh loopback address, with no external service or filesystem socket. */
  let address = ''
  /** Accepted principal scopes come from the native authentication owner. */
  let accepted = 0
  const failures: unknown[] = []
  const effects: string[] = []
  let finish!: () => void
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  /** Only genuine SDK accepted Peer receipts support the original admission identity oracle. */
  const acceptedSessions: IRuntimePeer[] = []
  const server = await createRpcHost({
    self: { name: 'provider', instanceId: 'socket-scope-provider' },
    provide: {
      baseline: () => 42,
      first: async () => {
        effects.push('first')
        await held
        return 1
      },
      second: () => {
        effects.push('second')
        return 2
      },
      other: () => {
        effects.push('other')
        return 3
      }
    },
    report: (error) => {
      failures.push(error)
    },
    plugins: [
      observeProcessListenerSessions(
        processPlugin({
          listen: {
            kind: 'listener',
            address: 'tcp://127.0.0.1:0',
            listen: async (options) => {
              const listener = await listenProcessByteChannel(options)
              address = listener.address
              return listener
            },
            verify: (auth) => {
              assert.equal(auth, 'shared-listener-fixture')
              return 'verified-principal'
            },
            offer: createNativeProcessOffer({
              peer: { id: 'socket-scope-provider', runtime: 'node' },
              capabilities
            }),
            createConnectionContext: () => ({
              peerId: `socket-caller-${++accepted}`,
              ipc: {
                connectionId: `connection-${accepted}`,
                sessionId: `session-${accepted}`,
                log: () => undefined
              }
            })
          }
        }),
        acceptedSessions
      )
    ]
  })
  const clients: IRuntimePeer[] = []
  const calls: Promise<unknown>[] = []
  let firstFailure: unknown
  try {
    /** The local compiled routes exist before a remote session can provide directory facts. */
    const detail = await server.describe()
    assert.deepEqual(
      new Set(detail.provide),
      new Set(['baseline', 'first', 'other', 'second']),
      'listener methods use the same local name-array contract before any accept'
    )
    assert.equal(detail.provide.length, 4)
    assert.equal(accepted, 0)
    assert.equal(
      detail.connections.length,
      0,
      'an empty actual Host cannot publish a guessed accepted connection'
    )
    for (const index of [1, 2]) {
      const peer = await createRuntimePeer({
        self: { name: `caller-${index}`, instanceId: `socket-caller-${index}` },
        connect: async (context) => {
          const raw = await dialProcessByteChannel({ address })
          return createProcessTransport(raw, {
            role: 'initiator',
            offer: createNativeProcessOffer({
              peer: { id: context.self.instanceId, runtime: 'node' },
              auth: 'shared-listener-fixture',
              capabilities
            }),
            peerId: 'socket-scope-provider',
            ipc: {
              connectionId: `client-${index}`,
              sessionId: `client-session-${index}`,
              log: () => undefined
            },
            report: (error) => {
              failures.push(error)
            }
          })
        },
        report: (error) => {
          failures.push(error)
        }
      })
      clients.push(peer)
      assert.equal(await peer.request('baseline'), 42)
      if (index === 1)
        assert.equal(
          readRuntimePeerConnection(acceptedSessions[0]!).peerId,
          'socket-caller-1',
          'a sole accepted connection retains its genuine route identity'
        )
    }
    assert.equal(
      (await server.describe()).connections.length,
      2,
      'the actual Host retains both genuine accepted sessions'
    )
    const first = clients[0]!.request('first', undefined, { orderKey: 'same' })
    calls.push(first)
    void first.catch((error: unknown) => {
      firstFailure = error
    })
    await vi.waitFor(() => {
      if (firstFailure !== undefined) throw firstFailure
      assert.deepEqual(effects, ['first'])
    })
    const second = clients[1]!.request('second', undefined, { orderKey: 'same' })
    calls.push(second)
    void second.catch(() => undefined)
    assert.equal(await clients[1]!.request('other', undefined, { orderKey: 'other' }), 3)
    assert.deepEqual(effects, ['first', 'other'], 'real accepts cannot create a queue per socket')
    const sessions = acceptedSessions
    assert.equal(sessions.length, 2)
    const scopes = sessions.map((peer) => readObservedProcessSessionAdmission(peer)!)
    assert.equal(scopes[0], scopes[1])
    await vi.waitFor(() => assert.equal(scopes[0]!.size, 2))
    finish()
    assert.deepEqual(await Promise.all(calls), [1, 2])
    await vi.waitFor(() => assert.equal(scopes[0]!.size, 0))
    assert.equal(failures.length, 0)
  } finally {
    finish()
    await Promise.all(clients.map((peer) => peer.close()))
    await server.close()
    await Promise.allSettled(calls)
  }
})
