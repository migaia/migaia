import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import {
  normalizeRpcEnvelope,
  RpcRouteProfile,
  type IRpcEnvelope
} from '../../src/contract/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { authentication } from '../../src/core/middleware/authentication.js'
import { readAuthenticationEnvelope } from '../../src/core/middleware/authentication-envelope.js'
import { connect } from '../../src/core/middleware/connect.js'
import { readEndpointDebugSnapshot } from '../../src/core/internal/test-observer.js'
import { RequestReplayLedger } from '../../src/core/internal/request-replay-ledger.js'
import type { IRpcAuthenticationCapability } from '../../src/core/typing.js'
import { installPlugin } from '../core/middleware/helpers.js'
import { streamRoots } from '../streaming/fixture.js'

/** A physical delivery and its asynchronous owner continuations finish before each observation. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('r12 protected stream settlement', () => {
  it('[A8/A28] retains legacy stream admission through next, return and terminal physical completion', async () => {
    /** The targeted mutant removes only BC8 retention, without changing any production file. */
    const originalAdmit = RequestReplayLedger.prototype.admit
    if (process.env.RPC_REPLAY_STREAM_MUTANT === 'admission-time-tombstone') {
      RequestReplayLedger.prototype.admit = function (key, peer, now, mode) {
        /** Reflect preserves the original private-field receiver while mutating only retention. */
        return Reflect.apply(originalAdmit, this, [key, peer, now, mode, false])
      }
    }
    /** One physical connection remains source-less and therefore trusted by its receiver owner. */
    const [peerTransport, serverTransport] = createMemoryTransportPair()
    /** Clock moves beyond the legacy TTL without waiting or introducing a stream deadline. */
    const clock = createManualScheduler()
    /** The hand-written peer signs a fresh physical counter for every repeated business ID. */
    const peerAuthentication = installPlugin(
      authentication({ sign: (value) => value, verify: (value) => value })
    ).get('authenticationCapability') as IRpcAuthenticationCapability
    /** Real transport completion stays pending only for the producer's terminal acknowledgement. */
    let releaseTerminal: (() => void) | undefined
    /** Restore native delivery only when the controlled physical write is released. */
    const send = serverTransport.send
    serverTransport.send = (value, options) => {
      const payload = readAuthenticationEnvelope(value).payload
      const envelope = typeof payload === 'string' ? JSON.parse(payload) : payload
      if (envelope.kind === 'stream' && envelope.data.payload.event === 'cancelled') {
        return new Promise<void>((resolve) => {
          releaseTerminal = () => {
            send(value, options)
            resolve()
          }
        })
      }
      return send(value, options)
    }
    /** The provider budget of one makes premature release observable without enlarging any limit. */
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        scheduler: clock,
        providerLimits: { maxReplayEntriesPerPeer: 1 },
        middlewares: [
          authentication({ sign: (value) => value, verify: (value) => value }),
          connect({ transport: serverTransport })
        ]
      },
      streamRoots()
    )
    /** Callback entry is independent of stream Map deletion or client cancellation. */
    let starts = 0
    /** Underlying work retains its original Promise until the fixture resolves it. */
    let releaseNext: (() => void) | undefined
    /** Iterator cleanup is independently unresolved, exercising the other lifetime owner. */
    let releaseReturn: (() => void) | undefined
    server.stream.provide('held', () => {
      starts += 1
      const first = starts === 1
      /** Explicit iterator ownership prevents contextual inference as the broader iterable surface. */
      const iterator: AsyncIterableIterator<never> = {
        [Symbol.asyncIterator]() {
          return this
        },
        next: () =>
          first
            ? new Promise<IteratorResult<never>>((resolve) => {
                releaseNext = () => resolve({ done: true, value: undefined })
              })
            : Promise.resolve({ done: true as const, value: undefined }),
        return: () =>
          first
            ? new Promise<IteratorResult<never>>((resolve) => {
                releaseReturn = () => resolve({ done: true, value: undefined })
              })
            : Promise.resolve({ done: true as const, value: undefined })
      }
      return iterator
    })
    /** Hand-written canonical route is the original peer business identity on each physical frame. */
    const route = {
      profile: RpcRouteProfile,
      applicationVersion: '1',
      senderId: 'peer',
      targetId: 'server',
      receiverId: 'server',
      sentAt: 0
    }
    /** Exact request identity is intentionally reused only to test the business replay owner. */
    const opening = normalizeRpcEnvelope({
      kind: 'request',
      id: 'held-id',
      method: 'held',
      data: { route: { ...route, type: 'request' }, payload: null }
    })
    /** Counter allocation and signing are canonical; the fixture never fabricates a private proof. */
    const deliver = async (envelope: IRpcEnvelope): Promise<void> => {
      await peerTransport.send(
        await peerAuthentication.protect(envelope, {
          direction: 'outbound',
          endpointId: 'peer',
          platform: 'Memory'
        })
      )
      await tick()
      await tick()
    }
    /** Credits and cancellation use the registered stream grammar, not direct owner calls. */
    const control = (event: 'pull' | 'cancel') =>
      normalizeRpcEnvelope({
        kind: 'stream',
        id: opening.id,
        data: { route: { ...route, type: 'stream' }, payload: { event, seq: 0 } }
      })
    try {
      await deliver(opening)
      assert.equal(starts, 1)
      assert.equal(readEndpointDebugSnapshot(server)?.providerState?.replay, 1)
      await deliver(control('pull'))
      assert.equal(typeof releaseNext, 'function')
      await deliver(control('cancel'))
      assert.equal(typeof releaseReturn, 'function')
      await deliver(opening)
      assert.equal(starts, 1, '[A8] pending next/return block the duplicate')
      releaseReturn!()
      await tick()
      await tick()
      assert.equal(typeof releaseTerminal, 'function')
      releaseNext!()
      await tick()
      await tick()
      clock.advance(310_001)
      await deliver(opening)
      assert.equal(
        starts,
        1,
        '[A28] a pending terminal physical send cannot expire stream admission'
      )
      assert.equal(readEndpointDebugSnapshot(server)?.providerState?.replay, 1)
      releaseTerminal!()
      await tick()
      await tick()
      await deliver(opening)
      assert.equal(starts, 1, '[A28] legacy retention starts at final settlement')
      clock.advance(310_001)
      await deliver(opening)
      assert.equal(starts, 2, '[A28] the settled legacy entry expires after its unchanged TTL')
    } finally {
      releaseNext?.()
      releaseReturn?.()
      releaseTerminal?.()
      serverTransport.send = send
      await server.dispose()
      RequestReplayLedger.prototype.admit = originalAdmit
    }
  })
})
