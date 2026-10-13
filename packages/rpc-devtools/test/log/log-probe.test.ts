import { describe, expect, it } from 'vitest'
import { createEndpoint, connect, RpcCoreErrorCode, RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import {
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeStage,
  probePlugin,
  type IRpcProbe,
  type IRpcProbeEventView
} from '@migaia/rpc-core/probe'
import { createRpcLogProbe, type IRpcLogSink } from '../../src/log/index.js'
import { RpcDevtoolsErrorCode, ERROR_SOURCE } from '../../src/error-code.js'

/** Records the logger boundary without keeping the reusable emitter view. */
type ILogRecord = { level: string; message: string; fields: Record<string, unknown> }

/** The frozen runtime handle carries emit; the layer-1 public type omits that direct-test seam. */
type IEmittingProbe = IRpcProbe & { emit(view: IRpcProbeEventView): void }

/** Builds one hand-filled fixed-shape event, independent of probe-core observation points. */
function event(): IRpcProbeEventView {
  return {
    seq: 1,
    carrierSeq: -1,
    variation: undefined,
    at: 100,
    endpointId: 'endpoint',
    stage: RpcProbeStage.message,
    direction: RpcProbeDirection.outbound,
    kind: RpcProbeKind.request,
    outcome: RpcProbeOutcome.settled,
    messageId: 'message',
    method: 'sum',
    senderId: 'sender',
    targetId: 'target',
    receiverId: undefined,
    peerId: 'peer',
    trace: 'trace',
    sizeBytes: -1,
    chunkIndex: -1,
    chunkCount: -1,
    members: -1,
    durationMs: 10,
    rejection: undefined,
    lifecycle: undefined,
    error: undefined,
    carrier: undefined,
    detail: undefined,
    content: undefined
  }
}

/** Creates structural methods whose only work is recording the already extracted fields. */
function logger(records: ILogRecord[]): IRpcLogSink {
  return {
    debug: (message, fields) =>
      records.push({ level: 'debug', message, fields: fields as Record<string, unknown> }),
    info: (message, fields) =>
      records.push({ level: 'info', message, fields: fields as Record<string, unknown> }),
    warn: (message, fields) =>
      records.push({ level: 'warn', message, fields: fields as Record<string, unknown> }),
    error: (message, fields) =>
      records.push({ level: 'error', message, fields: fields as Record<string, unknown> })
  }
}

describe('A7 log probe', () => {
  it('[closure A1] forwards stage capture and redaction through the real Core emitter', async () => {
    /** Logger-visible fields are captured only after Core's synchronous redaction callback. */
    const records: ILogRecord[] = []
    /** The caller's redactor owns this replacement rather than changing business data. */
    const masked = { masked: true }
    /** Real progress events prove the capture/redact options reached defineProbe and its emitter. */
    const probe = createRpcLogProbe(logger(records), {
      stages: ['message'],
      capture: ['message'],
      slowMs: 0,
      redact: () => masked
    })
    /** The same public carrier remains responsible for the original business result. */
    const [left, right] = createMemoryTransportPair()
    /** Provider behavior is independent of logger content conversion. */
    const server = await createEndpoint({
      id: 'log-redact-server',
      transport: right,
      middlewares: [connect()],
      provider: { echo: (context) => context.success(context.data) }
    })
    /** The public plugin is the supported endpoint observation boundary. */
    const client = await createEndpoint({
      id: 'log-redact-client',
      transport: left,
      middlewares: [connect(), probePlugin(probe)]
    })
    try {
      expect(await client.send('log-redact-server', 'echo', 42)).toBe(42)
      expect(records.length).toBeGreaterThan(0)
      for (const record of records) expect(record.fields.content).toBe(masked)
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
    }
  })
  it('compiles message and peer defaults and skips one million successful events before field construction', () => {
    /** Every possible fields/message boundary is counted before the hot loop starts. */
    const counters = { fieldReads: 0, messages: 0, calls: 0 }
    /** A sink call proves a fields object reached the external logging boundary. */
    const sink: IRpcLogSink = {
      debug: () => counters.calls++,
      info: () => counters.calls++,
      warn: () => counters.calls++,
      error: () => counters.calls++
    }
    /** A custom message must also stay unevaluated for ignored events. */
    const probe = createRpcLogProbe(sink, {
      slowMs: 20,
      message: () => {
        counters.messages++
        return 'custom'
      }
    }) as IEmittingProbe
    /** Getter counters detect reading values used by the one qualifying-event object literal. */
    const view = event()
    Object.defineProperty(view, 'method', {
      get: () => {
        counters.fieldReads++
        return 'sum'
      }
    })
    expect(probe.stageMask).toBe((1 << RpcProbeStage.message) | (1 << RpcProbeStage.peer))
    expect(probe.captureMask).toBe(0)
    for (let i = 0; i < 1_000_000; i++) probe.emit(view)
    expect(counters).toEqual({ fieldReads: 0, messages: 0, calls: 0 })
  })

  it('logs failed/error, rejected/warn, slow/warn and peer lifecycle/info', () => {
    /** Logger records reflect exactly one synchronous call per qualifying event. */
    const records: ILogRecord[] = []
    /** Threshold comparisons use settlement duration only. */
    const probe = createRpcLogProbe(logger(records), { slowMs: 20 }) as IEmittingProbe
    /** Reuse one view across all decision branches, as a real emitter does. */
    const view = event()
    view.outcome = RpcProbeOutcome.failed
    probe.emit(view)
    view.outcome = RpcProbeOutcome.rejected
    probe.emit(view)
    view.outcome = RpcProbeOutcome.settled
    view.durationMs = 20
    probe.emit(view)
    view.stage = RpcProbeStage.peer
    view.kind = RpcProbeKind.lifecycle
    view.outcome = RpcProbeOutcome.none
    view.lifecycle = 'ready'
    probe.emit(view)
    expect(records.map((record) => record.level)).toEqual(['error', 'warn', 'warn', 'info'])
    expect(records.every((record) => typeof record.message === 'string')).toBe(true)
  })

  it('defaults to ignoring settled calls at every duration and respects the stage mask before fields', () => {
    /** Default logging has no slow threshold. */
    const records: ILogRecord[] = []
    /** An omitted threshold never implicitly logs successful calls. */
    const probe = createRpcLogProbe(logger(records)) as IEmittingProbe
    /** A captured but unsubscribed event must remain unobserved on direct emit. */
    const view = event()
    view.durationMs = 1_000_000
    probe.emit(view)
    view.stage = RpcProbeStage.frame
    view.outcome = RpcProbeOutcome.failed
    probe.emit(view)
    probe.setStages([])
    view.stage = RpcProbeStage.message
    probe.emit(view)
    expect(records).toEqual([])
  })

  it('extracts documented fields synchronously and preserves the original error reference after view reuse', () => {
    /** Records stay stable after later events overwrite the same emitter view. */
    const records: ILogRecord[] = []
    /** Log defaults preserve native failure identity. */
    const probe = createRpcLogProbe(logger(records)) as IEmittingProbe
    /** The error is caller-owned and never copied or serialized here. */
    const failure = new Error('fixture failure')
    /** One qualified failed event includes every documented scalar/reference field. */
    const view = event()
    view.outcome = RpcProbeOutcome.failed
    view.error = failure
    view.rejection = 'fixture rejection'
    view.lifecycle = 'fixture lifecycle'
    probe.emit(view)
    view.method = 'other'
    view.messageId = 'other-message'
    view.error = undefined
    expect(records[0]!.fields).toEqual({
      method: 'sum',
      messageId: 'message',
      senderId: 'sender',
      targetId: 'target',
      trace: 'trace',
      durationMs: 10,
      outcome: 'failed',
      kind: 'request',
      rejection: 'fixture rejection',
      lifecycle: 'fixture lifecycle',
      peerId: 'peer',
      error: failure
    })
    expect(records[0]!.fields.error).toBe(failure)
    expect(records[0]!.fields).not.toBe(view)
  })

  it('uses canonical Core source/code to classify timeout and abort without inventing outcome ordinals', () => {
    /** Frozen outcome ordinals retain failed while logging chooses the warning policy. */
    const records: ILogRecord[] = []
    /** Default timeout and cancellation warnings are distinct from ordinary failures. */
    const probe = createRpcLogProbe(logger(records)) as IEmittingProbe
    /** A real Core-classified error follows the same boundary contract as constructed Core errors. */
    const view = event()
    view.outcome = RpcProbeOutcome.failed
    view.error = Object.assign(new Error('fixture timeout'), {
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.deadlineExceeded
    })
    probe.emit(view)
    view.error = Object.assign(new Error('fixture abort'), {
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.cancelled
    })
    probe.emit(view)
    view.error = Object.assign(new Error('foreign code'), {
      source: 'foreign',
      code: RpcCoreErrorCode.cancelled
    })
    probe.emit(view)
    expect(records.map((record) => record.level)).toEqual(['warn', 'warn', 'error'])
  })

  it('compiles off/custom levels and forwards source filters and sampling', () => {
    /** Off levels short-circuit before constructing any logger fields. */
    const records: ILogRecord[] = []
    /** Source filters are consumed by the owning emitter through defineProbe compiled fields. */
    const probe = createRpcLogProbe(logger(records), {
      levels: { rejected: 'off', failed: 'debug' },
      stages: ['message'],
      methods: ['sum'],
      sample: 0.5,
      message: (view) => `failure ${view.method}`
    }) as IEmittingProbe
    /** Only failed creates a custom message or fields object. */
    const view = event()
    view.outcome = RpcProbeOutcome.rejected
    probe.emit(view)
    view.outcome = RpcProbeOutcome.failed
    probe.emit(view)
    expect(records).toHaveLength(1)
    expect(records[0]!.level).toBe('debug')
    expect(records[0]!.message).toBe('failure sum')
    expect(probe.methods).toEqual(new Set(['sum']))
    expect(probe.sampleThreshold).toBe(0x80000000)
  })

  it('omits content by default and requests captured content only for explicit content:true', () => {
    /** Capture data remains referenced at the logger boundary. */
    const content = { safe: true }
    /** Separate record arrays prove metadata defaults do not leak captured input. */
    const metadata: ILogRecord[] = []
    /** The enabled log helper opts into capture on its subscribed stages. */
    const captured: ILogRecord[] = []
    /** A hand-filled captured event follows the already-redacted view contract. */
    const view = event()
    view.outcome = RpcProbeOutcome.failed
    view.content = content
    const metadataProbe = createRpcLogProbe(logger(metadata)) as IEmittingProbe
    const capturedProbe = createRpcLogProbe(logger(captured), {
      content: true,
      stages: ['message']
    }) as IEmittingProbe
    metadataProbe.emit(view)
    capturedProbe.emit(view)
    expect(metadata[0]!.fields).not.toHaveProperty('content')
    expect(captured[0]!.fields.content).toBe(content)
    expect(capturedProbe.captureMask).toBe(1 << RpcProbeStage.message)
  })

  it('reports synchronous logger failure by identity and never throws from emit', () => {
    /** The original sink failure must reach the supplied reporter unchanged. */
    const failure = new Error('fixture logger failure')
    /** Every sink method exists even though warn fails on this fixture. */
    const sink = logger([])
    /** Reported failures belong to diagnostics, never to the business caller. */
    const reported: unknown[] = []
    const probe = createRpcLogProbe(
      {
        ...sink,
        warn: () => {
          throw failure
        }
      },
      { onError: (error) => reported.push(error) }
    ) as IEmittingProbe
    /** Rejection selects warn without altering event error identity. */
    const view = event()
    view.outcome = RpcProbeOutcome.rejected
    expect(() => probe.emit(view)).not.toThrow()
    expect(reported).toEqual([failure])
  })

  it('reports rejected logger Promise without awaiting or throwing from emit', async () => {
    /** Native Promise rejection is asynchronous sink failure, independent of the business result. */
    const failure = new Error('fixture async logger failure')
    /** The sink fixture returns the Promise it owns. */
    const sink = logger([])
    /** Report completion is observed after the logger Promise settlement. */
    const reported: unknown[] = []
    const probe = createRpcLogProbe(
      { ...sink, warn: () => Promise.reject(failure) },
      { onError: (error) => reported.push(error) }
    ) as IEmittingProbe
    /** Warn selects the asynchronous fixture sink. */
    const view = event()
    view.outcome = RpcProbeOutcome.rejected
    expect(() => probe.emit(view)).not.toThrow()
    await Promise.resolve()
    expect(reported).toEqual([failure])
  })

  it('reports throwing message callbacks and throwing thenable accessors', () => {
    /** Callback and then-property reads share the logger failure boundary. */
    const failure = new Error('fixture callback failure')
    /** Reports preserve callback identity rather than creating diagnostics wrappers. */
    const reported: unknown[] = []
    /** Rejected events qualify for both fixtures. */
    const view = event()
    view.outcome = RpcProbeOutcome.rejected
    const messageProbe = createRpcLogProbe(logger([]), {
      message: () => {
        throw failure
      },
      onError: (error) => reported.push(error)
    }) as IEmittingProbe
    const thenableProbe = createRpcLogProbe(
      {
        ...logger([]),
        warn: () => ({
          // oxlint-disable-next-line unicorn/no-thenable -- R6 accepts logger thenables and preserves getter failures.
          get then() {
            throw failure
          }
        })
      },
      { onError: (error) => reported.push(error) }
    ) as IEmittingProbe
    expect(() => messageProbe.emit(view)).not.toThrow()
    expect(() => thenableProbe.emit(view)).not.toThrow()
    expect(reported).toEqual([failure, failure])
  })

  it('rejects missing logger methods, invalid slow thresholds and unknown level entries with INVALID_OPTION', () => {
    /** Invalid inputs must retain native TypeError plus the registered devtools identity. */
    const identity = { source: ERROR_SOURCE, code: RpcDevtoolsErrorCode.invalidOption }
    expect(() =>
      createRpcLogProbe({ debug() {}, info() {}, warn() {} } as unknown as IRpcLogSink)
    ).toThrowError(expect.objectContaining(identity))
    expect(() => createRpcLogProbe(logger([]), { slowMs: -1 })).toThrowError(
      expect.objectContaining(identity)
    )
    expect(() => createRpcLogProbe(logger([]), { slowMs: Infinity })).toThrowError(
      expect.objectContaining(identity)
    )
    expect(() =>
      createRpcLogProbe(logger([]), { levels: { failed: 'unknown' as 'error' } })
    ).toThrowError(expect.objectContaining(identity))
    expect(() =>
      createRpcLogProbe(logger([]), {
        levels: { unknown: 'error' } as unknown as { failed: 'error' }
      })
    ).toThrowError(expect.objectContaining(identity))
    expect(() => createRpcLogProbe(logger([]), { sample: 0 })).toThrowError(
      expect.objectContaining(identity)
    )
    try {
      createRpcLogProbe(logger([]), { slowMs: NaN })
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError)
    }
  })
})
