import { createManualScheduler } from '@migaia/utils/scheduler'
import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { serializeRpcError } from '../../src/contract/error.js'
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '../../src/contract/framing/stream.js'
import { acceptRpcHandshake } from '../../src/contract/handshake.js'
import { RpcCapability, RpcCodecId, RpcProtocol } from '../../src/contract/wire-constants.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import type { IProcessByteChannel, IProcessMessageChannel } from '../../src/process/types.js'

/** A connected pair exchanges genuine prefix-framed bytes with no process dependency. */
function createBytePair(): readonly [
  IProcessByteChannel,
  IProcessByteChannel,
  readonly Uint8Array[]
] {
  /** The two physical readers are installed independently by each endpoint. */
  const readers: Array<((chunk: Uint8Array) => void) | undefined> = [undefined, undefined]
  /** The two close callbacks let one side signal physical EOF to the other. */
  const closures: Array<((reason?: unknown) => void) | undefined> = [undefined, undefined]
  /** Captured writes distinguish hello from accept/reject without decoding through the product. */
  const writes: Uint8Array[] = []
  /** A port's peer is the opposite index, never a shared reader. */
  const makePort = (index: 0 | 1): IProcessByteChannel => ({
    kind: 'byte',
    async write(chunk) {
      writes.push(chunk)
      /** Delivery occurs after the sending side has queued its write. */
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
      closures[index] = listener
      return () => {
        closures[index] = undefined
      }
    },
    close() {
      closures[index === 0 ? 1 : 0]?.()
    }
  })
  return [makePort(0), makePort(1), writes]
}

/** Shared per-connection IPC identity has no diagnostic sink in handshake-only tests. */
function ipc(name: string) {
  return { connectionId: name, sessionId: name, log: () => undefined }
}

