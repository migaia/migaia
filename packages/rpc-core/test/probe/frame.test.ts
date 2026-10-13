import { carrierSizeBytes } from '../../dist/adapter/internal-advanced.js'
import { describe, expect, it, vi } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { RpcRouteProfile, RpcBatchPhysical, type IRpcEnvelope } from '@migaia/rpc-contract'
import { rpcProtocol } from '@migaia/rpc-contract/v1'
import { bindRpcFrameIngress, createStringFramer } from '@migaia/rpc-contract/framing'
import { messageFramer } from '@migaia/rpc-contract/framing/v1'
import {
  defineProbe,
  probePlugin,
  snapshotProbeEvent,
  RpcProbeDirection,
  RpcProbeStage,
  type IRpcProbeEventView,
  type IRpcProbeStageName
} from '../../dist/core/probe/index.js'
import { createProbeEmitter } from '../../dist/core/internal/probe-emitter.js'
import { RpcOutboundSender } from '../../dist/core/internal/outbound-sender.js'
import type { IRpcSelectedComponents } from '../../dist/core/internal/endpoint-options.js'
import type { IRpcOutboundTransport } from '../../dist/core/internal/outbound-sender.js'
import type { IRpcAuthenticationCapability } from '../../dist/core/typing.js'
import { createEndpoint, connect } from '../../dist/core/index.js'
import { createMemoryTransportPair } from '../../dist/core/adapters/memory.js'
import { codec } from '../../dist/core/middleware/codec.js'
import { framer } from '../../dist/core/middleware/framer.js'
import { authentication } from '../../dist/core/middleware/authentication.js'

/** One normalized request proves observations use the existing semantic object unchanged. */
function request(id = 'frame-request'): IRpcEnvelope {
  return rpcProtocol.normalize({
    kind: 'request',
    id,
    method: 'echo',
    data: {
      route: {
        profile: RpcRouteProfile,
        type: 'request',
        applicationVersion: '1',
        senderId: 'frame-caller',
        targetId: 'frame-provider',
        sentAt: 0
      },
      payload: { secret: 'business-value' }
    }
  })
}

/** Codec/framer seams are the sender's existing component boundary, not another send path. */
function components(
  encode: (message: IRpcEnvelope) => unknown,
  encodedType: 'string' | 'uint8array' | 'unknown' = 'string',
  frames?: readonly unknown[]
): IRpcSelectedComponents {
  /** A three-frame fixture keeps chunk identities independent of semantic payload length. */
  const framer: IRpcSelectedComponents['framer'] = frames
    ? {
        id: 'probe-frame-fixture',
        version: 1,
        inputEncodedType: encodedType,
        outputEncodedType: encodedType,
        frame: () => frames,
        accept: (value) => ({ status: 'complete', value }),
        close: () => undefined
      }
    : messageFramer
  return {
    protocol: rpcProtocol,
    codec: {
      id: 'probe-codec-fixture',
      version: 1,
      encodedType,
      encode,
      decode: (value) => rpcProtocol.normalize(value)
    },
    framer,
    ingressPrepare: bindRpcFrameIngress(framer.accept, framer.frame),
    shadowed: []
  }
}

/** Installs the genuine emitter while retaining the sender's original public transport seam. */
function observedSender(options: {
  readonly events: IRpcProbeEventView[]
  readonly selected: IRpcSelectedComponents
  readonly transport?: IRpcOutboundTransport
  readonly authentication?: IRpcAuthenticationCapability
  readonly fast?: boolean
  readonly batch?: boolean
  readonly capture?: readonly IRpcProbeStageName[]
  readonly redact?: (stage: RpcProbeStage, content: unknown) => unknown
}) {
  /** Explicit snapshotProbeEvent is SC9(c), required when retaining the reusable view in a test. */
  const probe = defineProbe({
    stages: ['envelope', 'encoded', 'frame', 'protected'],
    capture: options.capture,
    redact: options.redact,
    emit: (view) => options.events.push(snapshotProbeEvent(view))
  })
  /** Only the fixture clock is substituted; dispatch is the production emitter. */
  const emitter = createProbeEmitter([probe], () => 1, 'frame-caller')
  /** The optional writer exposes exact physical calls and transfer behavior without an adapter. */
  const transport = options.transport ?? { platform: 'Memory' as const, send: vi.fn() }
  return {
    sender: new RpcOutboundSender(
      transport,
      'frame-caller',
      options.selected,
      options.authentication,
      transport.platform,
      undefined,
      undefined,
      options.fast,
      options.batch,
      undefined,
      undefined,
      undefined,
      emitter
    ),
    emitter,
    probe,
    transport
  }
}

