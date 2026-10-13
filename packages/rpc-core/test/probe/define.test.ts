import { describe, expect, it, vi } from 'vitest'
import {
  defineProbe,
  probePlugin,
  rpcProbeSampleKey,
  snapshotProbeEvent,
  RpcProbeStage,
  RpcProbeStageName,
  RpcProbeDirection,
  RpcProbeDirectionName,
  RpcProbeKind,
  RpcProbeKindName,
  RpcProbeOutcome,
  RpcProbeOutcomeName,
  type IRpcProbeDefinition,
  type IRpcProbeEventView,
  type IRpcProbe,
  type IRpcProbeStageName
} from '../../dist/core/probe/index.js'
import { readProbeState, subscribeProbeStages } from '../../dist/core/probe/internal.js'

describe('probe contract A1', () => {
  it('compiles a frozen handle and retains the original sink and compiled method membership', () => {
    /** The actual application sink must remain directly callable by the later single-probe emitter. */
    const emit = vi.fn()
    /** Caller mutation after compilation must not change the copied filter. */
    const methods = ['echo']
    /** The published definition example exercises stage, capture and full-sampling defaults. */
    const probe = defineProbe({ stages: ['message', 'frame'], capture: ['frame'], methods, emit })
    expect(Object.isFrozen(probe)).toBe(true)
    expect(probe.stageMask).toBe((1 << 1) | (1 << 4))
    expect(probe.captureMask).toBe(1 << 4)
    expect(probe.sampleThreshold).toBe(0xffffffff)
    expect(Object.getOwnPropertyDescriptor(probe, 'emit')?.value).toBe(emit)
    expect([...probe.methods!]).toEqual(['echo'])
    methods.push('changed')
    expect(probe.methods!.has('changed')).toBe(false)
    expect(defineProbe({ stages: ['peer'], emit }).methods).toBeUndefined()
    expect(defineProbe({ stages: ['peer'], sample: 0.25, emit }).sampleThreshold).toBe(
      Math.floor(0.25 * 2 ** 32)
    )
  })

  it('attaches a genuine probe to the same frozen host without changing its API members', () => {
    /** The host keeps its application's query and direct collector sink references. */
    const query = vi.fn(),
      hostEmit = vi.fn()
    /** The definition sink is separate so installation cannot accidentally read host.emit. */
    const emit = vi.fn(),
      describe = vi.fn(),
      redact = vi.fn(),
      onError = vi.fn()
    /** Additional members remain on the one object selected by the caller. */
    const host = { query, emit: hostEmit }
    /** Revision 2 preserves the host's exact identity while attaching compiled fields. */
    const probe = defineProbe(
      {
        stages: ['message', 'frame'],
        capture: ['frame'],
        methods: ['echo'],
        sample: 0.25,
        emit,
        describe,
        redact,
        onError
      },
      host
    )
    expect(probe).toBe(host)
    expect(Object.isFrozen(host)).toBe(true)
    expect(probe.query).toBe(query)
    expect(probe.emit).toBe(hostEmit)
    expect(probe.stageMask).toBe((1 << 1) | (1 << 4))
    expect(probe.captureMask).toBe(1 << 4)
    expect(probe.sampleThreshold).toBe(0x40000000)
    /** This exact-host lookup is the later emitter's installation admission seam. */
    const state = readProbeState(probe)
    expect(state).toMatchObject({
      stageMask: (1 << 1) | (1 << 4),
      captureMask: 1 << 4,
      methods: probe.methods,
      sampleThreshold: 0x40000000,
      emit,
      describe,
      redact,
      onError
    })
    expect(state?.methods).toBe(probe.methods)
    for (const field of ['stageMask', 'captureMask', 'methods', 'sampleThreshold']) {
      expect(Object.getOwnPropertyDescriptor(probe, field)).toMatchObject({
        writable: false,
        configurable: false
      })
      expect(Object.getOwnPropertyDescriptor(probe, field)?.get).toBeUndefined()
    }
    /** Installed emitters read the active private mask; the frozen host data field stays initial. */
    const changed = vi.fn()
    /** Subscription identity remains the same host accepted by readProbeState. */
    const unsubscribe = subscribeProbeStages(probe, changed)
    probe.setStages([])
    expect(probe.stageMask).toBe((1 << 1) | (1 << 4))
    expect(state?.stageMask).toBe(0)
    expect(changed).toHaveBeenCalledTimes(1)
    probe.setStages(['peer'])
    expect(state?.stageMask).toBe(1)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(() => probe.setStages(['unknown'] as unknown as IRpcProbeStageName[])).toThrow(TypeError)
    expect(state?.stageMask).toBe(1)
    expect(changed).toHaveBeenCalledTimes(2)
    unsubscribe()
    expect(query).not.toHaveBeenCalled()
    expect(hostEmit).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('attaches only the five reserved fields when the host has no emit member', () => {
    /** A minimal application API must not gain an invented public observation method. */
    const query = vi.fn()
    /** The application-selected host exists before probe construction. */
    const host = { query }
    /** The private definition sink remains usable by an installed emitter without a host.emit. */
    const emit = vi.fn()
    /** The returned reference retains the application's original static member typing. */
    const probe = defineProbe({ stages: ['message'], emit }, host)
    expect(probe.query).toBe(query)
    expect(Reflect.ownKeys(host)).toEqual([
      'query',
      'stageMask',
      'captureMask',
      'methods',
      'sampleThreshold',
      'setStages'
    ])
    expect(readProbeState(probe)?.emit).toBe(emit)
  })

  it.each(['stageMask', 'captureMask', 'methods', 'sampleThreshold', 'setStages'])(
    'rejects an own %s field before mutating the host',
    (field) => {
      /** Existing API identity and the reserved-field descriptor must survive failed validation. */
      const query = vi.fn()
      /** Even a configurable reserved field is not replaced by host attachment. */
      const host = { query }
      Object.defineProperty(host, field, { value: 'owned', writable: true, configurable: true })
      expect(() => defineProbe({ stages: ['peer'], emit: vi.fn() }, host)).toThrow(
        expect.objectContaining({
          source: '@migaia/rpc/core',
          code: 'INVALID_CONFIG',
          name: 'TypeError'
        })
      )
      expect(Reflect.ownKeys(host)).toEqual(['query', field])
      expect(Object.getOwnPropertyDescriptor(host, field)).toEqual({
        value: 'owned',
        writable: true,
        configurable: true,
        enumerable: false
      })
      expect(host.query).toBe(query)
      expect(Object.isExtensible(host)).toBe(true)
      expect(readProbeState(host as unknown as IRpcProbe)).toBeUndefined()
    }
  )

  it('rejects frozen, nonextensible and already registered hosts without changing them', () => {
    /** Existing API references must survive all host-state admission failures. */
    const query = vi.fn()
    /** These supported object-state failures require no failed property writes to detect. */
    const frozen = Object.freeze({ query }),
      sealed = Object.preventExtensions({ query })
    /** An already minted probe must not acquire a second definition or private state. */
    const registered = defineProbe({ stages: ['peer'], emit: vi.fn() }, { query })
    /** Exact original private identity must survive repeated registration refusal. */
    const state = readProbeState(registered)
    for (const host of [frozen, sealed, registered]) {
      expect(() => defineProbe({ stages: ['message'], emit: vi.fn() }, host)).toThrow(
        expect.objectContaining({
          source: '@migaia/rpc/core',
          code: 'INVALID_CONFIG',
          name: 'TypeError'
        })
      )
      expect(host.query).toBe(query)
      expect(Object.isExtensible(host)).toBe(false)
    }
    expect(Reflect.ownKeys(frozen)).toEqual(['query'])
    expect(Reflect.ownKeys(sealed)).toEqual(['query'])
    expect(Object.isFrozen(sealed)).toBe(false)
    expect(readProbeState(registered)).toBe(state)
    expect(state?.stageMask).toBe(1)
  })

  it.each([null, undefined, 1, 'host'])(
    'rejects invalid host %s with native INVALID_CONFIG',
    (host) => {
      expect(() =>
        defineProbe({ stages: ['peer'], emit: vi.fn() }, host as unknown as object)
      ).toThrow(
        expect.objectContaining({
          source: '@migaia/rpc/core',
          code: 'INVALID_CONFIG',
          name: 'TypeError'
        })
      )
    }
  )

  it('validates the whole definition before attaching any property to a valid host', () => {
    /** The caller retains a normal extensible API object after definition rejection. */
    const query = vi.fn()
    /** No compiled field may appear when initial stage validation fails. */
    const host = { query }
    expect(() => defineProbe({ stages: [], emit: vi.fn() }, host)).toThrow(TypeError)
    expect(Reflect.ownKeys(host)).toEqual(['query'])
    expect(host.query).toBe(query)
    expect(Object.isExtensible(host)).toBe(true)
  })

  it('keeps private callbacks and notifies stage subscribers only after a valid changed mask', () => {
    /** The callback identities remain available only through the package-private WeakMap seam. */
    const emit = vi.fn(),
      describe = vi.fn(),
      redact = vi.fn(),
      onError = vi.fn()
    /** A captured frame remains opted in even when subscriptions pause or temporarily select peer. */
    const probe = defineProbe({
      stages: ['message', 'frame'],
      capture: ['frame'],
      emit,
      describe,
      redact,
      onError
    })
    /** Installed emitters subscribe cold; no transport or emission activates in the contract layer. */
    const changed = vi.fn()
    /** Disposing the emitter's subscription must stop subsequent rebuild notifications. */
    const unsubscribe = subscribeProbeStages(probe, changed)
    expect(readProbeState(probe)).toMatchObject({ emit, describe, redact, onError })
    expect('subscribe' in probe).toBe(false)
    probe.setStages(['peer'])
    expect(probe.stageMask).toBe(1)
    expect(probe.captureMask).toBe(1 << 4)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(() => probe.setStages(['unknown'] as unknown as IRpcProbeStageName[])).toThrow(TypeError)
    expect(probe.stageMask).toBe(1)
    expect(changed).toHaveBeenCalledTimes(1)
    probe.setStages([])
    expect(probe.stageMask).toBe(0)
    expect(changed).toHaveBeenCalledTimes(2)
    probe.setStages([])
    expect(changed).toHaveBeenCalledTimes(2)
    unsubscribe()
    unsubscribe()
    probe.setStages(['frame'])
    expect(probe.stageMask).toBe(1 << 4)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(emit).not.toHaveBeenCalled()
  })

  /** Each row is one explicitly invalid definition field, independent from the valid sink. */
  const invalidDefinitions: readonly [string, object][] = [
    ['empty stages', { stages: [] }],
    ['unknown stage', { stages: ['unknown'] }],
    ['capture outside stages', { capture: ['frame'] }],
    ['unknown capture', { capture: ['unknown'] }],
    ['zero sample', { sample: 0 }],
    ['negative sample', { sample: -0.1 }],
    ['sample above one', { sample: 1.01 }],
    ['NaN sample', { sample: NaN }],
    ['infinite sample', { sample: Infinity }],
    ['string sample', { sample: '0.5' }],
    ['missing emit', { emit: undefined }],
    ['nonfunction emit', { emit: 1 }],
    ['nonfunction redact', { redact: true }],
    ['nonfunction describe', { describe: true }],
    ['nonfunction onError', { onError: true }],
    ['nonstring method', { methods: [1] }]
  ]
  it.each(invalidDefinitions)(
    'rejects %s with native top-level INVALID_CONFIG',
    (_name, fields) => {
      /** Only the selected invalid field changes the otherwise valid public definition. */
      const definition = { stages: ['message'], emit: vi.fn(), ...fields } as IRpcProbeDefinition
      expect(() => defineProbe(definition)).toThrow(TypeError)
      expect(() => defineProbe(definition)).toThrow(
        expect.objectContaining({
          source: '@migaia/rpc/core',
          code: 'INVALID_CONFIG',
          name: 'TypeError'
        })
      )
    }
  )

  it('keeps small integer domains aligned with their ordered public name tables', () => {
    expect(Object.values(RpcProbeStage)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(Object.keys(RpcProbeStage)).toEqual(RpcProbeStageName)
    expect(Object.values(RpcProbeDirection)).toEqual([0, 1, 2])
    expect(Object.keys(RpcProbeDirection)).toEqual(RpcProbeDirectionName)
    expect(Object.values(RpcProbeKind)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(Object.keys(RpcProbeKind)).toEqual(RpcProbeKindName)
    expect(Object.values(RpcProbeOutcome)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(Object.keys(RpcProbeOutcome)).toEqual(RpcProbeOutcomeName)
  })

  it('matches published FNV-1a vectors and deterministic UTF-8 sender/message concatenation', () => {
    expect(rpcProbeSampleKey('', '')).toBe(0x811c9dc5)
    expect(rpcProbeSampleKey('foo', 'bar')).toBe(0xbf9cf968)
    expect(rpcProbeSampleKey('f', 'oobar')).toBe(rpcProbeSampleKey('foo', 'bar'))
    expect(rpcProbeSampleKey('调用方', '请求')).toBe(rpcProbeSampleKey('调用方', '请求'))
    /** Independent host UTF-8 bytes establish the declared Unicode encoding of the pure Core hash. */
    const bytes = new TextEncoder().encode('调用方请求😀')
    /** The published bytewise algorithm is the oracle, independent from Core's scalar encoder. */
    let expected = 0x811c9dc5
    for (const byte of bytes) expected = Math.imul(expected ^ byte, 0x01000193) >>> 0
    expect(rpcProbeSampleKey('调用方', '请求😀')).toBe(expected)
  })

  it('copies every reusable view field without replacing content, error or detail identity', () => {
    /** One complete view exercises every fixed-shape field and all reference-bearing payloads. */
    const view: IRpcProbeEventView = {
      seq: 1,
      carrierSeq: -1,
      at: 123,
      endpointId: 'left',
      stage: 1,
      direction: 0,
      kind: 0,
      outcome: 1,
      messageId: 'message',
      method: 'echo',
      variation: undefined,
      senderId: 'left',
      targetId: 'right',
      receiverId: 'receiver',
      peerId: 'peer',
      trace: 'trace',
      sizeBytes: 4,
      chunkIndex: -1,
      chunkCount: -1,
      members: -1,
      durationMs: -1,
      rejection: undefined,
      lifecycle: undefined,
      error: new Error('snapshot fixture'),
      carrier: 'memory',
      detail: { count: 1 },
      content: { value: 1 }
    }
    /** Snapshot ownership is shallow: subsequent field assignments do not mutate the retained event. */
    const snapshot = snapshotProbeEvent(view)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(snapshot).toEqual(view)
    expect(snapshot).not.toBe(view)
    expect(snapshot.content).toBe(view.content)
    expect(snapshot.detail).toBe(view.detail)
    expect(snapshot.error).toBe(view.error)
    view.seq = 2
    view.method = 'changed'
    view.content = undefined
    expect(snapshot.seq).toBe(1)
    expect(snapshot.method).toBe('echo')
    expect(snapshot.content).toEqual({ value: 1 })
  })

  it('compiles endpoint probe plugins and rejects structural handles before installation', () => {
    /** Runtime installation accepts both an empty supported plugin and genuine compiled handles. */
    const emit = vi.fn()
    /** This exact handle is admitted through the contract's private registration, not its shape. */
    const probe = defineProbe({ stages: ['message'], emit })
    for (const plugin of [probePlugin(), probePlugin(probe)]) {
      expect(Object.isFrozen(plugin)).toBe(true)
      expect(plugin).toMatchObject({
        name: 'probe',
        metadata: {
          claims: {
            routes: [],
            provides: [],
            consumes: [],
            publicKeys: [],
            exposedKeys: [],
            activator: false
          },
          sharedProvides: ['probe'],
          sharedConsumes: ['time']
        },
        install: expect.any(Function)
      })
    }
    expect(emit).not.toHaveBeenCalled()
    /** Matching every public field cannot forge the private probe identity used by installation. */
    expect(() => probePlugin({ ...probe })).toThrow(
      expect.objectContaining({
        source: '@migaia/rpc/core',
        code: 'INVALID_CONFIG',
        name: 'TypeError'
      })
    )
  })
})
