/** Public single-profile grammar cases for core R6, R8, R15 and BC2/BC6. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  RpcProbeStage,
  RpcProbeStageName,
  RpcProbeForwardRejection,
  rpcProbeEnvelopeFacts
} from '@migaia/rpc-contract/interfaces'
import { header, hello } from './fixtures/core-profile.js'
import {
  RpcWireProfile,
  RpcWireBinaryProfile,
  RpcWireLimit,
  RpcWireKind,
  normalizeRpcFrame,
  normalizeRpcHandshake,
  acceptRpcHandshake,
  completeRpcHandshake,
  normalizeRpcWireError,
  serializeRpcWireError,
  deserializeRpcWireError,
  normalizeRpcCarrierFrame,
  normalizeRpcRoute,
  normalizeRpcTask,
  normalizeRpcGeneration,
  normalizeRpcSteps,
  normalizeRpcCallOptions,
  normalizeRpcStream,
  normalizeRpcGroupResult,
  normalizeRpcOutcomeStore,
  normalizeRpcOutcome,
  normalizeRpcCompletion,
  normalizeRpcDirectory,
  normalizeRpcBinaryManifest
} from '@migaia/rpc-contract/protocol'

/** Shared foreign fixtures use the same semantic frame admission as the TypeScript endpoint. */
type ICoreProfileVectors = {
  /** The fixture declares exactly the new sole-profile spelling. */
  readonly profile: string
  /** Every valid frame is exercised individually so its stable case id appears in receipts. */
  readonly valid: readonly { readonly id: string; readonly frame: unknown }[]
  /** Invalid frames remain data; no fixture-specific rejection logic enters the validator. */
  readonly invalid: readonly {
    readonly id: string
    readonly frame: unknown
    readonly reason: string
  }[]
}

/** Flat shared/cyclic topology uses references rather than recursively nesting source objects. */
function graph() {
  return {
    root: 0,
    nodes: [
      {
        source: 'rpc.endpoint',
        code: 'INTERNAL',
        name: 'AggregateError',
        message: 'outer',
        stack: 'remote outer stack',
        cause: 1,
        errors: [1, 1]
      },
      {
        source: 'business',
        code: 'FAILED',
        name: 'TypeError',
        message: 'inner',
        stack: 'remote inner stack',
        cause: 0
      }
    ]
  }
}

