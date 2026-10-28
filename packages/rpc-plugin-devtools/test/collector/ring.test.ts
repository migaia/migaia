import { describe, expect, it } from 'vitest'
import { RpcProbeOutcome, RpcProbeStage } from '@migaia/rpc-host/plugins/probe'
import {
  devtoolsPlugin,
  RpcDevtoolsErrorCode,
  RPC_DEVTOOLS_SOURCE
} from '@migaia/rpc-plugin-devtools'
import { CollectorFixture, collectorView } from './fixture.ts'

describe('collector ingestion and ring', () => {
  it('retains the newest four of six views, converts every field and never retains the mutable view', () => {
    /** Four slots force two overwrites on the public ingestion path. */
    const devtools = devtoolsPlugin({ maxEvents: 4 }).collector
    /** One view is intentionally reused; primitive columns must keep each emission. */
    const view = collectorView()
    /** Detail is owned by the caller and retained by reference. */
    const detail = { protocol: 1 }
    view.detail = detail
    view.chunkIndex = 2
    view.chunkCount = 3
    view.members = 4
    try {
      for (let i = 1; i <= 6; i++) {
        view.seq = i
        view.at = 1000 + i
        view.messageId = `message-${i}`
        devtools.emit(view)
      }
      view.method = CollectorFixture.otherMethod
      view.at = 9999
      view.messageId = 'overwritten-view'
      /** Query conversion is the wire boundary; the stored view no longer exists. */
      const page = devtools.query()
      expect(page.events.map((event) => event.seq)).toEqual([3, 4, 5, 6])
      expect(page.counters.evicted).toBe(2)
      expect(page.nextSeq).toBe(6)
      expect(page.events[0]).toMatchObject({
        seq: 3,
        at: 1003,
        endpointId: CollectorFixture.endpoint,
        stage: 'message',
        direction: 'outbound',
        kind: 'request',
        outcome: 'settled',
        messageId: 'message-3',
        method: CollectorFixture.method,
        senderId: CollectorFixture.sender,
        targetId: CollectorFixture.target,
        receiverId: CollectorFixture.receiver,
        peerId: CollectorFixture.peer,
        trace: CollectorFixture.trace,
        carrier: CollectorFixture.carrier,
        sizeBytes: 64,
        chunk: { index: 2, count: 3 },
        members: 4,
        durationMs: 1
      })
      expect(page.events[0]!.detail).toBe(detail)
      detail.protocol = 2
      expect(devtools.query().events[0]!.detail!.protocol).toBe(2)
    } finally {
      devtools.close()
    }
  })

  it('drops content above the byte budget and releases evicted content budget without copying', () => {
    /** A single slot makes replacement release the previous content reference and its bytes. */
    const devtools = devtoolsPlugin({
      maxEvents: 1,
      maxContentBytes: 4,
      stages: ['encoded'],
      capture: ['encoded'],
      exposeContent: true
    }).collector
    /** Byte references remain caller-owned at ingest. */
    const first = new Uint8Array([1, 2, 3, 4])
    /** Reusable view supplies captured content as the emitter would. */
    const view = collectorView()
    view.stage = RpcProbeStage.encoded
    view.content = first
    try {
      devtools.emit(view)
      expect(devtools.query().events[0]!.content).toBe(first)
      view.content = new Uint8Array(5)
      devtools.emit(view)
      expect(devtools.query().events[0]).not.toHaveProperty('content')
      expect(devtools.query().counters.contentDropped).toBe(1)
      view.content = first
      devtools.emit(view)
      expect(devtools.query().events[0]!.content).toBe(first)
      expect(devtools.query().counters.contentDropped).toBe(1)
    } finally {
      devtools.close()
    }
  })

  it('reports redact failure with the exact native cause and keeps emit outside the business failure path', () => {
    /** Redaction must preserve this exact failure instance and its original stack. */
    const original = new TypeError('redact fixture')
    /** Reports are the only output of the write-time failure. */
    const reports: unknown[] = []
    /** Captured content qualifies for redaction before retention. */
    const devtools = devtoolsPlugin({
      stages: ['encoded'],
      capture: ['encoded'],
      exposeContent: true,
      redact: () => {
        throw original
      },
      onError: (error) => reports.push(error)
    }).collector
    /** The payload must be discarded when the configured redactor fails. */
    const view = collectorView()
    view.stage = RpcProbeStage.encoded
    view.content = new Uint8Array([1])
    try {
      expect(() => devtools.emit(view)).not.toThrow()
      expect(reports).toHaveLength(1)
      expect(reports[0]).toBeInstanceOf(Error)
      expect(reports[0]).toMatchObject({
        source: RPC_DEVTOOLS_SOURCE,
        code: RpcDevtoolsErrorCode.redactFailed,
        cause: original
      })
      expect((reports[0] as Error).cause).toBe(original)
      expect(original.stack).toBeTruthy()
      expect(devtools.query().events[0]).not.toHaveProperty('content')
    } finally {
      devtools.close()
    }
  })

  it('rejects invalid capacity options as coded native TypeErrors', () => {
    for (const maxEvents of [0, -1, 1.5, Number.NaN]) {
      expect(() => devtoolsPlugin({ maxEvents }).collector).toThrowError(
        expect.objectContaining({
          source: RPC_DEVTOOLS_SOURCE,
          code: RpcDevtoolsErrorCode.invalidOption
        })
      )
      expect(() => devtoolsPlugin({ maxEvents }).collector).toThrowError(TypeError)
    }
  })
})

