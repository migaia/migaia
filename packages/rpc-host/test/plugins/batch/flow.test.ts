import { expect, it } from 'vitest'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import type {
  IRpcCarrierFrame,
  IRpcFramePayload,
  IRpcFrameWriteOptions
} from '@migaia/rpc-contract/interfaces'
import { batch } from '../../../dist/features/batch/index.js'
import { readRpcDefinition } from '../../../dist/sdk/metadata.js'
import { FlowRegistry } from '../../../dist/flow/registry.js'
import { RpcFlowPipelines, RpcFlowPoint } from '../../../dist/sdk/flow-pipelines.js'

/** The real native factory/setup is used by every owning physical-flow oracle. */
async function fixture() {
  /** Namespace declarations are tested through the same registration path as ordinary installation. */
  const plugin = batch({ namespaces: ['test'], required: true })
  /** Private native identity comes from the existing SDK owner, rather than invented config. */
  const metadata = readRpcDefinition(plugin)
  if (metadata?.kind !== 'flow') throw new TypeError('expected actual batch flow')
  /** Physical source lifetime stays separate from caller cancellation. */
  const source = new AbortController()
  /** Installation cleanup owns its original setup signal. */
  const setup = new AbortController()
  /** Failures from independent inbound members remain observable. */
  const errors: unknown[] = []
  /** Real setup returns the exact fixed hooks used by the ordinary host. */
  const installation = await metadata.definition.setup({
    signal: setup.signal,
    report: (error) => {
      errors.push(error)
    },
    retire: async () => undefined,
    call: async () => undefined
  })
  /** Native plugin-host owns the only snapshot, lease and multiple-submission execution path. */
  const flow = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
    pipelines: RpcFlowPipelines
  })
  /** Production registration attaches actual setup stages through a genuine install core. */
  const registry = new FlowRegistry((error) => {
    errors.push(error)
  })
  await flow.use(
    definePlugin({
      name: metadata.definition.name,
      install(core) {
        registry.register(core, metadata.definition, installation)
        return {}
      }
    })
  )
  registry.start()
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
  return { source, installation, flow, registry, errors, context }
}

it('one physical batch settles every original member only at actual native drain and preserves failure identity', async () => {
  /** The original held-first/failed-batch oracle now reaches the actual optional plugin owner. */
  const f = await fixture()
  expect(f.registry.extensions('test')).toEqual(['batch@1'])
  expect(f.registry.requiredExtensions('test')).toEqual(['batch@1'])
  expect(f.registry.extensions('other')).toEqual([])
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
  const first = f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
    .run({ frame: { kind: 'message', data: 'first' }, ...f.context() }, write)
  expect(frames).toHaveLength(1)
  /** Independent completion remains pending until one actual shared native write settles. */
  const one = f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
    .run({ frame: { kind: 'message', data: 'one' }, ...f.context() }, write)
    .catch((error: unknown) => error)
  /** A second logical message keeps a distinct completion and final encoded value. */
  const two = f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
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
  await f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
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
  const first = f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
    .run({ frame: { kind: 'message', data: 'first' }, ...f.context() }, write)
  /** A cancelled queued call must emit no frame and no started callback. */
  const caller = new AbortController()
  /** The public CallRecord owns CANCELLED; a cancelled member's stage completes normally. */
  const cancelled = f.flow.pipeline(RpcFlowPoint.frameOutbound).run(
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
  const boundary = f.flow.pipeline(RpcFlowPoint.frameOutbound).run(
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
  const last = f.flow.pipeline(RpcFlowPoint.frameOutbound).run(
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
  'reports %i independent inbound member failures and continues every member',
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
    /** Each original refusal is reported once without contaminating any sibling's traversal. */
    const cause = new Error('fixture refusal write failure')
    await expect(
      f.flow.pipeline(RpcFlowPoint.frameInbound).run(
        {
          frame: { kind: 'extension', extension: 'batch@1', data: { frames: members } },
          ...f.context(undefined, 'inbound')
        },
        async ({ frame }) => {
          values.push(frame)
          if (values.length <= failures) throw cause
        }
      )
    ).resolves.toBeUndefined()
    expect(values).toEqual(members)
    expect(values[0]).toBe(members[0])
    expect(f.errors).toEqual(failures === 1 ? [cause] : [cause, cause])
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
  const first = f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
    .run({ frame: { kind: 'message', data: 'first' }, ...f.context() }, write)
    .catch((error: unknown) => error)
  /** Queued member retains no native write after source retirement. */
  const queued = f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
    .run({ frame: { kind: 'message', data: 'queued' }, ...f.context() }, write)
    .catch((error: unknown) => error)
  /** Both members keep the exact source reason, independent from a later native drain. */
  const reason = new Error('fixture physical close')
  f.source.abort(reason)
  /** This terminal has no carrier.close; native R1 joins its started branch before settling. */
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
  const first = f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
    .run({ frame: { kind: 'message', data: 'first' }, ...f.context() }, write)
  /** The caller remains cancellable until its actual original start callback. */
  const caller = new AbortController()
  /** Cancellation finishes the stage; the separate public case retains CANCELLED and its cause. */
  const cancelled = f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
    .run(
      { frame: { kind: 'message', data: 'cancelled' }, ...f.context({ signal: caller.signal }) },
      write
    )
  /** This unrelated member must still cross the original physical continuation exactly once. */
  const survivor = f.flow
    .pipeline(RpcFlowPoint.frameOutbound)
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
