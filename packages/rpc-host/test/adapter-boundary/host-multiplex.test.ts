import { describe, expect, it, vi } from 'vitest'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { createStringFramer, messageFramerV1 } from '@migaia/rpc-contract/framing'
import { RpcBatchPhysical, RpcCapability } from '@migaia/rpc-contract'
import type { IRpcInboundMessage, IRpcSendOptions } from '../../dist/core/transport.js'
import type { IRuntimePeerSourceResult } from '@migaia/rpc-host/plugin'
import { createHostMultiplexTransport } from '../../dist/runtime-adapter/host-multiplex.js'
import { createMessageReceiveHandoff } from '../../dist/runtime-adapter/message/handoff.js'
import { systemScheduler } from '@migaia/utils/scheduler'

/** The physical channel retains its own selected codec/framer and terminal close owner. */
function physical(peerId: string, pipeline: IRuntimePeerSourceResult['pipeline']) {
  /** The mux borrows exactly these native subscriptions. */
  const incoming = new Set<(message: IRpcInboundMessage) => void>()
  /** Physical failures concern only this source. */
  const errors = new Set<(error: unknown) => void>()
  /** Captured sends prove each original physical pipeline and transfer list are used. */
  const sent: { frame: unknown; options?: IRpcSendOptions }[] = []
  /** Activation is owned by the original cold handoff. */
  const activateReceive = vi.fn()
  /** The receipt owner, never the mux detach operation, closes this connection. */
  const close = vi.fn(async () => undefined)
  /** A complete source fixture uses the same channel contract as the actual native adapters. */
  const channel: IRuntimePeerSourceResult = {
    transport: {
      platform: 'Memory',
      send: (frame, options) => {
        sent.push({ frame, options })
      },
      subscribe(listener) {
        incoming.add(listener)
        return () => {
          incoming.delete(listener)
        }
      },
      onTransportError(listener) {
        errors.add(listener)
        return () => {
          errors.delete(listener)
        }
      }
    },
    peerId,
    scheduler: systemScheduler,
    agreement: { source: 'static', codec: pipeline.codec.id, capabilities: [RpcCapability.batch] },
    pipeline,
    features: [],
    activateReceive,
    close
  }
  return { channel, incoming, errors, sent, activateReceive, close }
}

/** One ordinary request uses only envelope routing, leaving semantic admission to the endpoint. */
function request(targetId: string, id: string) {
  return {
    kind: 'request',
    id,
    method: 'echo',
    data: { route: { senderId: 'host', targetId }, payload: id }
  }
}

