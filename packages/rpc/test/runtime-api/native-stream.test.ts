import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { createProcessListenerPeer } from '../../src/process/runtime-listener.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  readRuntimePeerSessions,
  type IRuntimePeer
} from '../../src/remote/runtime-api/peer.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES as RUNTIME_API_CAPABILITIES } from './fixture.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import type { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import type { IRpcAbortSignal } from '../../src/core/typing.js'

it('[A59][A67][A69] authenticated native stream retains its shared lease through discard and seals real final outcome', async () => {
  /** Fixture source offers are independent from unadvertised production U25 defaults. */
  const capabilities = [
    ...RUNTIME_API_CAPABILITIES,
    RpcCapability.generation,
    RpcCapability.order,
    RpcCapability.cancelBeforeStart,
    RpcCapability.outcome
  ]
  /** The OS binds one fresh loopback port; no external service participates. */
  let address = ''
  /** Only actual provider invocations contribute business effects. */
  const effects: string[] = []
  /** The native context exposes final-provider cancellation rather than caller in-flight state. */
  let signal: IRpcAbortSignal | undefined
  /** Fixture business work can pause inside the original producer iterator. */
  let finish!: () => void
  /** The finite generator reaches real terminal after this promise settles. */
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  /** Every original report remains available to reject accidental transport or cleanup failures. */
  const failures: unknown[] = []
  /** Original listener/session/governor/drain wrappers register the actual stream callback. */
  const server = await createProcessListenerPeer(
    {
      self: { name: 'native-stream-provider', instanceId: 'native-stream-provider' },
      provide: {
        baseline: () => 42,
        values: async function* (_payload: unknown, context: { signal: IRpcAbortSignal }) {
          signal = context.signal
          effects.push('first')
          yield 1
          await held
          effects.push('discarded')
          yield 2
          return 99
        },
        after: () => {
          effects.push('after')
          return 7
        },
        other: () => 9
      },
      report: (error) => failures.push(error)
    },
    {
      kind: 'listener',
      address: 'tcp://127.0.0.1:0',
      listen: async (options) => {
        /** This actual listener owns the assigned address and every accepted byte channel. */
        const listener = await listenProcessByteChannel(options)
        address = listener.address
        return listener
      },
      verify: (auth) => {
        assert.equal(auth, 'native-stream-fixture')
        return 'stream-principal'
      },
      offer: createNativeProcessOffer({
        peer: { id: 'native-stream-provider', runtime: 'node' },
        capabilities
      }),
      createConnectionContext: () => ({
        peerId: 'native-stream-caller',
        ipc: {
          connectionId: 'native-stream-connection',
          sessionId: 'native-stream-session',
          log: () => undefined
        }
      })
    }
  )
  /** The connected Peer remains owned by its original native source through cleanup. */
  let client: IRuntimePeer | undefined
  /** The real same-key follower stays observed until the final stream lease is released. */
  let follower: Promise<unknown> | undefined
  try {
    client = await createRuntimePeer({
      self: { name: 'native-stream-caller', instanceId: 'native-stream-caller' },
      connect: async () => {
        /** Native transport performs its own real handshake and selected byte framing. */
        const raw = await dialProcessByteChannel({ address })
        return createProcessTransport(raw, {
          role: 'initiator',
          offer: createNativeProcessOffer({
            peer: { id: 'native-stream-caller', runtime: 'node' },
            auth: 'native-stream-fixture',
            capabilities
          }),
          peerId: 'native-stream-provider',
          ipc: {
            connectionId: 'native-stream-client',
            sessionId: 'native-stream-client',
            log: () => undefined
          },
          report: (error) => failures.push(error)
        })
      },
      report: (error) => failures.push(error)
    })
    assert.equal(await client.request('baseline'), 42)
    /** The native high-level surface starts exactly one producer through the original stream owner. */
    const iterator = client.stream('values', undefined, {
      orderKey: 'same',
      cancel: 'before-start',
      idempotencyKey: 'native-final'
    })
    assert.deepEqual(await iterator.next(), { done: false, value: 1 })
    assert.ok(signal)
    assert.equal((await client.outcome('native-final')).state, 'pending')
    follower = client.request('after', undefined, { orderKey: 'same' })
    void follower.catch(() => undefined)
    assert.equal(await client.request('other', undefined, { orderKey: 'other' }), 9)
    assert.deepEqual(effects, ['first'])
    /** Actual native registration carries the same canonical shared admission object. */
    const session = readRuntimePeerSessions(server)![0]!
    /** Waiting and running retain one lease each until true generator terminal and cleanup. */
    const admission = readEndpointOwner<ProviderAdmissionRegistry>(
      readRuntimePeerConnection(session).endpoint,
      EndpointOwnerKey.providerAdmission
    )!
    await vi.waitFor(() => assert.equal(admission.size, 2))
    /** Discard reuses the real native iterator and does not release its key at stream-open. */
    const returned = iterator.return!()
    finish()
    assert.deepEqual(await returned, { done: true, value: 99 })
    assert.equal(await follower, 7)
    assert.deepEqual(effects, ['first', 'discarded', 'after'])
    await vi.waitFor(() => assert.equal(admission.size, 0))
    /** End crossed the wire only after the original store sealed actual generator completion. */
    const outcome = await client.outcome('native-final')
    assert.equal(outcome.state, 'done')
    if (outcome.state !== 'done')
      assert.fail('[A69] native completion must be sealed before return resolves')
    assert.deepEqual(outcome.outcome.completion, { ok: true, result: 99 })
    /** Unselected legacy native streaming keeps its original wrapper's terminal behavior. */
    const ordinary = client.stream('values')
    assert.deepEqual(await ordinary.next(), { done: false, value: 1 })
    assert.deepEqual(await ordinary.next(), { done: false, value: 2 })
    assert.deepEqual(await ordinary.next(), { done: true, value: undefined })
    assert.equal(failures.length, 0)
  } finally {
    finish()
    await client?.close()
    await server.close()
    await follower?.catch(() => undefined)
  }
})
