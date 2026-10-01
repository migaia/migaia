import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createConnectProcessBinding } from '../../src/process/plugin/binding.js'
import type { IProcessByteChannel } from '../../src/process/types.js'

/** Two physical ports exchange framed handshake bytes without a platform socket. */
function bytePair(): readonly [IProcessByteChannel, IProcessByteChannel] {
  /** Each port owns its own data and close subscriptions. */
  const readers: Array<((chunk: Uint8Array) => void) | undefined> = []
  const closers: Array<((reason?: unknown) => void) | undefined> = []
  /** A port sends to the opposite subscription, preserving write order. */
  const port = (index: 0 | 1): IProcessByteChannel => ({
    kind: 'byte',
    async write(chunk) {
      await Promise.resolve()
      readers[index === 0 ? 1 : 0]?.(chunk)
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
      closers[index]?.()
      closers[index === 0 ? 1 : 0]?.()
    }
  })
  return [port(0), port(1)]
}

describe('process plugin deployment offer', () => {
  it('[K207] passes the declared object to establish and negotiates its capabilities', async () => {
    const [initiator, responder] = bytePair()
    const scheduler = createManualScheduler()
    const token = 'k207-token'
    /** The extra capability distinguishes the declared proposal from the native default. */
    const offer = createNativeProcessOffer({
      peer: { id: 'declared-client', runtime: 'node' },
      auth: token,
      capabilities: ['k207@1']
    })
    const responderOffer = createNativeProcessOffer({
      peer: { id: 'server', runtime: 'node' },
      capabilities: ['k207@1']
    })
    const responderChannel = createProcessTransport(responder, {
      role: 'responder',
      offer: responderOffer,
      auth: {
        mode: 'required',
        verify(auth) {
          expect(auth).toBe(token)
        }
      },
      peerId: 'declared-client',
      ipc: { connectionId: 'server-connection', sessionId: 'server-session', log: () => undefined },
      scheduler,
      report: () => undefined
    })
    /** The adapter intentionally uses the exact context object for the real handshake. */
    let observedOffer: unknown
    const binding = createConnectProcessBinding(
      {
        kind: 'connect',
        address: '/tmp/k207-offer.sock',
        token,
        offer,
        dial: async () => initiator,
        supervision: { scheduler },
        establish(raw, context) {
          if (raw.kind !== 'byte' || !context.offer)
            throw new TypeError('expected byte channel with deployment offer')
          expect(raw).toBe(initiator)
          expect(context.offer).toBe(offer)
          observedOffer = context.offer
          return createProcessTransport(raw, {
            role: 'initiator',
            offer: context.offer,
            peerId: 'server',
            ipc: { ...context.session, log: () => undefined },
            scheduler: context.scheduler,
            report: () => undefined
          })
        }
      },
      () => undefined
    )
    const ready = await binding.supervisor.start()
    expect(ready.state).toBe('ready')
    if (ready.state !== 'ready') return
    const clientChannel = await binding.openChannel(ready.unit, new AbortController().signal)
    const serverChannel = await responderChannel
    try {
      expect(observedOffer).toBe(offer)
      expect(clientChannel.agreement.capabilities).toContain('k207@1')
      expect(serverChannel.agreement.capabilities).toContain('k207@1')
    } finally {
      await binding.supervisor.dispose()
      await serverChannel.close()
    }
  })
})