describe('native process handshake', () => {
  it.each(['one chunk', 'consecutive writes'] as const)(
    '[D3] queues business after accept before initiator activation (%s)',
    async (mode) => {
      /** The scripted peer replies during the initiator's physical hello write. */
      let onData: ((chunk: Uint8Array) => void) | undefined
      const encoder = new TextEncoder()
      const frame = (text: string): Uint8Array => encodeRpcStreamFrame(encoder.encode(text))
      const responderOffer = createNativeProcessOffer({
        peer: { id: 'responder', runtime: 'node' }
      })
      const decoder = createRpcStreamFrameDecoder({
        onFrame(payload) {
          const accepted = acceptRpcHandshake(responderOffer, new TextDecoder().decode(payload))
          expect(accepted.ok).toBe(true)
          const acceptFrame = frame(accepted.reply)
          const businessFrame = frame('{"push":1}')
          if (mode === 'one chunk') {
            const combined = new Uint8Array(acceptFrame.length + businessFrame.length)
            combined.set(acceptFrame)
            combined.set(businessFrame, acceptFrame.length)
            onData?.(combined)
          } else {
            onData?.(acceptFrame)
            onData?.(businessFrame)
          }
        },
        onError: () => undefined
      })
      const port: IProcessByteChannel = {
        kind: 'byte',
        write: async (chunk) => decoder.push(chunk),
        onData(listener) {
          onData = listener
          return () => {
            onData = undefined
          }
        },
        onClose: () => () => undefined,
        close: () => undefined
      }
      const channel = await createProcessTransport(port, {
        role: 'initiator',
        offer: createNativeProcessOffer({ peer: { id: 'initiator', runtime: 'node' } }),
        peerId: 'responder',
        report: () => undefined,
        ipc: ipc('early')
      })
      try {
        const received: unknown[] = []
        channel.transport.subscribe((message) => received.push(message.data))
        expect(received).toEqual(['{"push":1}'])
      } finally {
        await channel.close()
      }
    }
  )

  it('[A5] builds one frozen native offer from the canonical protocol and capabilities', () => {
    const peer = { id: 'node-1', runtime: 'node' }
    const basic = createNativeProcessOffer({ peer })
    expect(basic.versions).toEqual([{ major: RpcProtocol.major, minor: RpcProtocol.minor }])
    expect(basic.codecs).toEqual([RpcCodecId.json])
    expect(basic.capabilities).toEqual([RpcCapability.ping, RpcCapability.close])
    expect(Object.isFrozen(basic)).toBe(true)
    expect(Object.isFrozen(basic.capabilities)).toBe(true)
    expect(
      createNativeProcessOffer({
        peer,
        stream: true,
        capabilities: [RpcCapability.ping, RpcCapability.stream]
      }).capabilities
    ).toEqual([RpcCapability.ping, RpcCapability.close, RpcCapability.stream])
  })

  it('[A5] completes byte hello/accept on one injected scheduler', async () => {
    const [initiator, responder, writes] = createBytePair()
    const scheduler = createManualScheduler()
    const offerA = createNativeProcessOffer({ peer: { id: 'node-a', runtime: 'node' } })
    const offerB = createNativeProcessOffer({ peer: { id: 'node-b', runtime: 'node' } })
    const [left, right] = await Promise.all([
      createProcessTransport(initiator, {
        role: 'initiator',
        offer: offerA,
        peerId: 'node-b',
        scheduler,
        report: () => undefined,
        ipc: ipc('left')
      }),
      createProcessTransport(responder, {
        role: 'responder',
        offer: offerB,
        auth: { mode: 'none' },
        peerId: 'node-a',
        scheduler,
        report: () => undefined,
        ipc: ipc('right')
      })
    ])
    expect(writes).toHaveLength(2)
    expect(left.scheduler).toBe(scheduler)
    expect(right.scheduler).toBe(scheduler)
    expect(left.agreement).toMatchObject({ source: 'negotiated', codec: RpcCodecId.json })
    expect(left.agreement.capabilities).toEqual([RpcCapability.ping, RpcCapability.close])
    expect(left.pipeline.codec.id).toBe(RpcCodecId.json)
    expect(left.pipeline.framer.outputEncodedType).toBe('string')
    expect(left.features).toHaveLength(2)
    expect(scheduler.pendingCount).toBe(0)
    await left.close()
    await right.close()
  })

  it('[A5/A13] rejects verifier failure with fixed wire error and no token in diagnostics', async () => {
    const [initiator, responder, writes] = createBytePair()
    const token = 'secret-token-only-in-hello'
    const reports: unknown[] = []
    const offerA = createNativeProcessOffer({
      peer: { id: 'node-a', runtime: 'node' },
      auth: token
    })
    const offerB = createNativeProcessOffer({ peer: { id: 'node-b', runtime: 'node' } })
    const attempts = await Promise.allSettled([
      createProcessTransport(initiator, {
        role: 'initiator',
        offer: offerA,
        peerId: 'node-b',
        report: () => undefined,
        ipc: ipc('left')
      }),
      createProcessTransport(responder, {
        role: 'responder',
        offer: offerB,
        auth: {
          mode: 'required',
          verify() {
            throw new Error(token)
          }
        },
        peerId: 'node-a',
        report: (error) => reports.push(error),
        ipc: ipc('right')
      })
    ])
    expect(attempts.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(writes).toHaveLength(2)
    /** The second physical frame is the rejection; hello legitimately carries the credential. */
    const rejectText = new TextDecoder().decode(writes[1]!.subarray(4))
    expect(rejectText).toContain('PROCESS_CHANNEL_AUTH_REJECTED')
    expect(rejectText).not.toContain(token)
    expect(JSON.stringify(reports)).not.toContain(token)
    expect(reports).toEqual([
      expect.objectContaining({
        source: '@migaia/rpc/process',
        code: 'PROCESS_CHANNEL_AUTH_REJECTED'
      })
    ])
  })

  it('[A13] keeps hostile handshake fields out of the local cause and wire report', async () => {
    const [attacker, responder] = createBytePair()
    const token = 'hostile-kind-token'
    const pending = createProcessTransport(responder, {
      role: 'responder',
      offer: createNativeProcessOffer({ peer: { id: 'node-b', runtime: 'node' } }),
      auth: { mode: 'none' },
      peerId: 'untrusted',
      report: () => undefined,
      ipc: ipc('hostile')
    })
    /** The invalid kind is deliberately short enough to expose the historical C2 leak. */
    const hostile = JSON.stringify({
      kind: token,
      step: 'hello',
      protocol: RpcProtocol.id,
      versions: [{ major: 1, minor: 1 }],
      codecs: [RpcCodecId.json],
      capabilities: [],
      peer: { id: 'attacker', runtime: 'node' }
    })
    await attacker.write(encodeRpcStreamFrame(new TextEncoder().encode(hostile)))
    /** Inspection and error serialization must both traverse the whole cause graph safely. */
    let observed: unknown
    try {
      await pending
    } catch (error) {
      observed = error
    }
    expect(observed).toMatchObject({ code: 'HANDSHAKE_INVALID' })
    expect(inspect(observed, { depth: null, showHidden: true })).not.toContain(token)
    expect(JSON.stringify(serializeRpcError(observed, { report: () => undefined }))).not.toContain(
      token
    )
  })

  it('[A5/A6] uses the manual scheduler deadline and closes a silent byte peer', async () => {
    /** The silent peer never resolves a handshake read. */
    let closes = 0
    const channel: IProcessByteChannel = {
      kind: 'byte',
      write: async () => undefined,
      onData: () => () => undefined,
      onClose: () => () => undefined,
      close: () => {
        closes += 1
      }
    }
    const scheduler = createManualScheduler()
    const pending = createProcessTransport(channel, {
      role: 'responder',
      offer: createNativeProcessOffer({ peer: { id: 'node-b', runtime: 'node' } }),
      auth: { mode: 'none' },
      peerId: 'silent',
      scheduler,
      report: () => undefined,
      ipc: ipc('silent')
    })
    scheduler.advance(9_999)
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(1)
    await expect(pending).rejects.toMatchObject({ code: 'PROCESS_HANDSHAKE_TIMEOUT' })
    expect(scheduler.pendingCount).toBe(0)
    expect(closes).toBe(1)
  })

  it('[A5] projects equal static message agreements without a handshake', async () => {
    let sends = 0
    const channel: IProcessMessageChannel = {
      kind: 'message',
      send: () => {
        sends += 1
      },
      onMessage: () => () => undefined,
      onClose: () => () => undefined,
      close: () => undefined
    }
    const options = {
      peerId: 'message-peer',
      report: () => undefined,
      ipc: ipc('message'),
      staticAgreement: {
        local: { codec: 'identity' as const, capabilities: [RpcCapability.ping] },
        peer: { codec: 'identity' as const, capabilities: [RpcCapability.ping] }
      }
    }
    const remote = await createProcessTransport(channel, options)
    expect(remote.agreement).toEqual({
      source: 'static',
      codec: 'identity',
      capabilities: [RpcCapability.ping]
    })
    expect(remote.features).toEqual([])
    expect(sends).toBe(0)
    await remote.close()
    await expect(
      createProcessTransport(
        { ...channel },
        {
          ...options,
          staticAgreement: {
            ...options.staticAgreement,
            peer: { codec: 'identity', capabilities: [] }
          }
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })
})