it('retains ordered forward hops by default and snapshots borrowed routes through query and record', () => {
  /** Default subscriptions include forwarding, while method selection remains exact. */
  const devtools = devtoolsPlugin({ methods: [CollectorFixture.method], maxEvents: 2 }).collector
  /** The independent recording must own its route snapshots after main-ring retirement. */
  const recording = devtools.record()
  /** One source route grows and is reused between synchronous observations. */
  const route = ['a'.repeat(32), 'b'.repeat(32)]
  /** Reusing one view must not rewrite either retained hop's scalar facts. */
  const view = collectorView()
  view.stage = RpcProbeStage.forward
  view.messageId = 'forward-message'
  view.outcome = RpcProbeOutcome.received
  view.hop = 1
  view.maxHops = 3
  view.route = route
  try {
    devtools.emit(view)
    route.push('c'.repeat(32))
    view.outcome = RpcProbeOutcome.sent
    view.hop = 2
    view.maxHops = 2
    devtools.emit(view)
    route[0] = 'd'.repeat(32)
    view.method = CollectorFixture.otherMethod
    view.hop = 9
    devtools.emit(view)
    /** The default query mask includes forward; rows preserve the same-message timeline. */
    const page = devtools.query()
    expect(page.events).toHaveLength(2)
    expect(page.events).toMatchObject([
      {
        stage: 'forward',
        messageId: 'forward-message',
        outcome: 'received',
        hop: 1,
        maxHops: 3,
        route: ['a'.repeat(32), 'b'.repeat(32)]
      },
      {
        stage: 'forward',
        messageId: 'forward-message',
        outcome: 'sent',
        hop: 2,
        maxHops: 2,
        route: ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)]
      }
    ])
    expect(page.events[0]!.route).not.toBe(route)
    expect(Object.isFrozen(page.events[0]!.route)).toBe(true)
    expect(
      devtools.query({ stages: ['forward'], methods: [CollectorFixture.method] }).events
    ).toEqual(page.events)
    /** NDJSON carries retained hop fields after the main ring releases its references. */
    const record = recording.stop()
    devtools.clear()
    expect(devtools.importRecord(devtools.exportRecord(record)).events).toEqual(page.events)
  } finally {
    devtools.close()
  }
})
