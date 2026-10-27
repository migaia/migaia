import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { coreMemoryServer } from '../../host/core-fixture.js'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import type {
  IRpcCarrierFrame,
  IRpcFramePayload,
  IRpcFrameWriteOptions
} from '@migaia/rpc-contract/interfaces'
import { batch } from '../../../dist/features/batch/index.js'
import { FlowRegistry, type IRpcFlowGroup } from '../../../dist/flow/registry.js'
import {
  rpcHostPipelines,
  rpcPipelineOwner,
  RpcFlowPoint,
  RpcFlowPipelines,
  type IRpcPipelineOwner
} from '../../../dist/sdk/flow-pipelines.js'
import { RpcTransportFlowProgram } from '../../../dist/sdk/flow-program.js'
import type { IRpcFlowInstallation } from '../../../dist/sdk/types.js'

/** The real native factory/setup is used by every owning physical-flow oracle. */
async function fixture() {
  /** The native graph instantiates this genuine factory handle before its install callback. */
  const feature = batch({ required: true })
  /** Physical source lifetime remains separate from native installation cleanup. */
  const source = new AbortController()
  /** Installation cleanup owns its original setup signal. */
  const setup = new AbortController()
  /** Failures from independent inbound members remain observable. */
  const errors: unknown[] = []
  /** Actual native preparation publishes this exact installation before use() completes. */
  let installation!: IRpcFlowInstallation<object>
  /** Actual native construction requests supply one execution port per installed group. */
  const owners = new Map<string, IRpcPipelineOwner>()
  /** Only prepared original groups contribute namespace facts to this fixture. */
  const groups = new Map<string, IRpcFlowGroup>()
  /** Canonical native Feature inspection owns the local setup and its dependency closure. */
  const program = new RpcTransportFlowProgram([feature])
  /** Qualified declarations and execution authority come from the same canonical SDK owner. */
  const rpc = rpcHostPipelines(
    () => flow,
    (name, request) => flow.pipeline(name, request)
  )
  /** Native plugin-host owns the only snapshot, lease and multiple-submission execution path. */
  const flow = defineHost({
    domainCore(request) {
      /** The genuine native request fixes this registration's execution authority. */
      const domain = rpc.domainCore(request)
      owners.set(request.pluginName, domain[rpcPipelineOwner])
      return domain
    },
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Production registration attaches actual setup stages through a genuine install core. */
  const registry = new FlowRegistry(
    (error) => {
      errors.push(error)
    },
    (namespace) => groups.get(namespace)
  )
  await flow.use(
    definePlugin({
      name: 'test',
      pipelines: RpcFlowPipelines,
      features: program.features,
      async install(core) {
        /** Canonical setup retains the original instance and its genuine native cleanup owner. */
        const group = await registry.prepareTransport(core, program, setup.signal, {
          signal: setup.signal,
          report: (error) => {
            errors.push(error)
          },
          retire: async () => undefined,
          call: async () => undefined
        })
        groups.set('test', group)
        installation = group.facts().selected[0]!
        return {}
      }
    })
  )
  /** The other namespace is a separate genuine native group with no selected Features. */
  const other = new RpcTransportFlowProgram()
  await flow.use(
    definePlugin({
      name: 'other',
      pipelines: RpcFlowPipelines,
      features: other.features,
      async install(core) {
        groups.set(
          'other',
          await registry.prepareTransport(core, other, setup.signal, {
            signal: setup.signal,
            report: (error) => {
              errors.push(error)
            },
            retire: async () => undefined,
            call: async () => undefined
          })
        )
        return {}
      }
    })
  )
  registry.start()
  /** Borrow typed execution from the same actual native Host owner, never a copied runner. */
  const pipelines = owners.get('test')!
  /** Each call borrows accepted facts while retaining its own original write options. */
  const context = (
    write?: IRpcFrameWriteOptions,
    direction: 'outbound' | 'inbound' = 'outbound'
  ): Pick<IRpcFramePayload, 'context' | 'write'> => ({
    write,
    context: {
      namespace: 'test',
      carrierId: 'source',
      direction,
      signal: write?.signal === false ? source.signal : (write?.signal ?? source.signal),
      connectionSignal: source.signal,
      report: (error) => {
        errors.push(error)
      },
      session: {
        namespace: 'test',
        peerId: 'peer',
        name: 'peer',
        generation: { kind: 'session', value: 1, providerId: 'peer' },
        methods: new Map(),
        codec: 'json',
        extensions: new Set(['batch@1'])
      }
    }
  })
  return { source, installation, flow, pipelines, registry, errors, context }
}

it('one physical batch settles every original member only at actual native drain and preserves failure identity', async () => {
  /** The original held-first/failed-batch oracle now reaches the actual optional plugin owner. */
  const f = await fixture()
  expect(f.registry.facts('test').extensions).toEqual(['batch@1'])
  expect(f.registry.facts('test').required).toEqual(['batch@1'])
  expect(f.registry.facts('other').extensions).toEqual([])
  /** Real backpressure creates batching; no microtask scheduler forces idle requests to wait. */
  const firstDrain = deferred<void>()
  /** Every coalesced member must retain this second physical settlement. */
  const batchDrain = deferred<void>()
  /** Capture actual physical output with original final string contents. */
  const frames: IRpcCarrierFrame[] = []
  /** Physical handoff invokes the same options callback as Session's actual terminal. */
  const physical = { frames, firstDrain, batchDrain }
  /** The existing physical continuation alone owns actual native drain completion. */
  const write = async ({ frame, write: options }: IRpcFramePayload) => {
    options?.onWriteStart?.()
    physical.frames.push(frame)
    if (physical.frames.length === 1) await physical.firstDrain.promise
    else if (physical.frames.length === 2) await physical.batchDrain.promise
  }
  /** Idle sending reaches physical IO immediately. */
  const first = f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: { kind: 'message', data: 'first' }, ...f.context() }, write)
  expect(frames).toHaveLength(1)
  /** Independent completion remains pending until one actual shared native write settles. */
  const one = f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: { kind: 'message', data: 'one' }, ...f.context() }, write)
    .catch((error: unknown) => error)
  /** A second logical message keeps a distinct completion and final encoded value. */
  const two = f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: { kind: 'message', data: 'two' }, ...f.context() }, write)
    .catch((error: unknown) => error)
  /** Combined completion observes the original physical drain rather than buffer admission. */
  let idle = false
  /** Existing Promise composition measures completion without adding a queue API. */
  const drained = Promise.all([one, two]).then(() => {
    idle = true
  })
  firstDrain.resolve()
  await first
  expect(frames).toHaveLength(2)
  expect(frames[1]).toEqual({
    kind: 'extension',
    extension: 'batch@1',
    data: {
      frames: [
        { kind: 'message', data: 'one' },
        { kind: 'message', data: 'two' }
      ]
    }
  })
  expect(idle).toBe(false)
  /** Native classification belongs to the carrier; this owner preserves its exact returned failure. */
  const cause = new Error('fixture physical batch failure')
  batchDrain.reject(cause)
  for (const failure of await Promise.all([one, two])) expect(failure).toBe(cause)
  await drained
  expect(idle).toBe(true)
  await f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: { kind: 'message', data: 'recovered' }, ...f.context() }, write)
  expect(frames[2]).toEqual({ kind: 'message', data: 'recovered' })
  await f.installation.dispose?.()
  await f.flow.dispose()
})