describe('probe-core A3 outbound frames', () => {
  it('[closure A7] keeps every string size unknown while intrinsic byte extents stay exact', async () => {
    expect(carrierSizeBytes('ascii')).toBe(-1)
    expect(carrierSizeBytes('é😀\ud800')).toBe(-1)
    /** Byte views retain their exact selected span independently of string wire representation. */
    const backing = new ArrayBuffer(8)
    expect(carrierSizeBytes(backing)).toBe(8)
    expect(carrierSizeBytes(new Uint8Array(backing, 2, 3))).toBe(3)
    expect(carrierSizeBytes(new DataView(backing, 1, 4))).toBe(4)
    for (const encodedType of ['string', 'any'] as const) {
      /** String sizes remain unknown in both supported transport representations. */
      const events: IRpcProbeEventView[] = []
      /** This representation includes non-ASCII UTF-8 and a lone surrogate's replacement width. */
      const fixture = observedSender({
        events,
        selected: components(() => 'é😀\ud800'),
        transport: { platform: 'Memory', encodedType, send: vi.fn() }
      })
      await fixture.sender.send(request())
      expect(
        events
          .filter(
            (event) => event.stage === RpcProbeStage.encoded || event.stage === RpcProbeStage.frame
          )
          .map((event) => event.sizeBytes)
      ).toEqual([-1, -1])
      fixture.emitter.dispose()
    }
  })

  it('observes a real authenticated three-chunk receive before the unchanged provider result', async () => {
    /** Consumer snapshots retain both genuine endpoint timelines without changing the pipeline. */
    const callerEvents: IRpcProbeEventView[] = [],
      providerEvents: IRpcProbeEventView[] = []
    /** The public probes capture only the existing pre/post authentication values. */
    const callerProbe = defineProbe({
      stages: ['envelope', 'encoded', 'frame', 'protected'],
      capture: ['frame', 'protected'],
      emit: (view) => callerEvents.push(snapshotProbeEvent(view))
    })
    /** Provider-side stages exercise actual unprotect, reassembly and decoding. */
    const providerProbe = defineProbe({
      stages: ['envelope', 'encoded', 'frame', 'protected'],
      capture: ['frame', 'protected'],
      emit: (view) => providerEvents.push(snapshotProbeEvent(view))
    })
    /** Each endpoint retains its own real replay/authentication capability and transform order. */
    const security = () =>
      authentication({
        encodedType: 'string',
        encrypt: (value) => `encrypted:${JSON.stringify(value)}`,
        decrypt: (value) => JSON.parse(String(value).slice('encrypted:'.length)),
        sign: (value) => `signed:${String(value)}`,
        verify: (value) => String(value).slice('signed:'.length)
      })
    /** Core's own reference adapter supplies a real inbound transport boundary. */
    const [left, right] = createMemoryTransportPair()
    /** One provider invocation must see and return the original business payload. */
    let calls = 0
    /** The canonical JSON codec and canonical string framer create exactly three physical chunks. */
    const server = await createEndpoint({
      id: 'paired-provider',
      transport: right,
      middlewares: [
        connect(),
        codec(defineJsonCodec({ version: 1 })),
        framer(createStringFramer({ chunkBytes: 512, maxMessageBytes: 8192 })),
        security(),
        probePlugin(providerProbe)
      ],
      provider: {
        echo: (context) => {
          calls += 1
          return context.success(context.data)
        }
      }
    })
    /** The independent caller owns matching public component and authentication ports. */
    const client = await createEndpoint({
      id: 'paired-caller',
      transport: left,
      middlewares: [
        connect(),
        codec(defineJsonCodec({ version: 1 })),
        framer(createStringFramer({ chunkBytes: 512, maxMessageBytes: 8192 })),
        security(),
        probePlugin(callerProbe)
      ]
    })
    try {
      /** Padding exceeds two chunk widths after route encoding, while staying below three widths. */
      const payload = { business: 'unchanged', padding: 'x'.repeat(1024) }
      expect(await client.send('paired-provider', 'echo', payload)).toEqual(payload)
      expect(calls).toBe(1)
      /** Outbound protection retains the sender's existing concurrent chunk preparation. */
      const outbound = callerEvents.filter(
        (event) => event.direction === RpcProbeDirection.outbound && event.method === 'echo'
      )
      expect(outbound.map((event) => event.stage)).toEqual([
        RpcProbeStage.envelope,
        RpcProbeStage.encoded,
        RpcProbeStage.frame,
        RpcProbeStage.frame,
        RpcProbeStage.frame,
        RpcProbeStage.protected,
        RpcProbeStage.protected,
        RpcProbeStage.protected
      ])
      /** Opaque protected events have no ID yet; exact transmitted values select this request. */
      const protectedValues = new Set(
        outbound
          .filter((event) => event.stage === RpcProbeStage.protected)
          .map((event) => event.content)
      )
      /** Actual microtask delivery starts all unprotect operations before reassembly completes. */
      const inbound = providerEvents.filter(
        (event) =>
          event.direction === RpcProbeDirection.inbound &&
          (event.stage === RpcProbeStage.protected
            ? protectedValues.has(event.content)
            : event.messageId === outbound[0]!.messageId)
      )
      expect(inbound.map((event) => event.stage)).toEqual([
        RpcProbeStage.protected,
        RpcProbeStage.protected,
        RpcProbeStage.protected,
        RpcProbeStage.frame,
        RpcProbeStage.frame,
        RpcProbeStage.frame,
        RpcProbeStage.encoded,
        RpcProbeStage.envelope
      ])
      for (let index = 0; index < 3; index += 1) {
        /** The same physical protected value crosses the adapter and precedes its plaintext frame. */
        const protectedEvent = inbound[index]!,
          frameEvent = inbound[3 + index]!
        expect(protectedEvent.content).toBe(outbound[5 + index]!.content)
        expect(frameEvent.content).toEqual(outbound[2 + index]!.content)
        expect(protectedEvent.content).not.toEqual(frameEvent.content)
        expect(protectedEvent.seq).toBeLessThan(frameEvent.seq)
        expect(frameEvent.content).toMatchObject({
          messageId: outbound[0]!.messageId,
          index,
          count: 3
        })
      }
      expect(inbound[6]!.seq).toBeGreaterThan(inbound[5]!.seq)
      expect(inbound[7]).toMatchObject({
        messageId: outbound[0]!.messageId,
        method: 'echo',
        senderId: 'paired-caller'
      })
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
      left.close()
      right.close()
    }
  })

  it('observes each actual chunk before protection and its result without changing writes', async () => {
    /** Retained snapshots make the positional fields and chronological stage order inspectable. */
    const events: IRpcProbeEventView[] = []
    /** Each plaintext chunk has a distinct protected representation. */
    const frames = ['plain-a', 'plain-b', 'plain-c']
    /** This transform uses the same async boundary and concurrency as real authentication. */
    const protect = vi.fn((value: unknown) => `protected:${String(value)}`)
    /** Physical sends remain separately countable and preserve their original order. */
    const send = vi.fn()
    /** A minimal capability isolates the sender's actual protect stage from authentication grammar. */
    const authentication: IRpcAuthenticationCapability = {
      enabled: true,
      encodedType: 'string',
      protect,
      unprotect: (value) => value
    }
    /** Content capture is deliberately limited to the two physical stages. */
    const fixture = observedSender({
      events,
      selected: components(() => 'encoded', 'string', frames),
      authentication,
      transport: { platform: 'Memory', encodedType: 'string', send },
      capture: ['frame', 'protected']
    })
    await fixture.sender.send(request())
    expect(events.map((event) => event.stage)).toEqual([
      RpcProbeStage.envelope,
      RpcProbeStage.encoded,
      RpcProbeStage.frame,
      RpcProbeStage.frame,
      RpcProbeStage.frame,
      RpcProbeStage.protected,
      RpcProbeStage.protected,
      RpcProbeStage.protected
    ])
    for (let index = 0; index < frames.length; index += 1) {
      /** Frame pairing follows chunk identity, while existing concurrent preparation stays intact. */
      const before = events[2 + index]!,
        after = events[5 + index]!
      expect(before).toMatchObject({
        direction: RpcProbeDirection.outbound,
        messageId: 'frame-request',
        chunkIndex: index,
        chunkCount: 3,
        content: frames[index]
      })
      expect(after).toMatchObject({ chunkIndex: index, chunkCount: 3 })
      expect(after.content).toBe(`protected:${frames[index]}`)
      expect(before.seq).toBeLessThan(after.seq)
      expect(before.content).not.toBe(after.content)
    }
    expect(protect.mock.calls.map(([value]) => value)).toEqual(frames)
    expect(send.mock.calls.map(([value]) => value)).toEqual(
      frames.map((frame) => `protected:${frame}`)
    )
    fixture.emitter.dispose()
  })

  it('keeps content absent without capture and passes the normalized envelope by reference', async () => {
    /** Envelope identity must survive observation, including a second capture-enabled send. */
    const message = request()
    /** The first sender opts into metadata alone. */
    const metadata: IRpcProbeEventView[] = []
    /** The canonical identity codec accepts exactly the existing normalized object. */
    const encode = vi.fn((value: IRpcEnvelope) => value)
    /** A plain object transport keeps the existing identity-codec path. */
    const absent = observedSender({ events: metadata, selected: components(encode, 'unknown') })
    await absent.sender.send(message)
    expect(metadata).toHaveLength(3)
    expect(metadata.every((event) => event.content === undefined)).toBe(true)
    expect(encode).toHaveBeenCalledExactlyOnceWith(message)
    absent.emitter.dispose()
    /** The second sender captures only envelope; other stage values stay absent. */
    const captured: IRpcProbeEventView[] = []
    /** No copy or second normalization may replace this semantic value. */
    const present = observedSender({
      events: captured,
      selected: components((value) => value, 'unknown'),
      capture: ['envelope']
    })
    await present.sender.send(message)
    expect(captured[0]?.content).toBe(message)
    expect(captured.slice(1).every((event) => event.content === undefined)).toBe(true)
    present.emitter.dispose()
  })

  it('redacts only captured content while the original codec and transport retain business data', async () => {
    /** An explicitly requested redaction result may differ from the business envelope. */
    const redacted = { secret: '[masked]' }
    /** The exact original semantic object remains available to codec and physical writer. */
    const message = request()
    /** Snapshot retention is confined to the observer fixture. */
    const events: IRpcProbeEventView[] = []
    /** The business writer must still receive the original object, not the redacted result. */
    const send = vi.fn()
    /** Redaction records its exact original input to catch a second normalization or clone. */
    const redact = vi.fn(() => redacted)
    /** The production emitter owns redaction rather than sender call-site helpers. */
    const fixture = observedSender({
      events,
      selected: components((value) => value, 'unknown'),
      transport: { platform: 'Memory', send },
      capture: ['envelope'],
      redact
    })
    await fixture.sender.send(message)
    expect(redact).toHaveBeenCalledExactlyOnceWith(RpcProbeStage.envelope, message)
    expect(events[0]?.content).toBe(redacted)
    expect(send.mock.calls[0]?.[0]).toBe(message)
    expect(message.data.payload).toEqual({ secret: 'business-value' })
    fixture.emitter.dispose()
  })

  it('copies captured bytes only when their original backing will transfer', async () => {
    /** One backing contains a prefix and suffix outside the captured view. */
    const backing = new ArrayBuffer(8)
    /** The transferred view proves capture honors byte offset and length. */
    const bytes = new Uint8Array(backing, 2, 3)
    bytes.set([4, 5, 6])
    /** Retained snapshots must survive the real detachment performed by the physical writer. */
    const events: IRpcProbeEventView[] = []
    /** SC9(a) applies only to the actual transfer list consumed by this writer. */
    const send = vi.fn((value: unknown, options?: { transfer?: readonly unknown[] }) => {
      structuredClone(value, { transfer: options?.transfer as Transferable[] })
    })
    /** All byte stages share the same original view before physical transfer. */
    const fixture = observedSender({
      events,
      selected: components(() => bytes, 'uint8array'),
      transport: { platform: 'Memory', encodedType: 'uint8array', send },
      capture: ['encoded', 'frame']
    })
    await fixture.sender.send(request(), { transfer: [backing] })
    expect(backing.byteLength).toBe(0)
    for (const event of events.slice(1)) {
      expect(event.content).toBeInstanceOf(Uint8Array)
      /** Boolean identity avoids Vitest's deep-equality hint walking the detached original view. */
      expect(event.content === bytes).toBe(false)
      expect(Array.from(event.content as Uint8Array)).toEqual([4, 5, 6])
    }
    fixture.emitter.dispose()
    /** A non-transferred byte view must remain the original reference. */
    const retained = new Uint8Array([7, 8, 9])
    /** This fixture opts into the same stages without any transfer list. */
    const references: IRpcProbeEventView[] = []
    /** Identity, rather than only equal bytes, proves the no-copy path. */
    const ordinary = observedSender({
      events: references,
      selected: components(() => retained, 'uint8array'),
      capture: ['encoded', 'frame']
    })
    await ordinary.sender.send(request())
    expect(references[1]?.content).toBe(retained)
    expect(references[2]?.content).toBe(retained)
    ordinary.emitter.dispose()
  })

  it('emits no frame stage on the existing fast send path', async () => {
    /** The real fast owner omits framing; installing a probe may not restore it. */
    const events: IRpcProbeEventView[] = []
    /** Codec output alone reaches the same physical writer. */
    const fixture = observedSender({ events, selected: components(() => 'encoded'), fast: true })
    await fixture.sender.send(request())
    expect(events.map((event) => event.stage)).toEqual([
      RpcProbeStage.envelope,
      RpcProbeStage.encoded
    ])
    fixture.emitter.dispose()
  })

  it('emits one envelope event for every physical batch member', async () => {
    /** Busy transport holds one write so the existing sender collects a real two-member batch. */
    let release: (() => void) | undefined
    /** Every physical invocation retains its original exact wire object. */
    const writes: unknown[] = []
    /** Only the initial physical write waits; the queued batch completes normally. */
    const send = (value: unknown) => {
      writes.push(value)
      if (writes.length === 1)
        return new Promise<void>((resolve) => {
          release = resolve
        })
    }
    /** The canonical identity codec provides the sender's actual private batching qualification. */
    const selected = components((value) => value, 'unknown')
    /** Exact codec identity keeps the ordinary batching size proof intact. */
    const canonical: IRpcSelectedComponents = {
      ...selected,
      codec: identityCodecV1 as IRpcSelectedComponents['codec']
    }
    /** The retained metadata reveals semantic members independently of physical write count. */
    const events: IRpcProbeEventView[] = []
    /** Batch and fast switches select the same existing owner, without another grouping fixture. */
    const fixture = observedSender({
      events,
      selected: canonical,
      transport: { platform: 'Memory', send },
      fast: true,
      batch: true,
      capture: ['envelope']
    })
    /** The initial send immediately owns the idle transport. */
    const first = fixture.sender.send(request('first'))
    /** Both later messages queue while that actual physical write remains pending. */
    const second = fixture.sender.send(request('second')),
      third = fixture.sender.send(request('third'))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release!()
    await Promise.all([first, second, third])
    expect(writes).toHaveLength(2)
    expect(writes[1]).toMatchObject({ kind: RpcBatchPhysical.kind })
    /** Semantic observation count follows physical membership, never only the first member. */
    const envelopes = events.filter((event) => event.stage === RpcProbeStage.envelope)
    expect(envelopes.map((event) => [event.messageId, event.members])).toEqual([
      ['first', -1],
      ['second', 2],
      ['third', 2]
    ])
    expect(envelopes[1]?.content).toBe((writes[1] as { envelopes: IRpcEnvelope[] }).envelopes[0])
    expect(envelopes[2]?.content).toBe((writes[1] as { envelopes: IRpcEnvelope[] }).envelopes[1])
    fixture.emitter.dispose()
  })
})