describe('single RPC wire profile', () => {
  it('[CORE-R6-01] rejects legacy profiles and keeps notify ids mandatory', () => {
    expect(() => normalizeRpcFrame({ kind: 'request', id: 'old' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENVELOPE' })
    )
    expect(() => normalizeRpcFrame({ jsonrpc: '2.0', method: 'echo', id: 1 })).toThrow()
    expect(() =>
      normalizeRpcFrame({ ...header(), profile: 'migaia.rpc.runtime-api/1', options: {} })
    ).toThrow()
    /** Single-way frames now correlate cancellation using their own required id. */
    const notify = { ...header('notify'), options: {} }
    expect(normalizeRpcFrame(notify)).toMatchObject({
      kind: 'call',
      id: 'call-1',
      task: { mode: 'notify' }
    })
    expect(() => normalizeRpcFrame({ ...notify, id: undefined })).toThrow()
  })

  it('[CORE-R6-02] validates original metadata and retains business key order and binary identity', () => {
    /** Native binary is admitted by existing portable rules without copying its backing. */
    const bytes = new Uint8Array([1, 2])
    /** Key insertion order is intentional, including the integer-key order mandated by JS. */
    const input = { z: 1, a: { y: 2, x: 3 }, bytes }
    /** BC9 reads known fields directly; the portable payload still uses its canonical validator. */
    let reads = 0
    const hostile = {
      ...header(),
      options: {},
      get payload() {
        reads++
        return input
      }
    }
    expect(normalizeRpcFrame(hostile)).toBe(hostile)
    expect(reads).toBe(1)
    const frame = normalizeRpcFrame({ ...header(), options: {}, payload: input })
    expect(frame.kind).toBe('call')
    if (frame.kind !== 'call') throw new Error('unexpected fixture variant')
    expect(Object.keys(frame.payload as object)).toEqual(['z', 'a', 'bytes'])
    expect((frame.payload as { bytes: Uint8Array }).bytes).toBe(bytes)
    expect(Object.isFrozen(frame)).toBe(false)
  })

  it('[CORE-R8-01] carries a bounded remaining deadline and ignores non-wire option fields', () => {
    /** Relative zero is valid and makes the receiving owner expire before execution. */
    const frame = { ...header(), route: { ...header().route, remainingMs: 0 }, options: {} }
    expect(normalizeRpcFrame(frame)).toMatchObject({ route: { remainingMs: 0 } })
    expect(() =>
      normalizeRpcFrame({ ...frame, route: { ...frame.route, remainingMs: -1 } })
    ).toThrow()
    /** Unknown option fields have no wire effect and are not inspected as feature instances. */
    const withLocalField = { ...frame, options: { timeout: { kind: 'timeout' } } }
    expect(normalizeRpcFrame(withLocalField)).toBe(withLocalField)
  })

  it('[CORE-R6-03] negotiates only actual optional/required extensions and checks selected subsets', () => {
    const local = normalizeRpcHandshake(hello('provider', ['batch@1']))
    const remote = normalizeRpcHandshake(hello('caller', ['chunk@1']))
    if (local.step !== 'hello' || remote.step !== 'hello')
      throw new Error('unexpected fixture variant')
    const accepted = acceptRpcHandshake(remote, local)
    expect(accepted.extensions).toEqual([])
    expect(completeRpcHandshake(remote, accepted)).toMatchObject({ codec: 'json', extensions: [] })
    const required = normalizeRpcHandshake(hello('caller', ['chunk@1'], ['chunk@1']))
    if (required.step !== 'hello') throw new Error('unexpected fixture variant')
    expect(() => acceptRpcHandshake(required, local)).toThrowError(
      expect.objectContaining({ code: 'EXTENSION_NEGOTIATION_FAILED' })
    )
    expect(() => completeRpcHandshake(remote, { ...accepted, extensions: ['batch@1'] })).toThrow()
    expect(() => normalizeRpcHandshake({ ...hello('caller'), profile: 'migaia.rpc' })).toThrow()
  })

  it('[CORE-R6-04] preserves flat error shared/cyclic topology, native types and remote stacks', () => {
    const normalized = normalizeRpcWireError(graph())
    const restored = deserializeRpcWireError(normalized) as AggregateError
    expect(restored).toBeInstanceOf(AggregateError)
    expect(restored.cause).toBeInstanceOf(TypeError)
    expect(restored.errors[0]).toBe(restored.errors[1])
    expect(restored.errors[0]).toBe(restored.cause)
    expect((restored.cause as Error).cause).toBe(restored)
    expect(restored.stack).toBe('remote outer stack')
    expect((restored.cause as Error).stack).toBe('remote inner stack')
    expect(() =>
      normalizeRpcWireError({ root: 0, nodes: [{ ...graph().nodes[0], cause: 2 }] })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_WIRE_ERROR' }))
  })

  it('[CORE-R6-05] reuses bounded source-error projection for cycles without recursion failure', () => {
    const source = new TypeError('business failure')
    Object.defineProperty(source, 'cause', { value: source })
    const flat = serializeRpcWireError(source, { report: () => undefined })
    expect(flat.nodes[flat.root]).toMatchObject({ name: 'TypeError', message: 'business failure' })
    expect(flat.nodes.some((node) => node.truncated)).toBe(true)
    expect(deserializeRpcWireError(flat)).toBeInstanceOf(TypeError)
  })

  it('[CORE-R6-07] classifies malformed flat node and aggregate arrays as INVALID_WIRE_ERROR', () => {
    /** Graph and aggregate container failures use the wire-error domain rather than envelopes. */
    const malformed = [
      { root: 0, nodes: {} },
      { ...graph(), nodes: [{ ...graph().nodes[0], errors: {} }, graph().nodes[1]] }
    ]
    for (const value of malformed)
      expect(() => normalizeRpcWireError(value)).toThrowError(
        expect.objectContaining({ source: 'rpc.contract', code: 'INVALID_WIRE_ERROR' })
      )
    /** Decoded index values are read directly, without descriptor-specific array restrictions. */
    let reads = 0
    /** A scalar cannot be a node record; the same zero is a valid aggregate edge index. */
    const accessor = Object.defineProperty([], '0', {
      enumerable: true,
      get() {
        reads++
        return 0
      }
    })
    expect(() => normalizeRpcWireError({ root: 0, nodes: accessor })).toThrowError(
      expect.objectContaining({ code: 'INVALID_WIRE_ERROR' })
    )
    expect(() =>
      normalizeRpcWireError({
        ...graph(),
        nodes: [{ ...graph().nodes[0], errors: accessor }, graph().nodes[1]]
      })
    ).not.toThrow()
    expect(reads).toBe(2)
  })

  it('[CORE-R6-08] keeps a rejected handshake remote error topology reachable through cause', () => {
    /** The initiating offer is real admitted input, not a fabricated accepted-session capability. */
    const offer = normalizeRpcHandshake(hello('caller'))
    if (offer.step !== 'hello') throw new Error('unexpected fixture variant')
    /** The outer local rejection preserves the remote native aggregate and its exact shared edges. */
    let failure: Error | undefined
    try {
      completeRpcHandshake(offer, {
        profile: RpcWireProfile,
        kind: RpcWireKind.handshake,
        step: 'reject',
        error: graph()
      })
    } catch (error) {
      failure = error as Error
    }
    expect(failure).toMatchObject({ source: 'rpc.contract', code: 'HANDSHAKE_REJECTED' })
    /** Restoration uses the already admitted graph without another hostile shape traversal. */
    const remote = failure?.cause as AggregateError
    expect(remote).toBeInstanceOf(AggregateError)
    expect(remote.stack).toBe('remote outer stack')
    expect(remote.cause).toBeInstanceOf(TypeError)
    expect(remote.errors[0]).toBe(remote.cause)
    expect(remote.errors[0]).toBe(remote.errors[1])
    expect((remote.cause as Error).cause).toBe(remote)
    expect((remote.cause as Error).stack).toBe('remote inner stack')
  })

  it('[CORE-R15-01] admits cancel/error/stream frames with the original correlated task', () => {
    expect(
      normalizeRpcFrame({ ...header('notify'), kind: 'cancel', reason: graph() })
    ).toMatchObject({ kind: 'cancel', task: { mode: 'notify' } })
    expect(normalizeRpcFrame({ ...header(), kind: 'error', error: graph() })).toMatchObject({
      kind: 'error'
    })
    expect(
      normalizeRpcFrame({ ...header('stream'), kind: 'stream', stream: { event: 'open', seq: 0 } })
    ).toMatchObject({ kind: 'stream' })
    expect(() =>
      normalizeRpcFrame({ ...header('stream'), kind: 'stream', stream: { event: 'open', seq: 1 } })
    ).toThrow()
    expect(() =>
      normalizeRpcFrame({ ...header(), kind: 'stream', stream: { event: 'open', seq: 0 } })
    ).toThrow()
  })

  it('[CORE-R6-06] rejects unnegotiated extension frames and keeps sidecars exact', () => {
    const backing = new ArrayBuffer(8)
    const extension = {
      kind: 'extension',
      extension: 'chunk@1',
      data: { index: 0 },
      sidecars: [backing]
    }
    expect(() => normalizeRpcCarrierFrame(extension, new Set())).toThrow()
    const frame = normalizeRpcCarrierFrame(extension, new Set(['chunk@1']))
    expect(frame.sidecars?.[0]).toBe(backing)
    expect(frame.data).toBe(extension.data)
    expect(() =>
      normalizeRpcCarrierFrame(
        { ...extension, sidecars: [new Uint8Array(1)] },
        new Set(['chunk@1'])
      )
    ).toThrow()
  })
})

/** One shared checked-in fixture supplies both this package and foreign conformance migration. */
const vectors = JSON.parse(
  readFileSync(
    new URL('../../rpc-integration/schema/vectors/core-profile.json', import.meta.url),
    'utf8'
  )
) as ICoreProfileVectors

describe('shared core profile foreign vectors', () => {
  it('[CORE-R6-VECTOR-PROFILE] declares only the sole profile', () => {
    expect(vectors.profile).toBe(RpcWireProfile)
  })

  it.each(vectors.valid)('[CORE-R6-VECTOR-VALID] $id', ({ frame }) => {
    expect(() => normalizeRpcFrame(frame)).not.toThrow()
  })

  it.each(vectors.invalid)('[CORE-R6-VECTOR-INVALID] $id', ({ frame }) => {
    expect(() => normalizeRpcFrame(frame)).toThrow()
  })
})

/** R17 uses each original public validator, with only the chosen known field made invalid. */
type IRecordCase = {
  name: string
  value: Record<string, unknown>
  field: string
  wrong: unknown
  validate(value: Record<string, unknown>): unknown
  pointer: string
  code?: string
  missingCode?: string
  wrongPointer?: string
}

/** Direct family evidence preserves native code and the first actual bad-field pointer. */
const records: IRecordCase[] = [
  {
    name: 'frame',
    value: { ...header(), options: {} },
    field: 'id',
    wrong: 1,
    validate: normalizeRpcFrame,
    pointer: '/id'
  },
  {
    name: 'route',
    value: header().route,
    field: 'senderId',
    wrong: 1,
    validate: normalizeRpcRoute,
    pointer: '/route/senderId'
  },
  {
    name: 'task',
    value: header().task,
    field: 'mode',
    wrong: 1,
    validate: normalizeRpcTask,
    pointer: '/task/mode'
  },
  {
    name: 'generation',
    value: header().task.callerGeneration,
    field: 'kind',
    wrong: 1,
    validate: normalizeRpcGeneration,
    pointer: '/generation/kind'
  },
  {
    name: 'step',
    value: { method: 'echo' },
    field: 'method',
    wrong: 1,
    validate: (value) => normalizeRpcSteps([value]),
    pointer: '/steps/0/method'
  },
  {
    name: 'stream',
    value: { event: 'open', seq: 0 },
    field: 'seq',
    wrong: -1,
    validate: normalizeRpcStream,
    pointer: '/stream/seq'
  },
  {
    name: 'hello',
    value: hello('caller'),
    field: 'peer',
    wrong: 1,
    validate: normalizeRpcHandshake,
    pointer: '/handshake/peer',
    missingCode: 'INVALID_ENVELOPE',
    wrongPointer: '/handshake'
  },
  {
    name: 'pending peer',
    value: {
      profile: RpcWireProfile,
      kind: RpcWireKind.handshake,
      step: 'pending',
      peer: { id: 'caller', runtime: 'node' },
      remainingMs: 10000
    },
    field: 'peer',
    wrong: 1,
    validate: normalizeRpcHandshake,
    pointer: '/handshake/peer',
    code: 'INVALID_ENVELOPE',
    missingCode: 'INVALID_ENVELOPE',
    wrongPointer: '/handshake'
  },
  {
    name: 'pending deadline',
    value: {
      profile: RpcWireProfile,
      kind: RpcWireKind.handshake,
      step: 'pending',
      peer: { id: 'caller', runtime: 'node' },
      remainingMs: 10000
    },
    field: 'remainingMs',
    wrong: -1,
    validate: normalizeRpcHandshake,
    pointer: '/handshake/remainingMs',
    code: 'HANDSHAKE_INVALID',
    missingCode: 'INVALID_ENVELOPE',
    wrongPointer: '/remainingMs'
  },
  {
    name: 'peer',
    value: { id: 'caller', runtime: 'node' },
    field: 'id',
    wrong: 1,
    validate: (value) => normalizeRpcHandshake({ ...hello('caller'), peer: value }),
    pointer: '/peer/id',
    code: 'HANDSHAKE_INVALID'
  },
  {
    name: 'implementation',
    value: { name: 'fixture', version: '1' },
    field: 'name',
    wrong: 1,
    validate: (value) =>
      normalizeRpcHandshake({
        ...hello('caller'),
        peer: { id: 'caller', runtime: 'node', implementation: value }
      }),
    pointer: '/peer/implementation/name',
    code: 'HANDSHAKE_INVALID'
  },
  {
    name: 'version',
    value: { major: 2, minor: 0 },
    field: 'major',
    wrong: -1,
    validate: (value) => normalizeRpcHandshake({ ...hello('caller'), versions: [value] }),
    pointer: '/versions/0/major',
    code: 'HANDSHAKE_INVALID',
    missingCode: 'INVALID_ENVELOPE'
  },
  {
    name: 'directory',
    value: hello('caller').directory,
    field: 'schemaVersion',
    wrong: 0,
    validate: normalizeRpcDirectory,
    pointer: '/directory/schemaVersion'
  },
  {
    name: 'self',
    value: hello('caller').directory.self,
    field: 'name',
    wrong: 1,
    validate: (value) => normalizeRpcDirectory({ ...hello('caller').directory, self: value }),
    pointer: '/directory/self/name'
  },
  {
    name: 'method',
    value: { name: 'echo', supportedModes: ['request'], modeSource: 'declared' },
    field: 'name',
    wrong: 1,
    validate: (value) => normalizeRpcDirectory({ ...hello('caller').directory, methods: [value] }),
    pointer: '/directory/methods/0/name'
  },
  {
    name: 'error graph',
    value: graph(),
    field: 'root',
    wrong: -1,
    validate: normalizeRpcWireError,
    pointer: '/error/root',
    code: 'INVALID_WIRE_ERROR'
  },
  {
    name: 'error node',
    value: graph().nodes[1]!,
    field: 'source',
    wrong: 1,
    validate: (value) => normalizeRpcWireError({ root: 0, nodes: [{ ...value, cause: 0 }] }),
    pointer: '/nodes/0/source',
    code: 'INVALID_WIRE_ERROR'
  },
  {
    name: 'group outcome',
    value: { state: 'success' },
    field: 'state',
    wrong: 'other',
    validate: (value) => normalizeRpcGroupResult([value]),
    pointer: '/result/0/state'
  },
  {
    name: 'outcome store',
    value: { kind: 'unavailable', continuity: 'unavailable' },
    field: 'kind',
    wrong: 'other',
    validate: normalizeRpcOutcomeStore,
    pointer: '/store/kind'
  },
  {
    name: 'outcome',
    value: {
      mode: 'request',
      targetGeneration: header().task.targetGeneration,
      completion: { ok: true }
    },
    field: 'mode',
    wrong: 'outcome',
    validate: normalizeRpcOutcome,
    pointer: '/outcome/mode'
  },
  {
    name: 'completion',
    value: { ok: true },
    field: 'ok',
    wrong: 'true',
    validate: (value) => normalizeRpcCompletion(value, 'request'),
    pointer: '/outcome/ok'
  },
  {
    name: 'carrier',
    value: { kind: 'message', data: 0 },
    field: 'kind',
    wrong: 'other',
    validate: (value) => normalizeRpcCarrierFrame(value, new Set()),
    pointer: '/frame/kind'
  },
  {
    name: 'manifest',
    value: {
      profile: RpcWireBinaryProfile,
      storage: 'inline',
      envelope: { ...header(), options: {} },
      backings: []
    },
    field: 'profile',
    wrong: 'other',
    validate: normalizeRpcBinaryManifest,
    pointer: '/manifest/profile'
  },
  {
    name: 'backing',
    value: { byteLength: 0, sha256: 'a'.repeat(64) },
    field: 'byteLength',
    wrong: -1,
    validate: (value) =>
      normalizeRpcBinaryManifest({
        profile: RpcWireBinaryProfile,
        storage: 'native',
        envelope: { ...header(), options: {} },
        backings: [value]
      }),
    pointer: '/manifest/0/byteLength'
  }
]

describe('R17 direct record fields', () => {
  it.each(records)(
    '[CORE-A19-FIELD] $name retains native code and first missing/bad known pointer',
    (entry) => {
      expect(() => entry.validate({ ...entry.value, [entry.field]: undefined })).toThrowError(
        expect.objectContaining({
          source: 'rpc.contract',
          code: entry.missingCode ?? entry.code ?? 'INVALID_ENVELOPE',
          pointer: entry.pointer
        })
      )
      expect(() => entry.validate({ ...entry.value, [entry.field]: entry.wrong })).toThrowError(
        expect.objectContaining({
          source: 'rpc.contract',
          code: entry.code ?? 'INVALID_ENVELOPE',
          pointer: entry.wrongPointer ?? entry.pointer
        })
      )
    }
  )

  it('[CORE-A19-OPTIONS] validates optional known fields without inventing required wire options', () => {
    expect(() => normalizeRpcCallOptions(null, 'request')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENVELOPE', pointer: '/options' })
    )
    expect(() => normalizeRpcCallOptions({ cancel: 'other' }, 'request')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENVELOPE', pointer: '/options/cancel' })
    )
  })

  it('[CORE-A19-ORIGINAL] accepts two unknown fields on implementation/carrier/manifest/backing and keeps frozen originals', () => {
    const unknown = { futureA: () => undefined, futureB: new Map() }
    const implementation = Object.freeze({ name: 'fixture', version: '1', ...unknown })
    const offer = Object.freeze({
      ...hello('caller'),
      peer: { id: 'caller', runtime: 'node', implementation }
    })
    expect(normalizeRpcHandshake(offer)).toBe(offer)
    const carrier = Object.freeze({ kind: 'message', data: 0, ...unknown })
    expect(normalizeRpcCarrierFrame(carrier, new Set())).toBe(carrier)
    const backing = Object.freeze({ byteLength: 0, sha256: 'a'.repeat(64), ...unknown })
    const manifest = Object.freeze({
      profile: RpcWireBinaryProfile,
      storage: 'native',
      envelope: Object.freeze({ ...header(), options: Object.freeze({}) }),
      backings: Object.freeze([backing]),
      ...unknown
    })
    expect(normalizeRpcBinaryManifest(manifest)).toBe(manifest)
    expect(manifest.backings[0]).toBe(backing)
  })
})

describe('R19 forwarding contract', () => {
  it('[CORE-A21-ROUTE] admits origin plus sixteen forwarding hosts and rejects overflow', () => {
    /** Stable unique node ids exercise only actual supported route length and spelling. */
    const route = Array.from({ length: RpcWireLimit.maxForwardRouteNodes }, (_, index) =>
      index.toString(16).padStart(32, '0')
    )
    const value = { ...header().route, forwardRoute: route }
    expect(RpcWireLimit.maxForwardHops).toBe(16)
    expect(RpcWireLimit.maxForwardRouteNodes).toBe(17)
    expect(normalizeRpcRoute(value)).toBe(value)
    expect(() =>
      normalizeRpcRoute({ ...value, forwardRoute: [...route, 'f'.repeat(32)] })
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENVELOPE', pointer: '/route/forwardRoute' })
    )
    /** Forward failures preserve the full traversed route through the same flat error grammar. */
    const error = { ...graph(), nodes: [{ ...graph().nodes[0], route }, graph().nodes[1]] }
    expect(normalizeRpcWireError(error)).toBe(error)
    expect(() =>
      normalizeRpcWireError({
        ...error,
        nodes: [{ ...error.nodes[0], route: [...route, 'f'.repeat(32)] }, error.nodes[1]]
      })
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_WIRE_ERROR', pointer: '/nodes/0/route' })
    )
    /** The existing explicit metadata port owns restored diagnostic provenance. */
    const routes = new WeakMap<Error, readonly string[]>()
    const restored = deserializeRpcWireError(error, { routes })
    expect(routes.get(restored)).toEqual(route)
  })

  it('[CORE-A21-PROBE] appends forward without renumbering existing stage ids', () => {
    expect(RpcProbeStage).toEqual({
      peer: 0,
      message: 1,
      envelope: 2,
      encoded: 3,
      frame: 4,
      protected: 5,
      carrier: 6,
      forward: 7
    })
    expect(RpcProbeStageName).toEqual([
      'peer',
      'message',
      'envelope',
      'encoded',
      'frame',
      'protected',
      'carrier',
      'forward'
    ])
    expect(RpcProbeForwardRejection).toEqual({
      loop: 'loop',
      hopLimit: 'hop-limit',
      targetUnknown: 'target-unknown',
      methodUnavailable: 'method-unavailable'
    })
    /** Final message facts borrow the exact traversed route and count only forwarding hosts. */
    const route = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)]
    const facts = rpcProbeEnvelopeFacts({
      id: header().id,
      route: { ...header().route, forwardRoute: route }
    })
    expect(facts.hop).toBe(2)
    expect(facts.route).toBe(route)
    expect(rpcProbeEnvelopeFacts({ id: header().id, route: header().route }).hop).toBe(-1)
  })
})