it('queued cancellation removes only its member and transfer/opaque frames remain ordered singletons', async () => {
  /** Reuse the genuine source queue while retaining independent caller cancellation. */
  const f = await fixture()
  /** Original first write holds later messages in the existing Set queue. */
  const held = deferred<void>()
  /** Actual physical frames preserve original native backing identity at a boundary. */
  const frames: IRpcCarrierFrame[] = []
  /** Observe original per-member start callbacks and native transfer list identity. */
  const starts: string[] = []
  /** One backing and its exact array remain borrowed until the native boundary writes. */
  const transfer = [new ArrayBuffer(4)]
  /** The physical terminal records the actual selected write options. */
  const options: (IRpcFrameWriteOptions | undefined)[] = []
  /** This callback has only the fixture's explicit write state as its outer context. */
  const state = { frames, options, held }
  /** Start callbacks remain immediately adjacent to actual physical IO. */
  const write = async ({ frame, write: facts }: IRpcFramePayload) => {
    facts?.onWriteStart?.()
    state.frames.push(frame)
    state.options.push(facts)
    if (state.frames.length === 1) await state.held.promise
  }
  /** Idle physical send creates the only busy boundary. */
  const first = f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: { kind: 'message', data: 'first' }, ...f.context() }, write)
  /** A cancelled queued call must emit no frame and no started callback. */
  const caller = new AbortController()
  /** The public CallRecord owns CANCELLED; a cancelled member's stage completes normally. */
  const cancelled = f.pipelines.pipeline(RpcFlowPoint.frameOutbound, 'test').run(
    {
      frame: { kind: 'message', data: 'cancelled' },
      ...f.context({
        signal: caller.signal,
        onWriteStart: () => {
          starts.push('cancelled')
        }
      })
    },
    write
  )
  /** The original backing frame keeps its exact identity instead of joining a metadata aggregate. */
  const native: IRpcCarrierFrame = { kind: 'message', data: 'native', sidecars: transfer }
  /** Transfer is actual physical authority, never inferred from an encoded member. */
  const boundary = f.pipelines.pipeline(RpcFlowPoint.frameOutbound, 'test').run(
    {
      frame: native,
      ...f.context({
        transfer,
        onWriteStart: () => {
          starts.push('native')
        }
      })
    },
    write
  )
  /** Opaque custom codec values use their original singleton shape. */
  const opaque: IRpcCarrierFrame = { kind: 'message', data: { opaque: true } }
  /** Opaque output preserves order behind the native transfer boundary. */
  const last = f.pipelines.pipeline(RpcFlowPoint.frameOutbound, 'test').run(
    {
      frame: opaque,
      ...f.context({
        onWriteStart: () => {
          starts.push('opaque')
        }
      })
    },
    write
  )
  caller.abort(new Error('fixture queued abort'))
  held.resolve()
  await Promise.all([first, boundary, last])
  expect(await cancelled).toBeUndefined()
  expect(frames).toEqual([{ kind: 'message', data: 'first' }, native, opaque])
  expect(frames[1]).toBe(native)
  expect(options[1]?.transfer).toBe(transfer)
  expect(starts).toEqual(['native', 'opaque'])
  await f.installation.dispose?.()
  await f.flow.dispose()
})