describe('host physical channel multiplexing', () => {
  it('releases the original cold receive handoff only after the logical channel activates', async () => {
    /** The native callbacks belong to the existing bootstrap handoff, not to a new mux queue. */
    const native = new Set<(message: IRpcInboundMessage) => void>()
    /** Retain the one early application frame with the same owner used by actual message adapters. */
    const handoff = createMessageReceiveHandoff<IRpcInboundMessage>({
      add(listener) {
        native.add(listener)
      },
      remove(listener) {
        native.delete(listener)
      },
      observeFailure() {
        return () => undefined
      }
    })
    /** The held physical channel still owns its codec/framer and terminal resource receipt. */
    const source = physical('a', { codec: identityCodec, framer: messageFramerV1 })
    /** A native frame arrives before endpoint installation has acquired its receiver. */
    const early = { data: request('host', 'early') }
    for (const listener of native) listener(early)
    /** This adapter borrows the original handoff operations. */
    const channel = {
      ...source.channel,
      transport: {
        ...source.channel.transport,
        subscribe(listener: (message: IRpcInboundMessage) => void) {
          handoff.subscribe(listener)
          return () => handoff.unsubscribe(listener)
        }
      },
      activateReceive: () => handoff.activateReceive()
    }
    /** One real logical subscription exists before activation releases captured traffic. */
    const mux = createHostMultiplexTransport({ name: 'host', instanceId: 'host' }, vi.fn())
    /** The endpoint callback must see exactly the original one queued application frame. */
    const received = vi.fn()
    mux.channel.transport.subscribe(received)
    mux.attach(channel)
    expect(received).not.toHaveBeenCalled()
    mux.channel.activateReceive?.()
    mux.channel.activateReceive?.()
    expect(received).toHaveBeenCalledTimes(1)
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ data: early.data, peerId: 'a' })
    )
    await mux.close()
    expect(native.size).toBe(0)
    handoff.close()
  })

  it('routes two different physical pipelines in both directions with private source proof', async () => {
    /** Independent string framing must not share partial assemblies with the object channel. */
    const json = defineJsonCodec({ version: 1 })
    /** Small fragments exercise actual pending/complete reassembly. */
    const stringFramer = createStringFramer({ chunkBytes: 8 })
    /** The string source performs actual JSON conversion. */
    const a = physical('a', {
      codec: json as IRuntimePeerSourceResult['pipeline']['codec'],
      framer: stringFramer as IRuntimePeerSourceResult['pipeline']['framer']
    })
    /** The second source retains whole object identity. */
    const b = physical('b', { codec: identityCodec, framer: messageFramerV1 })
    /** Report failures without changing their original identity. */
    const report = vi.fn()
    /** The mux itself owns no endpoint or provider catalog. */
    const mux = createHostMultiplexTransport({ name: 'host', instanceId: 'host' }, report)
    /** Deliveries preserve their physical source rather than trusting any envelope sender field. */
    const received: IRpcInboundMessage[] = []
    mux.channel.transport.subscribe((message) => {
      received.push(message)
    })
    /** Detachment belongs only to this borrowed source registration. */
    const detachA = mux.attach(a.channel)
    expect(a.activateReceive).not.toHaveBeenCalled()
    mux.channel.activateReceive?.()
    expect(a.activateReceive).toHaveBeenCalledTimes(1)
    mux.attach(b.channel)
    expect(b.activateReceive).toHaveBeenCalledTimes(1)
    await mux.channel.transport.send(request('a', 'one'))
    await mux.channel.transport.send(request('b', 'two'))
    expect(a.sent.length).toBeGreaterThan(1)
    expect(b.sent).toHaveLength(1)
    expect(b.sent[0]!.frame).toEqual(request('b', 'two'))
    for (const { frame } of a.sent)
      for (const listener of a.incoming) listener({ data: frame, peerId: 'forged' })
    for (const listener of b.incoming) listener({ data: b.sent[0]!.frame })
    expect(received.map(({ data }) => data)).toEqual([request('a', 'one'), request('b', 'two')])
    expect(received.map(({ peerId }) => peerId)).toEqual(['a', 'b'])
    expect(mux.channel.transport.sourceProof?.(received[0]!.source)).toBe(true)
    expect(mux.channel.transport.sourceProof?.({})).toBe(false)
    detachA()
    detachA()
    expect(mux.channel.transport.sourceProof?.(received[0]!.source)).toBe(false)
    expect(a.incoming.size).toBe(0)
    expect(a.close).not.toHaveBeenCalled()
    await mux.close()
    expect(b.incoming.size).toBe(0)
    expect(b.close).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('preserves runtime root routing, transfer identity and independently accepted capabilities', async () => {
    /** Transfer ownership belongs to the physical sender, so the list is forwarded unchanged. */
    const source = physical('a', { codec: identityCodec, framer: messageFramerV1 })
    /** The full logical agreement must not manufacture capabilities on this actual peer. */
    const mux = createHostMultiplexTransport({ name: 'host', instanceId: 'host' }, vi.fn())
    mux.attach(source.channel)
    /** This root-level route is the existing runtime profile, distinct from legacy data.route. */
    const frame = { profile: 'migaia.rpc.runtime-api/1', id: 'runtime', route: { targetId: 'a' } }
    /** Native ownership inputs remain the exact original physical send options. */
    const options = { transfer: [new ArrayBuffer(8)] }
    await mux.channel.transport.send(frame, options)
    expect(source.sent[0]).toEqual({ frame, options })
    expect(source.sent[0]!.options).toBe(options)
    expect(mux.supports('a', RpcCapability.batch)).toBe(true)
    expect(mux.supports('a', 'missing')).toBe(false)
    expect(mux.supports('missing', RpcCapability.batch)).toBe(false)
    /** Negotiated strings cannot confer native transfer ownership on a forged physical adapter. */
    const forged = physical('forged', { codec: identityCodec, framer: messageFramerV1 })
    mux.attach({
      ...forged.channel,
      agreement: {
        source: 'static',
        codec: identityCodec.id,
        capabilities: [RpcCapability.nativeBinary, RpcCapability.transfer]
      }
    })
    expect(mux.supports('forged', RpcCapability.nativeBinary)).toBe(false)
    expect(mux.supports('forged', RpcCapability.transfer)).toBe(false)
    await mux.close()
  })

  it('routes opaque protected frames by the sender selection and partitions mixed-target batches', async () => {
    /** Protected values need not expose any semantic fields to the physical boundary. */
    const a = physical('a', { codec: identityCodec, framer: messageFramerV1 })
    /** A distinct source must never receive another target's protected frame. */
    const b = physical('b', { codec: identityCodec, framer: messageFramerV1 })
    /** Real endpoint routing remains outside this adapter-only check. */
    const mux = createHostMultiplexTransport({ name: 'host', instanceId: 'host' }, vi.fn())
    mux.attach(a.channel)
    mux.attach(b.channel)
    await mux.channel.transport.send('opaque protected frame', { targetId: 'a' })
    expect(a.sent[0]!.frame).toBe('opaque protected frame')
    expect(b.sent).toHaveLength(0)
    await expect(mux.channel.transport.send('opaque without selection')).rejects.toMatchObject({
      code: 'CAPABILITY_UNSUPPORTED'
    })
    await mux.channel.transport.send({
      kind: RpcBatchPhysical.kind,
      envelopes: [request('a', 'first'), request('b', 'second'), request('a', 'third')]
    })
    expect(a.sent[1]!.frame).toEqual({
      kind: RpcBatchPhysical.kind,
      envelopes: [request('a', 'first'), request('a', 'third')]
    })
    expect(b.sent[0]!.frame).toEqual({
      kind: RpcBatchPhysical.kind,
      envelopes: [request('b', 'second')]
    })
    /** Logical and channel close share one exact Promise and never close the original receipts. */
    const closed = mux.close()
    expect(mux.close()).toBe(closed)
    expect(mux.channel.close()).toBe(closed)
    await closed
    expect(a.close).not.toHaveBeenCalled()
    expect(b.close).not.toHaveBeenCalled()
  })

  it('detaches only a physically failed source and reports the original failure', async () => {
    /** Each peer has separate actual physical failure hooks. */
    const a = physical('a', { codec: identityCodec, framer: messageFramerV1 })
    /** Failure of A must leave B routable. */
    const b = physical('b', { codec: identityCodec, framer: messageFramerV1 })
    /** The actual cause remains observable through the existing reporter. */
    const report = vi.fn()
    /** No logical endpoint is created for this isolated resource check. */
    const mux = createHostMultiplexTransport({ name: 'host', instanceId: 'host' }, report)
    mux.attach(a.channel)
    mux.attach(b.channel)
    /** The physical adapter supplies this exact original error object. */
    const cause = new Error('physical departure')
    for (const listener of Array.from(a.errors)) listener(cause)
    expect(report).toHaveBeenCalledWith(cause)
    expect(a.incoming.size).toBe(0)
    expect(mux.supports('a', RpcCapability.batch)).toBe(false)
    await mux.channel.transport.send(request('b', 'live'))
    expect(b.sent).toHaveLength(1)
    expect(a.close).not.toHaveBeenCalled()
    await mux.close()
  })
})
