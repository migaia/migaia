import { expect, it } from 'vitest'
import {
  defineProbe,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeStage,
  rpcProbeSampleKey,
  snapshotProbeEvent
} from '../../dist/core/probe/index.js'
import {
  createProbeEmitter,
  bindInstalledProbe,
  readInstalledProbe
} from '../../dist/core/internal/probe-emitter.js'
import type { IRpcProbeEventView } from '../../dist/core/probe/types.js'

it('[A1] isolates throwing subscribers, uses one view, updates stages and skips reentrant sequence', () => {
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
  /** Genuine P1 observes every logical event, even beside failing P3. */
  const first = defineProbe({
    stages: ['message'],
    describe: () => {
      described++
    },
    emit: (view) => {
      identities.add(view)
      seen.push(snapshotProbeEvent(view))
    }
  })
  /** Genuine P3 reports its original failure once per callback. */
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
  emitter.message(0, 0, 1, 'one', 'work', 'sender', 'target', 'T1', -1, undefined, undefined)
  emitter.message(0, 0, 2, 'one', 'work', 'sender', 'target', 'T1', -1, undefined, undefined)
  expect(described).toBe(1)
  expect(identities.size).toBe(1)
  expect(seen).toHaveLength(2)
  expect(failures).toHaveLength(2)
  expect(failures[0]).toMatchObject({ code: 'PROBE_FAILED', cause: original })
  first.setStages(['peer'])
  emitter.message(0, 0, 2, 'two', 'work', 'sender', 'target', undefined, -1, undefined, undefined)
  expect(seen).toHaveLength(2)
  emitter.dispose()
  expect(emitter.mask).toBe(0)
})

it('[A1] sample keys agree across stages; filtering happens before redaction', () => {
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
  emitter.envelope(0, 'ignored', 'no', -1, {})
  expect(redactions).toBe(0)
  for (let i = 0; i < 40; i++) emitter.envelope(0, String(i), 'yes', -1, {})
  expect(ids).toEqual(
    Array.from({ length: 40 }, (_value, i) => String(i)).filter(
      (id) => rpcProbeSampleKey('', id) < 0x80000000
    )
  )
  emitter.dispose()
})

it('[A1] reentrant calls are dropped, counted and leave a sequence gap', () => {
  /** Recorded sequence detects a nested observation rather than recursive sink entry. */
  const sequence: number[] = []
  /** Construction completes before this callback can reenter the same emitter. */
  let emitter!: ReturnType<typeof createProbeEmitter>
  /** A direct nested emit is the emitter boundary reached by reentrant Peer calls. */
  const probe = defineProbe({
    stages: ['message'],
    emit: (view) => {
      sequence.push(view.seq)
      emitter.message(
        RpcProbeDirection.outbound,
        RpcProbeKind.request,
        RpcProbeOutcome.created,
        'nested',
        undefined,
        undefined,
        undefined,
        undefined,
        -1,
        undefined,
        undefined
      )
    }
  })
  emitter = createProbeEmitter([probe], () => 0, 'nested')
  emitter.message(
    0,
    0,
    1,
    'outer',
    undefined,
    undefined,
    undefined,
    undefined,
    -1,
    undefined,
    undefined
  )
  emitter.message(
    0,
    0,
    1,
    'next',
    undefined,
    undefined,
    undefined,
    undefined,
    -1,
    undefined,
    undefined
  )
  expect(sequence).toEqual([1, 3])
  expect(emitter.droppedReentrant).toBe(2)
  expect(emitter.mask & (1 << RpcProbeStage.message)).not.toBe(0)
  emitter.dispose()
})

it('[A1] reports asynchronous describe, redact and emit failures without interrupting another probe', async () => {
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
  emitter.envelope(0, 'message', 'method', -1, {})
  expect(calls).toBe(1)
  await Promise.resolve()
  expect(failures).toHaveLength(3)
  for (let i = 0; i < failures.length; i++) {
    expect(failures[i]).toMatchObject({ code: 'PROBE_FAILED' })
    expect((failures[i] as Error).cause).toBe(originals[i])
  }
  emitter.dispose()
})

it('[A1] one transport retains its canonical observer and rolls back a conflicting installation', () => {
  /** The actual transport identity is the construction binding key, independent of payload state. */
  const transport = {}
  /** First installation retains the one endpoint emitter. */
  const first = createProbeEmitter(
    [defineProbe({ stages: ['message'], emit: () => undefined })],
    () => 0,
    'first'
  )
  /** The second cold observer must release its subscriptions when ownership conflicts. */
  const second = createProbeEmitter(
    [defineProbe({ stages: ['message'], emit: () => undefined })],
    () => 0,
    'second'
  )
  /** This receipt revokes only its exact current owner. */
  const release = bindInstalledProbe(transport, first)
  expect(() => bindInstalledProbe(transport, second)).toThrow(
    expect.objectContaining({ code: 'CAPABILITY_CONFLICT' })
  )
  expect(readInstalledProbe(transport)).toBe(first)
  expect(second.mask).toBe(0)
  release()
  expect(readInstalledProbe(transport)).toBeUndefined()
})

it('[A1] method filtering applies only to logical and envelope stages from the frozen contract', () => {
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
  /** Source-side filtering follows contract §4, without inventing frame metadata. */
  const emitter = createProbeEmitter([probe], () => 0, 'methods')
  emitter.message(
    0,
    0,
    1,
    'message',
    'other',
    undefined,
    undefined,
    undefined,
    -1,
    undefined,
    undefined
  )
  emitter.envelope(0, 'envelope', 'other', -1, undefined)
  emitter.frame(0, 'frame', -1, -1, -1, undefined)
  emitter.peer('ready', undefined, undefined)
  expect(seen).toEqual([RpcProbeStage.frame, RpcProbeStage.peer])
  emitter.dispose()
})
