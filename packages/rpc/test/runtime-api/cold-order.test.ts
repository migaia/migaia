import assert from 'node:assert/strict'
import { it } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { deferProcessByteReceive } from '../../src/process/channel.js'
import { createRuntimePeer, type IRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import type { IProcessByteChannel } from '../../src/process/types.js'

/** A controlled physical byte pair exposes delivery independently from write drain. */
function bytePair(holdAccept: boolean) {
  /** Exactly one canonical decoder owns each physical direction. */
  const readers: (((chunk: Uint8Array) => void) | undefined)[] = []
  /** Physical retirement remains separate from business receive. */
  const closers: (((reason?: unknown) => void) | undefined)[] = []
  /** Write counts distinguish each direction's first handshake frame from business. */
  const writes = [0, 0]
  /** The fixture releases an actual responder accept's drain after observing peer business. */
  let release!: () => void
  /** This cold fixture barrier is never a production scheduler or dispatcher. */
  const drain = new Promise<void>((resolve) => {
    release = resolve
  })
  /** The first ordinary wire frame proves the fast endpoint sent its actual directory. */
  let observed!: () => void
  /** Observe real writes rather than predicting microtask scheduling. */
  const business = new Promise<void>((resolve) => {
    observed = resolve
  })
  /** A byte port forwards complete canonical frames without interpreting their envelopes. */
  const port = (index: number): IProcessByteChannel => ({
    kind: 'byte',
    async write(bytes) {
      writes[index]! += 1
      readers[1 - index]?.(bytes)
      if (writes[index]! > 1) observed()
      if (index === 1 && writes[index] === 1 && holdAccept) await drain
    },
    onData(listener) {
      readers[index] = listener
      return () => {
        readers[index] = undefined
      }
    },
    onClose(listener) {
      closers[index] = listener
      return () => {
        closers[index] = undefined
      }
    },
    close() {
      closers[1 - index]?.()
    }
  })
  return { ports: [port(0), port(1)], business, release, writes }
}

for (const order of [
  'child-before-parent',
  'parent-before-child',
  'accept-before-drain'
] as const) {
  it(`[A2][A3] actual directory and reverse business survive ${order}`, async () => {
    /** Each test owns an independent pair and physical accept-drain barrier. */
    const pair = bytePair(order === 'accept-before-drain')
    /** A delayed source returns only after the fast endpoint really sent business. */
    let releaseSource!: () => void
    /** This construction-only hold simulates the supported endpoint installation order. */
    const sourceReady = new Promise<void>((resolve) => {
      releaseSource = resolve
    })
    /** Exact dispatch counts distinguish queued directory traffic from application execution. */
    const calls = [0, 0]
    /** Only successfully constructed canonical endpoints are disposed. */
    const peers: (IRuntimePeer | undefined)[] = []
    /** Both actual factories remain independently pending during the cold ordering gap. */
    const published = [false, false]
    /** Errors remain observed even if the other construction is still waiting on the fixture. */
    const pending = pair.ports.map((raw, index) =>
      createRuntimePeer({
        self: { name: index === 0 ? 'parent' : 'child', instanceId: `cold-${index}` },
        provide: {
          echo: (value) => {
            calls[index]! += 1
            return value
          }
        },
        connect: async (context) => {
          deferProcessByteReceive(raw)
          /** Both sides negotiate independent actual endpoint offers through the original handshake. */
          const offered = createNativeProcessOffer({
            peer: { id: context.self.instanceId, runtime: 'fixture' },
            ...(index === 0 ? { auth: 'cold-fixture-token' } : {})
          })
          const common = {
            peerId: `cold-${1 - index}`,
            offer: { ...offered, capabilities: context.capabilities },
            scheduler: systemScheduler,
            report: () => undefined,
            ipc: { connectionId: `cold-${index}`, sessionId: `cold-${index}`, log: () => undefined }
          }
          const channel =
            index === 0
              ? await createProcessTransport(raw, { ...common, role: 'initiator' })
              : await createProcessTransport(raw, {
                  ...common,
                  role: 'responder',
                  auth: {
                    mode: 'required',
                    verify: (token, peer) => {
                      assert.equal(token, 'cold-fixture-token')
                      assert.equal(peer.id, 'cold-0')
                    }
                  }
                })
          if (
            (order === 'child-before-parent' && index === 0) ||
            (order === 'parent-before-child' && index === 1)
          )
            await sourceReady
          return channel
        },
        report: () => undefined
      }).then((peer) => {
        peers[index] = peer
        published[index] = true
        return peer
      })
    )
    // Observe both rejections immediately; Promise.all below remains the assertion owner.
    for (const result of pending) void result.catch(() => undefined)
    try {
      await Promise.race([pair.business, ...pending])
      assert.deepEqual(
        published,
        [false, false],
        '[A2] directory write alone does not publish an unprepared endpoint'
      )
      assert.deepEqual(calls, [0, 0], '[A3] no application dispatch runs during cold receive')
      releaseSource()
      pair.release()
      const [parent, child] = await Promise.all(pending)
      assert.equal(
        await parent!.request('echo', 'forward'),
        'forward',
        '[A2] genuine forward business survives handoff'
      )
      assert.equal(
        await child!.request('echo', 'reverse'),
        'reverse',
        '[A2] genuine reverse business survives handoff'
      )
      assert.deepEqual(calls, [1, 1], '[A3] each application request executes once')
    } finally {
      releaseSource()
      pair.release()
      await Promise.allSettled(pending)
      await peers[0]?.close()
      await peers[1]?.close()
      await pair.ports[0]!.close()
      await pair.ports[1]!.close()
    }
  })
}
