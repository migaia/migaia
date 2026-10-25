import { expect, it, vi } from 'vitest'
import {
  defineProbe,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeStage,
  rpcProbeSampleKey
} from '@migaia/rpc-host/plugins/probe'
import { createProbeEmitter } from '../../../dist/plugins/probe/emitter.js'
import type { IRpcProbeEventView } from '../../../dist/plugins/probe/types.js'

it('a paused zero mask does not sample, timestamp, redact or emit', () => {
  /** FNV's real multiply detects hashing without adding any production sampling seam. */
  const hashing = vi.spyOn(Math, 'imul')
  /** The original emitter clock must remain untouched for disabled observation. */
  const now = vi.fn(() => 0)
  /** Capture and sink callbacks are actual public probe options. */
  const redact = vi.fn((_stage, value) => value),
    emit = vi.fn()
  /** A real compiled handle changes only its original subscription mask. */
  const handle = defineProbe({ stages: ['frame'], capture: ['frame'], sample: 0.5, redact, emit })
  /** This exact emitter owns the original filter table and reusable view. */
  const emitter = createProbeEmitter([handle], now, 'paused')
  try {
    handle.setStages([])
    emitter.emit({
      stage: RpcProbeStage.frame,
      messageId: 'paused',
      senderId: 'sender',
      content: {}
    })
    expect(emitter.mask).toBe(0)
    expect(hashing).not.toHaveBeenCalled()
    expect(now).not.toHaveBeenCalled()
    expect(redact).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    handle.setStages(['frame'])
    emitter.emit({ stage: RpcProbeStage.frame, messageId: 'paused', senderId: 'sender' })
    expect(hashing).toHaveBeenCalled()
  } finally {
    emitter.dispose()
    hashing.mockRestore()
  }
})

it('isolates throwing subscribers, uses one view, updates stages and skips reentrant sequence', () => {
  /** Snapshots belong to this explicit copying test oracle. */
  const seen: Readonly<IRpcProbeEventView>[] = []
  /** View identities detect accidental per-event allocation. */
  const identities = new Set<IRpcProbeEventView>()
  /** Original failure identity must remain reachable on report cause. */
  const original = new Error('probe fixture')
  /** Runtime reporting never alters dispatch to the other subscriber. */
  const failures: unknown[] = []
  /** Descriptor invocation count proves cold activation isolation. */
  let described = 0
  /** The healthy probe observes every logical event, even beside the failing probe. */
  const first = defineProbe({
    stages: ['message'],
    describe: () => {
      described++
    },
    emit: (view) => {
      identities.add(view)
      seen.push(Object.freeze({ ...view }))
    }
  })
  /** The failing probe reports its original failure once per callback. */
  const failing = defineProbe({
    stages: ['message'],
    emit: () => {
      throw original
    },
    onError: (error) => {
      failures.push(error)
    }
  })
  /** Endpoint-local emitter reuses one observation view. */
  const emitter = createProbeEmitter([first, failing], () => 12, 'endpoint')
  emitter.describe({
    endpointId: 'endpoint',
    platform: 'memory',
    authentication: 'none',
    fastPath: false,
    carrier: 'unavailable',
    stageMask: 127
  })
  emitter.emit({
    stage: RpcProbeStage.message,
    direction: 0,
    kind: 0,
    outcome: 1,
    messageId: 'one',
    method: 'work',
    senderId: 'sender',
    targetId: 'target',
    trace: 'T1',
    durationMs: -1,
    rejection: undefined,
    error: undefined
  })
  emitter.emit({
    stage: RpcProbeStage.message,
    direction: 0,
    kind: 0,
    outcome: 2,
    messageId: 'one',
    method: 'work',
    senderId: 'sender',
    targetId: 'target',
    trace: 'T1',
    durationMs: -1,
    rejection: undefined,
    error: undefined
  })
  expect(described).toBe(1)
  expect(identities.size).toBe(1)
  expect(seen).toHaveLength(2)
  expect(failures).toHaveLength(2)
  expect(failures[0]).toMatchObject({ code: 'PROBE_FAILED', cause: original })
  first.setStages(['peer'])
  emitter.emit({
    stage: RpcProbeStage.message,
    direction: 0,
    kind: 0,
    outcome: 2,
    messageId: 'two',
    method: 'work',
    senderId: 'sender',
    targetId: 'target',
    trace: undefined,
    durationMs: -1,
    rejection: undefined,
    error: undefined
  })
  expect(seen).toHaveLength(2)
  emitter.dispose()
  expect(emitter.mask).toBe(0)
})

