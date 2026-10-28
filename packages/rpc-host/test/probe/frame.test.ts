/** Real Session/probe owners retain frame capture, transfer and physical write evidence. */
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { chunkFeature } from '@migaia/rpc-host/plugins/chunk'
import { batchFeature } from '@migaia/rpc-host/plugins/batch'
import {
  probe,
  defineProbe,
  RpcProbeDirection,
  RpcProbeStage,
  type IRpcProbeEventView,
  type IRpcProbeStageName
} from '@migaia/rpc-host/plugins/probe'
import type { IRpcFlowFeature } from '@migaia/rpc-host/sdk'
import type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { carrierSizeBytes } from '../../dist/sdk/wire/probe-content.js'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** The existing carrier fixture lends its actual codec, native write and current Host owners. */
async function observedHosts(options: {
  readonly events: IRpcProbeEventView[]
  readonly incoming?: IRpcProbeEventView[]
  readonly capture?: readonly IRpcProbeStageName[]
  readonly redact?: (stage: RpcProbeStage, content: unknown) => unknown
  readonly features?: readonly IRpcFlowFeature[]
  readonly json?: boolean
  readonly echo?: (value: unknown) => unknown
}) {
  /** Each retained event copies only the production emitter's reusable view. */
  const callerProbe = defineProbe({
    stages: ['envelope', 'encoded', 'frame', 'protected'],
    capture: options.capture,
    redact: options.redact,
    emit: (view) => options.events.push(Object.freeze({ ...view }))
  })
  /** Real JSON preparation is selected only when the scenario requires text/chunk/batch encoding. */
  const listener = coreMemoryServer(
    'frame-caller',
    'frame-caller',
    'memory',
    [],
    [],
    options.json ? { create: () => new RpcJsonCarrierCodec(), nativeBinary: false } : undefined
  )
  /** Observation is installed through the same native public plugin path as other Host consumers. */
  const caller = await createRpcHost({
    ...listener.options,
    plugins: [...(options.features ?? []), probe(callerProbe), listener.transport]
  })
  try {
    /** The provider probe sees actual codec restoration and genuine provider invocation. */
    const providerProbe =
      options.incoming &&
      probe({
        stages: ['envelope', 'encoded', 'frame', 'protected'],
        capture: options.capture,
        emit: (view) => options.incoming!.push(Object.freeze({ ...view }))
      })
    /** Both real installations receive independent state from the same cold Feature definitions. */
    const connected = await listener.connect('frame-provider', {
      plugins: [...(options.features ?? []), ...(providerProbe ? [providerProbe] : [])],
      provide: { echo: options.echo ?? ((value: unknown) => value) }
    })
    options.events.length = 0
    if (options.incoming) options.incoming.length = 0
    return { caller, provider: connected.host, pair: connected.pair }
  } catch (error) {
    await caller.close()
    throw error
  }
}

/** Direction remains an actual Session fact, including opaque protection events without task ids. */
function outbound(events: readonly IRpcProbeEventView[]): IRpcProbeEventView[] {
  return events.filter((event) => event.direction === RpcProbeDirection.outbound)
}

/** Each real transform preserves the original encrypt-before-sign and verify-before-decrypt order. */
function security() {
  return authFeature({
    encodedType: 'string',
    encrypt: (value) => `encrypted:${JSON.stringify(value)}`,
    decrypt: (value) => JSON.parse(String(value).slice('encrypted:'.length)),
    sign: (value) => `signed:${String(value)}`,
    verify: (value) => String(value).slice('signed:'.length)
  })
}