it.each([1, 2])(
  'propagates the first physical member failure with %i failing members available',
  async (failures) => {
    /** Public independent-request settlement also runs through host/named-flow-composition.test.ts. */
    const f = await fixture()
    /** These final encoded values retain distinct original ids and group semantics unchanged. */
    const members: IRpcCarrierFrame[] = [
      { kind: 'message', data: '{"id":"one"}' },
      { kind: 'message', data: '{"id":"two"}' }
    ]
    /** The same physical batch delivers both exact codec inputs in order. */
    const values: IRpcCarrierFrame[] = []
    /** A physical continuation failure stays the original Session failure, without duplicate report. */
    const cause = new Error('fixture refusal write failure')
    await expect(
      f.pipelines.pipeline(RpcFlowPoint.frameInbound, 'test').run(
        {
          frame: { kind: 'extension', extension: 'batch@1', data: { frames: members } },
          ...f.context(undefined, 'inbound')
        },
        async ({ frame }) => {
          values.push(frame)
          if (values.length <= failures) throw cause
        }
      )
    ).rejects.toBe(cause)
    expect(values).toEqual([members[0]])
    expect(values[0]).toBe(members[0])
    expect(f.errors).toEqual([])
    await f.installation.dispose?.()
    await f.flow.dispose()
  }
)