it('sample keys agree across stages; filtering happens before redaction', () => {
  /** Sampled frame identifiers must match the public deterministic predictor. */
  const ids: string[] = []
  /** Unmatched methods must never invoke content redaction. */
  let redactions = 0
  /** One probe selects half the message IDs on every side. */
  const probe = defineProbe({
    stages: ['envelope', 'frame'],
    capture: ['envelope'],
    methods: ['yes'],
    sample: 0.5,
    redact: (_stage, value) => {
      redactions++
      return value
    },
    emit: (view) => {
      ids.push(view.messageId!)
    }
  })
  /** Monotonic clock is deterministic for this source-filter oracle. */
  const emitter = createProbeEmitter([probe], () => 0, 'sample')
  emitter.emit({
    stage: RpcProbeStage.envelope,
    direction: 0,
    messageId: 'ignored',
    method: 'no',
    members: -1,
    content: {}
  })
  expect(redactions).toBe(0)
  for (let i = 0; i < 40; i++)
    emitter.emit({
      stage: RpcProbeStage.envelope,
      direction: 0,
      messageId: String(i),
      method: 'yes',
      members: -1,
      content: {}
    })
  expect(ids).toEqual(
    Array.from({ length: 40 }, (_value, i) => String(i)).filter(
      (id) => rpcProbeSampleKey('', id) < 0x80000000
    )
  )
  emitter.dispose()
})

it('reentrant calls are dropped, counted and leave a sequence gap', () => {
  /** Recorded sequence detects a nested observation rather than recursive sink entry. */
  const sequence: number[] = []
  /** Construction completes before this callback can reenter the same emitter. */
  let emitter!: ReturnType<typeof createProbeEmitter>
  /** A direct nested emit is the emitter boundary reached by reentrant Peer calls. */
  const probe = defineProbe({
    stages: ['message'],
    emit: (view) => {
      sequence.push(view.seq)
      emitter.emit({
        stage: RpcProbeStage.message,
        direction: RpcProbeDirection.outbound,
        kind: RpcProbeKind.request,
        outcome: RpcProbeOutcome.created,
        messageId: 'nested',
        method: undefined,
        senderId: undefined,
        targetId: undefined,
        trace: undefined,
        durationMs: -1,
        rejection: undefined,
        error: undefined
      })
    }
  })
  emitter = createProbeEmitter([probe], () => 0, 'nested')
  emitter.emit({
    stage: RpcProbeStage.message,
    direction: 0,
    kind: 0,
    outcome: 1,
    messageId: 'outer',
    method: undefined,
    senderId: undefined,
    targetId: undefined,
    trace: undefined,
    durationMs: -1,
    rejection: undefined,
    error: undefined
  })
  emitter.emit({
    stage: RpcProbeStage.message,
    direction: 0,
    kind: 0,
    outcome: 1,
    messageId: 'next',
    method: undefined,
    senderId: undefined,
    targetId: undefined,
    trace: undefined,
    durationMs: -1,
    rejection: undefined,
    error: undefined
  })
  expect(sequence).toEqual([1, 3])
  expect(emitter.droppedReentrant).toBe(2)
  expect(emitter.mask & (1 << RpcProbeStage.message)).not.toBe(0)
  emitter.dispose()
})

it('reports asynchronous describe, redact and emit failures without interrupting another probe', async () => {
  /** Original failures are retained separately so every report can prove exact cause identity. */
  const originals = [
    new Error('describe fixture'),
    new Error('redact fixture'),
    new Error('emit fixture')
  ]
  /** All reported failures remain in the observation plane. */
  const failures: unknown[] = []
  /** The adjacent subscriber must receive the same synchronous business observation. */
  let calls = 0
  /** Rejection observation uses the callback's actual returned Promise. */
  const failing = defineProbe({
    stages: ['envelope'],
    capture: ['envelope'],
    describe: async () => {
      throw originals[0]
    },
    redact: () => Promise.reject(originals[1]),
    emit: async () => {
      throw originals[2]
    },
    onError: (error) => {
      failures.push(error)
    }
  })
  /** Successful dispatch remains independent of the failing probe. */
  const healthy = defineProbe({
    stages: ['envelope'],
    emit: () => {
      calls++
    }
  })
  /** One existing emitter owns the reusable view for both synchronous subscribers. */
  const emitter = createProbeEmitter([failing, healthy], () => 0, 'rejections')
  emitter.describe({
    endpointId: 'rejections',
    platform: 'memory',
    authentication: 'none',
    fastPath: false,
    carrier: 'unavailable',
    stageMask: 127
  })
  emitter.emit({
    stage: RpcProbeStage.envelope,
    direction: 0,
    messageId: 'message',
    method: 'method',
    members: -1,
    content: {}
  })
  expect(calls).toBe(1)
  await Promise.resolve()
  expect(failures).toHaveLength(3)
  for (let i = 0; i < failures.length; i++) {
    expect(failures[i]).toMatchObject({ code: 'PROBE_FAILED' })
    expect((failures[i] as Error).cause).toBe(originals[i])
  }
  emitter.dispose()
})