describe('probe-core outbound frames', () => {
  it('keeps every string size unknown while intrinsic byte extents stay exact', async () => {
    expect(carrierSizeBytes('ascii')).toBe(-1)
    expect(carrierSizeBytes('é😀\ud800')).toBe(-1)
    /** The original native view extents remain independent of selected string representation. */
    const backing = new ArrayBuffer(8)
    expect(carrierSizeBytes(backing)).toBe(8)
    expect(carrierSizeBytes(new Uint8Array(backing, 2, 3))).toBe(3)
    expect(carrierSizeBytes(new DataView(backing, 1, 4))).toBe(4)
    for (const json of [true, false]) {
      /** Genuine JSON and native-any media retain the same unknown string/structured size policy. */
      const events: IRpcProbeEventView[] = []
      const fixture = await observedHosts({ events, json })
      try {
        await fixture.caller.memory!.send('frame-provider', 'echo', 'é😀\ud800')
        expect(
          outbound(events)
            .filter(
              (event) =>
                event.stage === RpcProbeStage.encoded || event.stage === RpcProbeStage.frame
            )
            .map((event) => event.sizeBytes)
        ).toEqual([-1, -1])
      } finally {
        await Promise.all([fixture.caller.close(), fixture.provider.close()])
      }
    }
  })

  it('observes a real authenticated three-chunk receive before the unchanged provider result', async () => {
    const callerEvents: IRpcProbeEventView[] = []
    const providerEvents: IRpcProbeEventView[] = []
    let calls = 0
    /** Current profile geometry uses real whole-message authentication before negotiated chunks. */
    const fixture = await observedHosts({
      events: callerEvents,
      incoming: providerEvents,
      capture: ['frame', 'protected'],
      features: [security(), chunkFeature({ chunkBytes: 1024, maxMessageBytes: 8192 })],
      json: true,
      echo: (value) => {
        calls += 1
        return value
      }
    })
    try {
      const payload = { business: 'unchanged', padding: 'x'.repeat(1024) }
      expect(await fixture.caller.memory!.send('frame-provider', 'echo', payload)).toEqual(payload)
      expect(calls).toBe(1)
      const sent = outbound(callerEvents)
      /** Protects once at envelopeOutbound; frameOutbound then emits the three real chunks. */
      expect(sent.map((event) => event.stage)).toEqual([
        RpcProbeStage.envelope,
        RpcProbeStage.protected,
        RpcProbeStage.encoded,
        RpcProbeStage.frame,
        RpcProbeStage.frame,
        RpcProbeStage.frame
      ])
      const inbound = providerEvents.filter(
        (event) => event.direction === RpcProbeDirection.inbound
      )
      expect(inbound.map((event) => event.stage)).toEqual([
        RpcProbeStage.frame,
        RpcProbeStage.frame,
        RpcProbeStage.frame,
        RpcProbeStage.encoded,
        RpcProbeStage.protected,
        RpcProbeStage.envelope
      ])
      const protectedSent = sent[1]!.content as { payload: string }
      const protectedReceived = inbound[4]!.content as { payload: string }
      expect(protectedReceived.payload).toBe(protectedSent.payload)
      for (let index = 0; index < 3; index += 1) {
        const frameEvent = inbound[index]!
        const sentFrame = sent[3 + index]!
        expect(frameEvent.content).toBe(sentFrame.content)
        expect(frameEvent.content).not.toEqual(protectedSent)
        expect(frameEvent.seq).toBeLessThan(inbound[4]!.seq)
        expect(frameEvent.content).toMatchObject({
          messageId: (sent[3]!.content as { messageId: string }).messageId,
          index,
          count: 3
        })
        /** These public metadata oracles remain applicable to current negotiated chunk records. */
        expect(sentFrame).toMatchObject({ chunkIndex: index, chunkCount: 3 })
      }
      expect(inbound[3]!.seq).toBeGreaterThan(inbound[2]!.seq)
      expect(inbound[5]).toMatchObject({
        messageId: sent[0]!.messageId,
        method: 'echo',
        senderId: 'frame-caller'
      })
    } finally {
      await Promise.all([fixture.caller.close(), fixture.provider.close()])
    }
  })

  it('observes each actual chunk before protection and its result without changing writes', async () => {
    const events: IRpcProbeEventView[] = []
    /**
     * The transform is still the real auth Feature callback; the obsolete per-chunk hook is
     * retired.
     */
    const protect = vi.fn((value: unknown) => `protected:${String(value)}`)
    const fixture = await observedHosts({
      events,
      capture: ['frame', 'protected'],
      json: true,
      features: [
        authFeature({
          encodedType: 'string',
          sign: protect,
          verify: (value) => String(value).slice('protected:'.length)
        }),
        chunkFeature({ chunkBytes: 768, maxMessageBytes: 8192 })
      ]
    })
    /** Original carrier writes remain genuine and independently countable. */
    const send = vi.spyOn(fixture.pair[0], 'write')
    protect.mockClear()
    try {
      const payload = { secret: 'business-value', padding: 'x'.repeat(1024) }
      expect(await fixture.caller.memory!.send('frame-provider', 'echo', payload)).toEqual(payload)
      const selected = outbound(events)
      expect(selected.map((event) => event.stage)).toEqual([
        RpcProbeStage.envelope,
        RpcProbeStage.protected,
        RpcProbeStage.encoded,
        RpcProbeStage.frame,
        RpcProbeStage.frame,
        RpcProbeStage.frame
      ])
      const frames = selected.filter((event) => event.stage === RpcProbeStage.frame)
      const protectedEvents = selected.filter((event) => event.stage === RpcProbeStage.protected)
      expect(protectedEvents).toHaveLength(1)
      expect(frames).toHaveLength(3)
      expect(protect).toHaveBeenCalledTimes(2)
      /** Each endpoint signs its one whole request or reply, without per-chunk protection calls. */
      expect(protectedEvents[0]!.content).toMatchObject({ payload: protect.mock.results[0]!.value })
      expect(selected[0]!.seq).toBeLessThan(protectedEvents[0]!.seq)
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index]!
        expect(frame).toMatchObject({
          direction: RpcProbeDirection.outbound,
          messageId: selected[0]!.messageId,
          chunkIndex: index,
          chunkCount: frames.length
        })
        expect(frame.content).toBe(send.mock.calls[index]![0].data)
        expect(protectedEvents[0]!.seq).toBeLessThan(frame.seq)
        expect(frame.content).not.toBe(protectedEvents[0]!.content)
      }
      expect(send).toHaveBeenCalledTimes(frames.length)
    } finally {
      send.mockRestore()
      await Promise.all([fixture.caller.close(), fixture.provider.close()])
    }
  })

  it('keeps content absent without capture and passes the normalized envelope by reference', async () => {
    const metadata: IRpcProbeEventView[] = []
    const absent = await observedHosts({ events: metadata })
    /**
     * The actual prepare boundary now receives the unchanged semantic input; encode receives
     * preparation.
     */
    const encode = vi.spyOn(absent.pair[0].codec, 'prepare')
    /** Notify admission precedes physical completion; the original write receipt fences assertions. */
    const absentWrite = vi.spyOn(absent.pair[0], 'write')
    try {
      await absent.caller.memory!.dispatch('frame-provider', 'echo', { secret: 'business-value' })
      await vi.waitFor(() => expect(absentWrite).toHaveBeenCalledTimes(1))
      await absentWrite.mock.results[0]!.value
      expect(outbound(metadata)).toHaveLength(3)
      expect(outbound(metadata).every((event) => event.content === undefined)).toBe(true)
      expect(encode).toHaveBeenCalledExactlyOnceWith(
        absentWrite.mock.calls[0]![0].data,
        expect.anything()
      )
    } finally {
      encode.mockRestore()
      absentWrite.mockRestore()
      await Promise.all([absent.caller.close(), absent.provider.close()])
    }
    const captured: IRpcProbeEventView[] = []
    const present = await observedHosts({ events: captured, capture: ['envelope'] })
    const prepare = vi.spyOn(present.pair[0].codec, 'prepare')
    /** This is the actual Session's physical write, not the early notify admission Promise. */
    const presentWrite = vi.spyOn(present.pair[0], 'write')
    try {
      await present.caller.memory!.dispatch('frame-provider', 'echo', { secret: 'business-value' })
      await vi.waitFor(() => expect(presentWrite).toHaveBeenCalledTimes(1))
      await presentWrite.mock.results[0]!.value
      const selected = outbound(captured)
      expect(selected[0]?.content).toBe(prepare.mock.calls[0]![0])
      expect(selected.slice(1).every((event) => event.content === undefined)).toBe(true)
    } finally {
      prepare.mockRestore()
      presentWrite.mockRestore()
      await Promise.all([present.caller.close(), present.provider.close()])
    }
  })

  it('redacts only captured content while the original codec and transport retain business data', async () => {
    const redacted = { secret: '[masked]' }
    const events: IRpcProbeEventView[] = []
    const redact = vi.fn(() => redacted)
    const fixture = await observedHosts({ events, capture: ['envelope'], redact })
    const send = vi.spyOn(fixture.pair[0], 'write')
    const prepare = vi.spyOn(fixture.pair[0].codec, 'prepare')
    /** Bootstrap and directory observations finish before the original single business redaction. */
    redact.mockClear()
    try {
      await fixture.caller.memory!.dispatch('frame-provider', 'echo', { secret: 'business-value' })
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      await send.mock.results[0]!.value
      const message = prepare.mock.calls[0]![0] as IRpcEnvelope
      expect(redact).toHaveBeenCalledExactlyOnceWith(RpcProbeStage.envelope, message)
      expect(outbound(events)[0]?.content).toBe(redacted)
      expect(send.mock.calls[0]?.[0].data).toBe(message)
      expect('payload' in message && message.payload).toEqual({ secret: 'business-value' })
    } finally {
      send.mockRestore()
      prepare.mockRestore()
      await Promise.all([fixture.caller.close(), fixture.provider.close()])
    }
  })

  it('copies captured bytes only when their original backing will transfer', async () => {
    const backing = new ArrayBuffer(8)
    const bytes = new Uint8Array(backing, 2, 3)
    bytes.set([4, 5, 6])
    const events: IRpcProbeEventView[] = []
    const fixture = await observedHosts({ events, capture: ['encoded', 'frame'] })
    /**
     * This existing codec's output seam supplies the same opaque byte representation as the old
     * test.
     */
    const encode = vi
      .spyOn(fixture.pair[0].codec, 'encode')
      .mockReturnValue({ kind: 'message', data: bytes })
    /** Native structuredClone is the actual terminal; captures are never fed into delivery. */
    const send = vi.spyOn(fixture.pair[0], 'write').mockImplementation(async (frame, options) => {
      options?.onWriteStart?.()
      structuredClone(frame, { transfer: options?.transfer as Transferable[] | undefined })
    })
    try {
      await fixture.caller.memory!.dispatch('frame-provider', 'echo', null, { transfer: [backing] })
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      await send.mock.results[0]!.value
      expect(backing.byteLength).toBe(0)
      expect(outbound(events)).toHaveLength(3)
      for (const event of outbound(events).slice(1)) {
        expect(event.content).toBeInstanceOf(Uint8Array)
        expect(event.content === bytes).toBe(false)
        expect(Array.from(event.content as Uint8Array)).toEqual([4, 5, 6])
      }
      const retained = new Uint8Array([7, 8, 9])
      events.length = 0
      encode.mockReturnValue({ kind: 'message', data: retained })
      await fixture.caller.memory!.dispatch('frame-provider', 'echo', null)
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
      await send.mock.results[1]!.value
      const references = outbound(events)
      expect(references[1]?.content).toBe(retained)
      expect(references[2]?.content).toBe(retained)
      expect(send).toHaveBeenCalledTimes(2)
    } finally {
      encode.mockRestore()
      send.mockRestore()
      await Promise.all([fixture.caller.close(), fixture.provider.close()])
    }
  })

  // Deletes the private fast path; its only no-frame oracle is retired in the receipt, not passed.

  it('emits one envelope event for every physical batch member', async () => {
    const events: IRpcProbeEventView[] = []
    const fixture = await observedHosts({
      events,
      capture: ['envelope', 'frame'],
      features: [batchFeature()],
      json: true
    })
    const send = vi.spyOn(fixture.pair[0], 'write')
    const prepare = vi.spyOn(fixture.pair[0].codec, 'prepare')
    const encode = vi.spyOn(fixture.pair[0].codec, 'encode')
    try {
      fixture.pair[0].holdWrites()
      const first = fixture.caller.memory!.send('frame-provider', 'echo', 'first', {
        trace: 'first'
      })
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      const second = fixture.caller.memory!.send('frame-provider', 'echo', 'second', {
        trace: 'second'
      })
      const third = fixture.caller.memory!.send('frame-provider', 'echo', 'third', {
        trace: 'third'
      })
      await vi.waitFor(() => expect(encode).toHaveBeenCalledTimes(3))
      fixture.pair[0].releaseWrites()
      expect(await Promise.all([first, second, third])).toEqual(['first', 'second', 'third'])
      expect(send).toHaveBeenCalledTimes(2)
      const writes = send.mock.calls.map(([frame]) => frame)
      expect(writes[1]).toMatchObject({ kind: 'extension', extension: 'batch@1' })
      const envelopes = outbound(events).filter((event) => event.stage === RpcProbeStage.envelope)
      /** Observes each semantic input once before physical batch membership exists. */
      const ids = prepare.mock.calls.map(([message]) => ('id' in message ? message.id : undefined))
      expect(prepare).toHaveBeenCalledTimes(3)
      expect(new Set(ids).size).toBe(3)
      expect(envelopes.map((event) => [event.messageId, event.members])).toEqual([
        [ids[0], -1],
        [ids[1], -1],
        [ids[2], -1]
      ])
      for (let index = 0; index < envelopes.length; index += 1)
        expect(envelopes[index]?.content).toBe(prepare.mock.calls[index]![0])
      /** The actual physical batch alone owns its two-member observation and borrowed data root. */
      const frames = outbound(events).filter((event) => event.stage === RpcProbeStage.frame)
      expect(frames.map((event) => event.members)).toEqual([-1, 2])
      expect(frames[0]?.content).toBe(writes[0]!.data)
      expect(frames[1]?.content).toBe(writes[1]!.data)
      const members = (writes[1]!.data as { frames: unknown[] }).frames
      expect(members).toHaveLength(2)
      expect(members[0]).toBe(encode.mock.results[1]!.value)
      expect(members[1]).toBe(encode.mock.results[2]!.value)
    } finally {
      fixture.pair[0].releaseWrites()
      send.mockRestore()
      prepare.mockRestore()
      encode.mockRestore()
      await Promise.all([fixture.caller.close(), fixture.provider.close()])
    }
  })
})
