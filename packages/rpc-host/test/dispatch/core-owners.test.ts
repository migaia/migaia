import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { defineHost } from '@migaia/plugin-host'
import { rpcHostPipelines, RpcFlowPoint } from '@migaia/rpc-host/sdk'
import { rpcPipelineOwner } from '../../dist/sdk/flow-pipelines.js'
import {
  normalizeRpcFrame,
  deserializeRpcWireError,
  type IRpcEnvelope,
  type IRpcGeneration,
  type IRpcPortableValue
} from '@migaia/rpc-contract/protocol'
import type { IRpcFlowContext, IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { ProviderDispatcher } from '../../dist/dispatch/dispatcher.js'
import type { IRpcContext, IProviderForwardPort } from '../../dist/dispatch/types.js'
import { StreamChannel } from '../../dist/stream/channel.js'
import { Forwarder } from '../../dist/forward/forwarder.js'
import { CallTable } from '../../dist/call/table.js'
import type { ICallLocalOptions, ICallTargetRef } from '../../dist/call/types.js'
import { FeatureScope } from '../../dist/feature/scope.js'
import { createRpcError, createRpcSchemaValidationError } from '../../dist/host/error-owner.js'

/** One actual pair of owner ports models synchronous carrier handoff without a second RPC algorithm. */
class OwnerPair {
  /** Lazy execution access is evaluated only after this actual native handle exists. */
  readonly #rpc = rpcHostPipelines(
    () => this.#native,
    (name) => this.#native.pipeline(name),
    ['test']
  )
  /** Genuine native stages execute the same provider pipeline as the public Host. */
  readonly #native = defineHost({
    ...this.#rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Distinct accepted task generations fence client and server completion paths. */
  readonly clientGeneration: IRpcGeneration = {
    kind: 'session',
    value: 1,
    providerId: 'client-provider'
  }
  /** Server generation remains fixed throughout these local owner transition cases. */
  readonly serverGeneration: IRpcGeneration = {
    kind: 'session',
    value: 1,
    providerId: 'server-provider'
  }
  /** Reports retain exact original business or cleanup error identity. */
  readonly errors: unknown[] = []
  /** One targeted original open-write failure exercises producer cleanup without a second sender. */
  readonly #failOpen: unknown
  /** Only actual server physical frames are recorded, including stream credit terminals. */
  readonly outbound: IRpcEnvelope[] = []
  /**
   * Actual server writes expose the original explicit transfer snapshot without detaching a fake
   * IO.
   */
  readonly outboundTransfers: (readonly ArrayBuffer[] | undefined)[] = []
  /** Actual business completion differs from physical notify handoff. */
  readonly completions: Promise<unknown>[] = []
  /** One canonical FeatureScope selects complete instances without built-in timeout/retry policy. */
  readonly features = new FeatureScope()
  /** CallTable supplies the sole id/task/header preparation and scalar pending owner. */
  readonly calls: CallTable
  /** Caller stream state remains separate from scalar CallTable pending records. */
  readonly clientStreams: StreamChannel
  /** Server producer state remains under the same actual stream owner implementation. */
  readonly serverStreams: StreamChannel
  /** Own-data compilation and incoming business state have one dispatcher owner. */
  readonly dispatcher: ProviderDispatcher
  /** Accepted source facts carry no mutable Session facade. */
  readonly source: IRpcFlowContext
  /** Public target captures only accepted direct address and selected generation. */
  readonly target: ICallTargetRef

  /** Connect actual new owners at their explicit IO boundary; semantic admission stays canonical. */
  constructor(forward?: IProviderForwardPort, failOpen?: unknown) {
    this.#rpc
      .domainCore()
      [rpcPipelineOwner].pipeline(RpcFlowPoint.dispatchInbound, 'test')
      .use(async (payload, next) => {
        this.completions.push(payload.context.completion)
        await next(payload)
      })
    this.#failOpen = failOpen
    this.source = {
      namespace: 'test',
      carrierId: 'binding',
      direction: 'inbound',
      signal: new AbortController().signal,
      report: this.report
    }
    this.target = {
      namespace: 'test',
      carrierId: 'binding',
      peerId: 'server',
      name: 'server',
      generation: this.serverGeneration
    }
    this.calls = new CallTable({
      assertTransfer: () => undefined,
      self: () => ({
        instanceId: 'client',
        generation: this.clientGeneration,
        applicationVersion: '1'
      }),
      send: this.clientSend,
      features: this.features,
      report: this.report
    })
    this.clientStreams = new StreamChannel({
      assertTransfer: () => undefined,
      self: () => ({
        instanceId: 'client',
        generation: this.clientGeneration,
        applicationVersion: '1'
      }),
      prepare: (target, command, options) => this.calls.prepare(target, command, options),
      send: this.clientSend,
      features: this.features,
      report: this.report
    })
    this.serverStreams = new StreamChannel({
      assertTransfer: () => undefined,
      self: this.serverSelf,
      prepare: (target, command, options) => this.calls.prepare(target, command, options),
      send: this.serverSend,
      features: this.features,
      report: this.report
    })
    this.dispatcher = new ProviderDispatcher({
      calls: this.calls,
      self: this.serverSelf,
      send: this.serverSend,
      pipelines: () => this.#rpc.domainCore()[rpcPipelineOwner],
      notify: async () => undefined,
      forward: forward ?? {
        resolveEntry: () => undefined,
        invoke: async () => undefined,
        group: async () => [],
        stream: async function* () {}
      },
      streams: this.serverStreams,
      report: this.report
    })
  }

  /** Reporting captures exact identities and never replaces the original failure. */
  readonly report = (error: unknown): void => {
    this.errors.push(error)
  }
  /** Global server identity comes from one root port across provider and stream writes. */
  readonly serverSelf = () => ({
    instanceId: 'server',
    generation: this.serverGeneration,
    applicationVersion: '1'
  })
  /** Physical handoff commits before synchronous reentrant delivery. */
  readonly clientSend = async (
    _carrierId: string,
    frame: IRpcEnvelope,
    options?: Readonly<{ onWriteStart?: () => void }>
  ): Promise<void> => {
    options?.onWriteStart?.()
    /** Real semantic admission catches accidentally copied call fields on stream/cancel frames. */
    const admitted = normalizeRpcFrame(frame) as IRpcEnvelope
    if (!this.serverStreams.accept('binding', admitted))
      void this.dispatcher.accept(this.source, admitted).catch(this.report)
  }
  /**
   * Matching scalar/stream response routing reaches the actual respective owner without another
   * table.
   */
  readonly serverSend = async (
    _carrierId: string,
    frame: IRpcEnvelope,
    options?: Readonly<{ onWriteStart?: () => void; transfer?: readonly ArrayBuffer[] }>
  ): Promise<void> => {
    if (frame.kind === 'stream' && frame.stream.event === 'open' && this.#failOpen !== undefined)
      throw this.#failOpen
    options?.onWriteStart?.()
    /** Every recorded response has passed the same unique profile validator. */
    const admitted = normalizeRpcFrame(frame) as IRpcEnvelope
    this.outbound.push(admitted)
    this.outboundTransfers.push(options?.transfer)
    if (!this.clientStreams.accept('binding', admitted)) this.calls.accept('binding', admitted)
  }
  /** One package-call entry drives the actual preparation/dispatch/result path. */
  request(
    method: string,
    payload?: IRpcPortableValue,
    options?: ICallLocalOptions
  ): Promise<unknown> {
    return this.calls.invoke(
      this.target,
      { mode: 'request', method, ...(payload === undefined ? {} : { payload }) },
      options
    )
  }
  /** Original consumers/producers and pending scalar records share one explicit teardown. */
  async close(): Promise<void> {
    /** A coded close is the existing host lifecycle contract, not a fixture-only production path. */
    const reason = createRpcError(RpcCoreErrorCode.endpointDisposed, 'fixture closed')
    this.dispatcher.close(reason)
    this.calls.close(reason)
    await Promise.all([this.clientStreams.close(reason), this.serverStreams.close(reason)])
    await this.#native.dispose()
  }
}

describe('C2 ProviderDispatcher / Forwarder / StreamChannel owners', () => {
  it('C2-P15 rejects non-string explicit failure metadata before sending any success', async () => {
    /** Only the actual context helper grants failure authority in the new public contract. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({ get: (_payload, context) => context.failed(42 as never, 'BAD') })
    try {
      await expect(pair.request('get')).rejects.toMatchObject({ code: 'CONTRACT_INVALID' })
      expect(pair.outbound).toHaveLength(1)
      expect(pair.outbound[0]).toMatchObject({ kind: 'error' })
    } finally {
      await pair.close()
    }
  })

  it('C2-P16 returns the original stable failure when no provider owns the method', async () => {
    /** The canonical CallTable enters the actual Dispatcher rather than a facade provider map. */
    const pair = new OwnerPair()
    try {
      await expect(pair.request('test')).rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND' })
      expect(pair.outbound).toHaveLength(1)
      expect(pair.outbound[0]).toMatchObject({ kind: 'error' })
    } finally {
      await pair.close()
    }
  })

  it.each(['schema', 'dispatch-id'] as const)(
    'C2-P17 preserves %s exceptions and releases the exact completed invocation identity',
    async (kind) => {
      /** Every row owns one real catalog, incoming table and native lifecycle context. */
      const pair = new OwnerPair()
      /** The original application schema error remains the reported primary error. */
      const original = createRpcSchemaValidationError('result invalid', { result: true })
      /** Reentry after the first terminal proves the previous correlation no longer owns state. */
      const provider = vi.fn((_payload: unknown, context: IRpcContext) => {
        if (kind === 'schema') throw original
        context.dispatchTo({ id: '', method: 'event', data: null })
        return context.success()
      })
      pair.dispatcher.provide({ test: provider })
      /** This is a real complete call instance prepared by the original CallTable allocator. */
      const input = pair.calls.prepare(pair.target, { mode: 'request', method: 'test' }).envelope
      try {
        await pair.dispatcher.accept(pair.source, input)
        expect(pair.outbound).toHaveLength(1)
        /** New profile uses a flat error graph; native family/code assertions remain unchanged. */
        const response = pair.outbound[0]!
        expect(response.kind).toBe('error')
        if (response.kind !== 'error') expect.unreachable()
        expect(deserializeRpcWireError(response.error)).toMatchObject({
          name: kind === 'schema' ? 'RpcSchemaValidationError' : 'RpcContractError',
          code: kind === 'schema' ? 'SCHEMA_INVALID' : 'CONTRACT_INVALID'
        })
        expect(pair.errors).toHaveLength(1)
        if (kind === 'schema') expect(pair.errors[0]).toBe(original)
        /** Exact repeated correlation executes anew only after the real first terminal released it. */
        await pair.dispatcher.accept(pair.source, input)
        expect(provider).toHaveBeenCalledTimes(2)
        expect(pair.outbound).toHaveLength(2)
        expect(pair.outbound[1]?.id).toBe(input.id)
      } finally {
        await pair.close()
      }
    }
  )

  it('C2-P18 executes a dispatch-only provider once without emitting a response', async () => {
    /** The original business count is independent of physical notify handoff. */
    const provider = vi.fn((_payload: unknown, context: IRpcContext) => context.success('ignored'))
    /** Existing owner wiring exposes the actual business completion and response writes. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({ test: provider })
    try {
      await pair.calls.invoke(pair.target, { mode: 'notify', method: 'test' })
      await Promise.all(pair.completions)
      expect(provider).toHaveBeenCalledOnce()
      expect(pair.outbound).toEqual([])
    } finally {
      await pair.close()
    }
  })

  it('C2-P12 unwraps only its own success and sends the original frozen transfer snapshot', async () => {
    /** This is actual native backing identity borrowed by the provider result helper. */
    const backing = new ArrayBuffer(8)
    /** Caller mutation after minting cannot reconfigure the admitted result's transfer metadata. */
    const transfer = [backing]
    /** The actual dispatcher and CallTable exchange the unique semantic result envelope. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({
      get: (_payload, context) => {
        /** The original context alone mints settlement authority while data remains unchanged. */
        const result = context.success('ok', { transfer })
        transfer.length = 0
        return result
      },
      ordinary: () => ({ ok: true, data: 'business object' })
    })
    expect(await pair.request('get')).toBe('ok')
    expect(pair.outbound).toHaveLength(1)
    expect(pair.outbound[0]).toMatchObject({ kind: 'result', result: 'ok' })
    expect(pair.outboundTransfers[0]).toEqual([backing])
    expect(pair.outboundTransfers[0]?.[0]).toBe(backing)
    expect(Object.isFrozen(pair.outboundTransfers[0])).toBe(true)
    expect(await pair.request('ordinary')).toEqual({ ok: true, data: 'business object' })
    await pair.close()
  })

  it('C2-P13 preserves an explicit failure code/message without returning private input', async () => {
    /** The exact helper result must select a failure rather than a successful business record. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({ get: (_payload, context) => context.failed('denied', 'DENIED') })
    await expect(pair.request('get', { secret: 'private-parameter' })).rejects.toMatchObject({
      code: 'DENIED',
      message: 'denied'
    })
    expect(pair.outbound).toHaveLength(1)
    expect(pair.outbound[0]?.kind).toBe('error')
    expect(JSON.stringify(pair.outbound)).not.toContain('private-parameter')
    await pair.close()
  })

  it('C2-P14 rejects oversized transfer metadata before returning any physical transfer list', async () => {
    /** Admission still uses the original fixed provider helper limit before any carrier write. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({
      get: (_payload, context) =>
        context.success('ok', { transfer: Array.from({ length: 65 }, () => new ArrayBuffer(1)) })
    })
    await expect(pair.request('get')).rejects.toMatchObject({
      code: RpcCoreErrorCode.contractInvalid
    })
    expect(pair.outboundTransfers[0]).toBeUndefined()
    expect(pair.outbound).toHaveLength(1)
    expect(pair.outbound[0]).toMatchObject({ kind: 'error' })
    await pair.close()
  })

  it('C2-P01 captures descriptor order, method identity and original local receiver without getters', async () => {
    /** Original local group receiver is the actual object captured by descriptor compilation. */
    const receiver = {
      z: function (payload: unknown) {
        return [payload, this === receiver]
      },
      a: () => 2
    }
    /** One true owner pair drives public provided method behavior. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({ group: receiver })
    receiver.z = () => [99, false]
    expect(pair.dispatcher.describe().map((method) => method.name)).toEqual(['group.z', 'group.a'])
    expect(await pair.request('group.z', 3)).toEqual([3, true])
    /** Catalog getter rejection must never invoke the business accessor. */
    let reads = 0
    /** This malformed own-data record is intentionally passed through the real catalog entry point. */
    const invalid = Object.defineProperty({}, 'bad', {
      enumerable: true,
      get: () => {
        reads += 1
        return () => 1
      }
    })
    expect(() => pair.dispatcher.provide(invalid)).toThrow()
    expect(reads).toBe(0)
    await pair.close()
  })

  it('C2-P02 preserves one then getter read and actual foreign thenable completion', async () => {
    /** The supported foreign thenable getter must be observed exactly once. */
    let reads = 0
    /** Captured then resolves a normal portable scalar through the canonical return projector. */
    // eslint-disable-next-line unicorn/no-thenable -- This fixture proves the existing foreign thenable return contract.
    const returned = Object.defineProperty({}, 'then', {
      get: () => {
        reads += 1
        return (resolve: (value: number) => void) => resolve(7)
      }
    })
    /** The actual new dispatcher receives this original business return. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({ get: () => returned })
    expect(await pair.request('get')).toBe(7)
    expect(reads).toBe(1)
    await pair.close()
  })

  it('C2-P03 retains notify id cancellation until actual business completion and adds no ordinary ACK', async () => {
    /** Business completion is deliberately later than physical notification handoff. */
    const release = deferred<void>()
    /** This Promise observes the actual captured provider context rather than fixture-private state. */
    const started = deferred<IRpcContext>()
    /** A normal client cancellation signal remains usable after notify public fulfillment. */
    const abort = new AbortController()
    /** One actual pair retains incoming state under ProviderDispatcher. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({
      work: async (_payload, context) => {
        started.resolve(context)
        await release.promise
      }
    })
    await pair.calls.invoke(
      pair.target,
      { mode: 'notify', method: 'work' },
      { signal: abort.signal }
    )
    /** Captured context is public business input and keeps its original native signal. */
    const context = await started.promise
    abort.abort(createRpcError(RpcCoreErrorCode.cancelled, 'fixture cancellation'))
    expect(context.signal.aborted).toBe(true)
    /** Actual completion cannot settle while the original handler is still running. */
    let completed = false
    void pair.completions[0]!.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(pair.outbound).toEqual([])
    release.resolve()
    await pair.completions[0]
    expect(context.success()).toMatchObject({ ok: false, code: RpcCoreErrorCode.contextExpired })
    expect(pair.outbound).toEqual([])
    await pair.close()
  })

  it('C2-P04 executes one group success prefix, first original failure and not-executed suffix', async () => {
    /** Trace proves the actual invocation order and that the suffix never starts. */
    const trace: string[] = []
    /** Business failure retains exact native identity for local diagnostics. */
    const failure = createRpcError(RpcCoreErrorCode.internal, 'fixture failure')
    /** The actual group route crosses unique-profile admission in both directions. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({
      first: () => {
        trace.push('first')
        return 1
      },
      fail: () => {
        trace.push('fail')
        throw failure
      },
      skipped: () => {
        trace.push('skipped')
        return 3
      }
    })
    expect(
      await pair.calls.invoke(pair.target, {
        mode: 'group',
        steps: [{ method: 'first' }, { method: 'fail' }, { method: 'skipped' }]
      })
    ).toEqual([
      { state: 'success', result: 1 },
      { state: 'failure', error: expect.objectContaining({ nodes: expect.any(Array) }) },
      { state: 'not-executed' }
    ])
    expect(trace).toEqual(['first', 'fail'])
    expect(pair.errors).toContain(failure)
    await pair.close()
  })

  it('C2-P05 keeps stream lazy, single-credit demand and original generator final value', async () => {
    /** Trace proves no eager construction/prefetch and exact business pull order. */
    const trace: string[] = []
    /**
     * One real pair drives stream invocation, credit, item and terminal through the canonical
     * grammar.
     */
    const pair = new OwnerPair()
    pair.dispatcher.provide({
      values: function* () {
        trace.push('first')
        yield 1
        trace.push('second')
        yield 2
        trace.push('end')
        return 9
      }
    })
    /** Public iterator construction must not invoke the provider or allocate stream traffic. */
    const stream = pair.clientStreams.open(pair.target, 'values')
    expect(trace).toEqual([])
    expect(pair.outbound).toEqual([])
    expect(await stream.next()).toEqual({ done: false, value: 1 })
    expect(trace).toEqual(['first'])
    /** Concurrent caller demand stays serialized over the same producer credit owner. */
    const second = stream.next()
    /** A following next belongs to its own queued Promise, preserving demand order. */
    const end = stream.next()
    expect(await second).toEqual({ done: false, value: 2 })
    expect(await end).toEqual({ done: true, value: 9 })
    expect(await stream.next()).toEqual({ done: true, value: 9 })
    expect(trace).toEqual(['first', 'second', 'end'])
    await pair.close()
  })

  it('C2-P06 unopened return performs no business work and before-start return drains the same iterator', async () => {
    /** One trace records actual original iterator progress through finish-without-items. */
    const trace: number[] = []
    /** The provider remains the same synchronous iterable supported by the old stream owner. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({
      values: function* () {
        trace.push(1)
        yield 1
        trace.push(2)
        yield 2
        trace.push(3)
        return 3
      }
    })
    /** A never-started public iterator is a real supported path and must not send cancellation. */
    const unopened = pair.clientStreams.open(pair.target, 'values')
    expect(await unopened.return!()).toEqual({ done: true, value: undefined })
    expect(trace).toEqual([])
    /** Started before-start return keeps the original producer and discards its remaining items. */
    const stream = pair.clientStreams.open(pair.target, 'values', undefined, {
      cancel: 'before-start'
    })
    expect(await stream.next()).toEqual({ done: false, value: 1 })
    expect(await stream.return!()).toEqual({ done: true, value: 3 })
    expect(trace).toEqual([1, 2, 3])
    await pair.close()
  })

  it('C2-P07 held forward callable fences same-name generation replacement before sending', async () => {
    /** Current accepted view changes while the original capability retains only compact identity. */
    let current: Readonly<{ carrierId: string; view: IRpcSessionView }> | undefined
    /** One selected method description is borrowed at cold capability construction. */
    const method = {
      name: 'get',
      supportedModes: ['request'] as const,
      modeSource: 'generated-routes' as const
    }
    /** Direct-directory accepted source facts require no Session facade. */
    const view: IRpcSessionView = {
      namespace: 'test',
      peerId: 'target',
      name: 'named',
      generation: { kind: 'session', value: 1, providerId: 'target-provider' },
      methods: new Map([['get', method]]),
      codec: 'json',
      extensions: new Set()
    }
    current = { carrierId: 'target-binding', view }
    /** Physical sends can be counted at the actual narrow CallTable port. */
    let sends = 0
    /** Forwarder shares root selection indexes rather than creating a target registry. */
    const forwarder = new Forwarder({
      nodeId: () => 'local-node',
      resolve: () => current,
      current: () => current,
      sourceNodeId: () => 'target-node',
      call: async () => {
        sends += 1
        return 1
      },
      stream: async function* () {}
    })
    /** The original held callable captures no mutable accepted view. */
    const held = forwarder.hold(current, method)
    expect(await held()).toBe(1)
    current = {
      carrierId: 'target-binding',
      view: { ...view, generation: { ...view.generation, value: 2 } }
    }
    await expect(held()).rejects.toMatchObject({ code: RpcCoreErrorCode.targetUnknown })
    expect(sends).toBe(1)
  })

  it('C2-P08 keeps close pending until the original outstanding next and return really settle', async () => {
    /** A real provider next remains pending after its cancellation cleanup return has completed. */
    const pending = deferred<IteratorResult<IRpcPortableValue>>()
    /** This entry signal observes the exact second business next call. */
    const entered = deferred<void>()
    /** Exact iterator side effects prove no parallel duplicate return or early lease release. */
    const trace = { reads: 0, returns: 0 }
    /** One actual async iterator keeps its original receiver for next/return. */
    const iterator: AsyncIterableIterator<IRpcPortableValue> = {
      next() {
        trace.reads += 1
        if (trace.reads === 1) return Promise.resolve({ done: false, value: 1 })
        entered.resolve()
        return pending.promise
      },
      return() {
        trace.returns += 1
        return Promise.resolve({ done: true, value: undefined })
      },
      [Symbol.asyncIterator]() {
        return this
      }
    }
    /** Real consumer/provider owners retain the actual business lifetime through cancellation. */
    const pair = new OwnerPair()
    pair.dispatcher.provide({ values: () => iterator })
    /** The first item establishes the original stream before a second pending next begins. */
    const stream = pair.clientStreams.open(pair.target, 'values')
    expect(await stream.next()).toEqual({ done: false, value: 1 })
    /** Capture expected shutdown rejection without creating an unhandled late failure. */
    const second = stream.next().catch((error: unknown) => error)
    await entered.promise
    /** Close must wait for original next even after iterator.return has completed. */
    const closed = pair.close()
    /** A public observation distinguishes actual cleanup completion from early table removal. */
    let settled = false
    void closed.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(trace.returns).toBe(1)
    pending.resolve({ done: true, value: undefined })
    await closed
    expect(await second).toMatchObject({ code: RpcCoreErrorCode.endpointDisposed })
    expect(trace.returns).toBe(1)
  })

  it('C2-P09 compiles direct fullpath forwarding and refuses loops before downstream sends', async () => {
    /**
     * Accepted direct methods include a dotted peer name and method, preserving longest prefix
     * metadata.
     */
    const method = {
      name: 'thing.get',
      supportedModes: ['request'] as const,
      modeSource: 'generated-routes' as const
    }
    /** Compact generation fences direct forwarding without retaining a mutable Session object. */
    const selection = {
      carrierId: 'downstream',
      view: {
        namespace: 'test',
        peerId: 'downstream-id',
        name: 'alice.group',
        generation: { kind: 'session' as const, value: 1, providerId: 'downstream-provider' },
        methods: new Map([['thing.get', method]]),
        codec: 'json',
        extensions: new Set<string>()
      }
    }
    /** Canonical Session retirement removes this actual selection before notifying Forwarder. */
    const current: { selection: typeof selection | undefined } = { selection }
    /** Actual downstream operation ports record the selected method and shrinking route budget. */
    const sent: { method?: string; options?: ICallLocalOptions }[] = []
    /** One Forwarder owns the cold direct-directory index consumed by Dispatcher local misses. */
    const forwarder = new Forwarder({
      nodeId: () => '22222222222222222222222222222222',
      resolve: (_namespace, name) =>
        name === current.selection?.view.name ? current.selection : undefined,
      current: (carrierId) =>
        carrierId === current.selection?.carrierId ? current.selection : undefined,
      sourceNodeId: (carrierId) =>
        carrierId === 'binding'
          ? '11111111111111111111111111111111'
          : '33333333333333333333333333333333',
      call: async (_target, command, options) => {
        sent.push({ ...('method' in command ? { method: command.method } : {}), options })
        return 9
      },
      stream: async function* () {}
    })
    forwarder.accepted(selection)
    /**
     * The regular public call crosses actual Dispatcher local-miss resolution, not a special test
     * seam.
     */
    const pair = new OwnerPair(forwarder)
    expect(await pair.request('alice.group.thing.get', undefined, { remainingMs: 1000 })).toBe(9)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      method: 'thing.get',
      options: {
        origin: false,
        forwardRoute: ['11111111111111111111111111111111', '22222222222222222222222222222222']
      }
    })
    expect(sent[0]!.options!.remainingMs).toBeLessThanOrEqual(1000)
    await expect(
      pair.request('alice.group.thing.get', undefined, {
        forwardRoute: ['11111111111111111111111111111111', '22222222222222222222222222222222']
      })
    ).rejects.toMatchObject({ code: RpcCoreErrorCode.forwardLoop })
    expect(sent).toHaveLength(1)
    current.selection = undefined
    forwarder.retired('downstream')
    await expect(pair.request('alice.group.thing.get')).rejects.toMatchObject({
      code: RpcCoreErrorCode.targetUnknown
    })
    await pair.close()
  })

  it('C2-P10 replies to stale selected generation admission instead of leaving the caller pending', async () => {
    /** A selected old generation is a normal supported failure at the actual provider boundary. */
    const pair = new OwnerPair()
    /** Business must not run merely because method text matches in a successor generation. */
    let calls = 0
    pair.dispatcher.provide({
      get: () => {
        calls += 1
        return 1
      }
    })
    await expect(
      pair.calls.invoke(
        { ...pair.target, generation: { ...pair.serverGeneration, value: 2 } },
        { mode: 'request', method: 'get' }
      )
    ).rejects.toMatchObject({ code: RpcCoreErrorCode.providerGenerationMismatch })
    expect(calls).toBe(0)
    await pair.close()
  })

  it('C2-P11 failed physical open releases its own write before waiting for producer cleanup', async () => {
    /** This real physical rejection previously made producer.start wait on its own pending write. */
    const failure = createRpcError(RpcCoreErrorCode.transport, 'fixture open write failed')
    /** The same actual pair injects only the original server open write failure. */
    const pair = new OwnerPair(undefined, failure)
    pair.dispatcher.provide({
      values: function* () {
        yield 1
      }
    })
    /** No item credit can complete before its original failed producer open. */
    const stream = pair.clientStreams.open(pair.target, 'values')
    /** The caller settles with the physical open failure instead of waiting on producer cleanup. */
    await expect(stream.next()).rejects.toMatchObject({ code: RpcCoreErrorCode.transport })
    await pair.close()
    expect(pair.errors).toContain(failure)
  })
})
