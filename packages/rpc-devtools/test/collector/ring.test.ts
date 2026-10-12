import { describe, expect, it } from 'vitest'
import { RpcProbeStage } from '@migaia/rpc-core/probe'
import { createRpcDevtools, RpcDevtoolsErrorCode, RPC_DEVTOOLS_SOURCE } from '@migaia/rpc-devtools'
import { CollectorFixture, collectorView } from './fixture.js'

describe('collector A1 ingestion and ring', () => {
  it('retains the newest four of six views, converts every field and never retains the mutable view', () => {
    /** Four slots force two overwrites on the public ingestion path. */
    const devtools = createRpcDevtools({ maxEvents: 4 })
    /** One view is intentionally reused; primitive columns must keep each emission. */
    const view = collectorView()
    /** Detail is owned by the caller and retained by reference under SC9. */
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
    const devtools = createRpcDevtools({
      maxEvents: 1,
      maxContentBytes: 4,
      stages: ['encoded'],
      capture: ['encoded'],
      exposeContent: true
    })
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
    const devtools = createRpcDevtools({
      stages: ['encoded'],
      capture: ['encoded'],
      exposeContent: true,
      redact: () => {
        throw original
      },
      onError: (error) => reports.push(error)
    })
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
      expect(() => createRpcDevtools({ maxEvents })).toThrowError(
        expect.objectContaining({
          source: RPC_DEVTOOLS_SOURCE,
          code: RpcDevtoolsErrorCode.invalidOption
        })
      )
      expect(() => createRpcDevtools({ maxEvents })).toThrowError(TypeError)
    }
  })
})