it('method filtering applies only to logical and envelope stages from the frozen contract', () => {
  /** Only stages whose contract knows the method participate in method selection. */
  const seen: number[] = []
  /** Peer and frame observations remain available even when a logical method filter is configured. */
  const probe = defineProbe({
    stages: ['peer', 'message', 'envelope', 'frame'],
    methods: ['selected'],
    emit: (view) => {
      seen.push(view.stage)
    }
  })
  /** Source-side filtering follows contract, without inventing frame metadata. */
  const emitter = createProbeEmitter([probe], () => 0, 'methods')
  emitter.emit({
    stage: RpcProbeStage.message,
    direction: 0,
    kind: 0,
    outcome: 1,
    messageId: 'message',
    method: 'other',
    senderId: undefined,
    targetId: undefined,
    trace: undefined,
    durationMs: -1,
    rejection: undefined,
    error: undefined
  })
  emitter.emit({
    stage: RpcProbeStage.envelope,
    direction: 0,
    messageId: 'envelope',
    method: 'other',
    members: -1,
    content: undefined
  })
  emitter.emit({
    stage: RpcProbeStage.frame,
    direction: 0,
    messageId: 'frame',
    sizeBytes: -1,
    chunkIndex: -1,
    chunkCount: -1,
    content: undefined
  })
  emitter.emit({
    stage: RpcProbeStage.peer,
    kind: RpcProbeKind.lifecycle,
    lifecycle: 'ready',
    peerId: undefined,
    error: undefined
  })
  expect(seen).toEqual([RpcProbeStage.frame, RpcProbeStage.peer])
  emitter.dispose()
})

it('shares one preserved transfer backing across selected captures in callback order', () => {
  /** Prefix and suffix distinguish the original native backing from its captured view. */
  const backing = new ArrayBuffer(8)
  /** The exact physical view keeps its native offset and length through real detachment. */
  const bytes = new Uint8Array(backing, 2, 3)
  bytes.set([4, 5, 6])
  /** Subscriber retention borrows the captured content rather than copying it again. */
  const captured: Uint8Array[] = []
  /** The original shared capture lets an earlier redactor change later observer content. */
  const first = defineProbe({
    stages: ['carrier'],
    capture: ['carrier'],
    redact: (_stage, content) => {
      /** Mutation affects the preserved backing, never the actual bytes sent to the native port. */
      const view = content as Uint8Array
      view[0] = 99
      return view
    },
    emit: (view) => captured.push(view.content as Uint8Array)
  })
  /** A second selected subscriber must observe the same backing after the first callback. */
  const second = defineProbe({
    stages: ['carrier'],
    capture: ['carrier'],
    emit: (view) => captured.push(view.content as Uint8Array)
  })
  /** This public emitter receives the actual native transfer facts once for both subscriptions. */
  const emitter = createProbeEmitter([first, second], () => 0, 'shared-transfer')
  try {
    emitter.emit({ stage: RpcProbeStage.carrier, content: bytes, transfer: [backing] })
    expect(captured).toHaveLength(2)
    expect(captured[0]).toBe(captured[1])
    expect(captured[0]).not.toBe(bytes)
    expect(captured[0]!.byteOffset).toBe(2)
    expect(captured[0]!.buffer.byteLength).toBe(8)
    expect(Array.from(captured[1]!)).toEqual([99, 5, 6])
    expect(Array.from(bytes)).toEqual([4, 5, 6])
    /** Real native transfer must detach only the original physical backing. */
    const delivered = structuredClone(bytes, { transfer: [backing] })
    expect(backing.byteLength).toBe(0)
    expect(Array.from(delivered)).toEqual([4, 5, 6])
    expect(Array.from(captured[0]!)).toEqual([99, 5, 6])
  } finally {
    emitter.dispose()
  }
})