it('physical retirement rejects queued members and joins the already started native branch', async () => {
  /** Actual carrier-close rejection is received by host/named-flow-composition.test.ts. */
  const f = await fixture()
  /** A real pending physical write must not prevent plugin cleanup from rejecting logical members. */
  const held = deferred<void>()
  /** Actual writes after retirement would expose a retained queued callback. */
  const frames: IRpcCarrierFrame[] = []
  /** Physical write remains outside plugin ownership and may settle after cancellation. */
  const write = async ({ frame, write: options }: IRpcFramePayload) => {
    options?.onWriteStart?.()
    frames.push(frame)
    await held.promise
  }
  /** Observe rejections before the original source aborts. */
  const first = f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: { kind: 'message', data: 'first' }, ...f.context() }, write)
    .catch((error: unknown) => error)
  /** Queued member retains no native write after source retirement. */
  const queued = f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: { kind: 'message', data: 'queued' }, ...f.context() }, write)
    .catch((error: unknown) => error)
  /** Both members keep the exact source reason, independent from a later native drain. */
  const reason = new Error('fixture physical close')
  f.source.abort(reason)
  /** This terminal has no carrier.close; native joins its started branch before settling. */
  held.resolve()
  expect(await first).toBe(reason)
  expect(await queued).toBe(reason)
  await f.installation.dispose?.()
  await f.installation.dispose?.()
  await Promise.resolve()
  expect(frames).toHaveLength(1)
  await f.flow.dispose()
})

it('cancellation during an async downstream hook falls back once without writing the cancelled member', async () => {
  /** This is the actual supported race between a frame transform and Session's physical handoff. */
  const f = await fixture()
  /** Original native backpressure lets two independent logical members become one prepared batch. */
  const firstDrain = deferred<void>()
  /** One genuine async suffix delays aggregate handoff while caller cancellation remains live. */
  const hookDrain = deferred<void>()
  /** The physical continuation exposes only frames that really cross the final handoff. */
  const state = { firstDrain, hookDrain, frames: [] as IRpcCarrierFrame[], aggregateAttempts: 0 }
  /** Only the aggregate yields before the exact start guard; singleton fallback is bounded. */
  const write = async ({ frame, write: options }: IRpcFramePayload) => {
    if (frame.kind === 'extension') {
      state.aggregateAttempts += 1
      await state.hookDrain.promise
    }
    options?.onWriteStart?.()
    state.frames.push(frame)
    if (state.frames.length === 1) await state.firstDrain.promise
  }
  /** Idle traffic still reaches the native continuation without buffering. */
  const first = f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: { kind: 'message', data: 'first' }, ...f.context() }, write)
  /** The caller remains cancellable until its actual original start callback. */
  const caller = new AbortController()
  /** Cancellation finishes the stage; the separate public case retains CANCELLED and its cause. */
  const cancelled = f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run(
      { frame: { kind: 'message', data: 'cancelled' }, ...f.context({ signal: caller.signal }) },
      write
    )
  /** This unrelated member must still cross the original physical continuation exactly once. */
  const survivor = f.pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: { kind: 'message', data: 'survivor' }, ...f.context() }, write)
  firstDrain.resolve()
  await first
  expect(state.aggregateAttempts).toBe(1)
  caller.abort(new Error('fixture async hook abort'))
  hookDrain.resolve()
  await survivor
  expect(await cancelled).toBeUndefined()
  expect(state.aggregateAttempts).toBe(1)
  expect(state.frames).toEqual([
    { kind: 'message', data: 'first' },
    { kind: 'message', data: 'survivor' }
  ])
  await f.installation.dispose?.()
  await f.flow.dispose()
})

it.each(['single', 'batch'] as const)(
  'retires a real accepted Session after malformed encoded input in a %s frame',
  async (mode) => {
    /** A genuine text codec makes batch members opaque encoded messages until Session admission. */
    const server = coreMemoryServer('malformed-batch', 'malformed-batch', 'memory', [], [], {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    })
    /** The real optional extension is negotiated by both public hosts. */
    const host = await createRpcHost({ ...server.options, plugins: [batch(), server.transport] })
    const client = await server.connect('malformed-source', { plugins: [batch()] })
    try {
      /** The existing native write port injects one malformed message without a fake Session. */
      const malformed = { kind: 'message', data: '{malformed-batch' } as const
      await client.pair[1].write(
        mode === 'single'
          ? malformed
          : { kind: 'extension', extension: 'batch@1', data: { frames: [malformed] } }
      )
      await vi.waitFor(() => expect(client.pair[0].closed).toBe(true))
      expect(client.pair[0].unsubscribed).toBe(1)
    } finally {
      await client.host.close()
      await host.close()
    }
  }
)
