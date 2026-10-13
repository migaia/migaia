import { PassThrough, Writable } from 'node:stream'
import { expect, it } from 'vitest'
import { createRuntimeEventByteIO } from '@migaia/rpc-core/adapter/internal-advanced'
import { RpcProbeDirection, type IRpcCarrierProbe } from '@migaia/rpc-core/probe'
import { createNativeProcessOffer, createProcessTransport } from '@migaia/rpc-process'
import { RpcBatchPhysical } from '@migaia/rpc-contract'
import { bridgeFixture, flush, request } from '../bridge/fixture.js'

it('[closure A3] observes one physical JSON-RPC batch with its existing member count', async () => {
  /** The existing bridge fixture negotiates the real batch capability and physical writer. */
  const fixture = bridgeFixture()
  /** No observation wrapper or parser replacement surrounds the final public channel. */
  const channel = await fixture.open()
  /** The callback consumes primitive fields while the physical batch's original content is live. */
  const counts: number[] = []
  try {
    channel.transport.observe!({
      capturing: false,
      emit(_direction, _bytes, _carrier, detail) {
        counts.push(detail!.batchSize as number)
      }
    })
    await channel.transport.send(
      JSON.stringify({
        kind: RpcBatchPhysical.kind,
        envelopes: [request('batch-a', 'p.f.request'), request('batch-b', 'p.f.request')]
      })
    )
    await flush()
    expect(counts).toEqual([2])
    expect(fixture.reports).toEqual([])
  } finally {
    await channel.close()
  }
})

it('[closure A3] preserves byte send settlement and measures a real false-write drain through IPC', async () => {
  /** These native streams exercise backpressure without introducing another carrier implementation. */
  const inputs = [new PassThrough(), new PassThrough()] as const
  /** A one-byte high-water mark makes each framed write use Node's actual false/drain contract. */
  const writers = inputs.map(
    (_input, side) =>
      new Writable({
        highWaterMark: 1,
        write(chunk, _encoding, callback) {
          inputs[1 - side]!.write(chunk)
          setTimeout(callback, 5)
        }
      })
  )
  /** Core's existing raw byte owner retains native settlement and physical teardown. */
  const ports = inputs.map((input, side) =>
    createRuntimeEventByteIO(
      input,
      writers[side]!,
      {
        close: () => {
          input.destroy()
          writers[side]!.destroy()
        }
      },
      { source: 'closure-fixture', code: 'CLOSED', message: 'closure byte fixture closed' }
    )
  )
  /** The existing public process factory builds the real handshake, carrier and IPC wrapper. */
  const channels = await Promise.all(
    ports.map((port, side) =>
      createProcessTransport(port, {
        peerId: side === 0 ? 'drain-right' : 'drain-left',
        report: () => undefined,
        ipc: { connectionId: 'closure-drain', sessionId: 'closure-drain', log: () => undefined },
        offer: createNativeProcessOffer({
          peer: { id: side === 0 ? 'drain-left' : 'drain-right', runtime: 'node' }
        }),
        ...(side === 0
          ? { role: 'initiator' as const }
          : { role: 'responder' as const, auth: { mode: 'none' as const } })
      })
    )
  )
  /** The original borrowed detail is inspected after its native drain, with no extra carrier event. */
  const drains: Readonly<Record<string, unknown>>[] = []
  /** Installing twice with the same handle must leave the newer observer active. */
  const probe: IRpcCarrierProbe = {
    capturing: false,
    emit(direction, bytes, _carrier, detail) {
      if (direction === RpcProbeDirection.outbound) {
        expect(bytes).toBeGreaterThan(0)
        expect(detail?.frameBytes).toBe(bytes)
        expect(detail!.drainMs).toBe(-1)
        drains.push(detail!)
      }
    }
  }
  /** The business subscriber receives the original text regardless of observation timing. */
  const received: unknown[] = []
  try {
    /** Two real early physical frames must get distinct observations at their eventual Core entry. */
    const arrivals: number[] = []
    /** Synchronous delivery records the immediately preceding physical observation ordinal. */
    const linked: number[] = []
    channels[1]!.transport.observe!({
      capturing: false,
      emit(direction) {
        if (direction === RpcProbeDirection.inbound) arrivals.push(arrivals.length + 1)
      }
    })
    await channels[0]!.transport.send('early-first')
    await channels[0]!.transport.send('early-second')
    expect(arrivals).toEqual([])
    channels[1]!.transport.subscribe((message) => {
      received.push(message.data)
      linked.push(arrivals.at(-1)!)
    })
    expect(received).toEqual(['early-first', 'early-second'])
    expect(linked).toEqual([1, 2])
    received.length = 0
    /** A stale disposer may not retire the subsequent installation of the same probe reference. */
    const stale = channels[0]!.transport.observe!(probe)
    /** The current disposer is used only after the real native write has settled. */
    const release = channels[0]!.transport.observe!(probe)
    stale()
    /** Observation must run before send returns even though the native writer settles later. */
    const sending = channels[0]!.transport.send('observed frame')
    expect(drains).toHaveLength(1)
    await sending
    expect(received).toEqual(['observed frame'])
    expect(drains).toHaveLength(1)
    expect(drains[0]!.drainMs).toBeGreaterThan(0)
    release()
    release()
    await channels[0]!.transport.send('unobserved frame')
    expect(received).toEqual(['observed frame', 'unobserved frame'])
    expect(drains).toHaveLength(1)
  } finally {
    await Promise.all(channels.map((channel) => channel.close()))
  }
})
