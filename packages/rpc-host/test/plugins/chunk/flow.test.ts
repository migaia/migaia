import { expect, it } from 'vitest'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import type { IRpcFlowContext, IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { chunk } from '@migaia/rpc-host/plugins/chunk'
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

/** Actual accepted membership is explicit metadata; physical fragment data grants no authority. */
function context(signal: AbortSignal, extensions: ReadonlySet<string>): IRpcFlowContext {
  return {
    namespace: 'test',
    carrierId: 'source-a',
    direction: 'outbound',
    signal,
    report: () => undefined,
    session: {
      namespace: 'test',
      peerId: 'peer-a',
      name: 'peer-a',
      generation: { kind: 'session', value: 1, providerId: 'peer-a' },
      methods: new Map(),
      codec: 'json',
      extensions
    }
  }
}

it('actual native chunk flow preserves negotiated split/reassembly, physical drain and source retirement', async () => {
  /** Observe actual assembly timer ownership without implementing another reassembler. */
  const timers = new Map<number, () => void>()
  /** Tokens are fixture observations, independent of physical message ids. */
  let token = 0
  /** The public factory creates a genuine opaque native Feature handle. */
  const feature = chunk({
    required: true,
    chunkBytes: 2,
    maxMessageBytes: 8,
    maxConcurrentMessagesPerSource: 1,
    maxBufferedBytesPerSource: 8,
    schedule: (task) => {
      timers.set(++token, task)
      return token
    },
    cancel: (handle) => {
      timers.delete(handle as number)
    }
  })
  /** The actual native installation owns its original setup signal. */
  const setup = new AbortController()
  /** Existing report channel observes callback failures without changing delivery. */
  const errors: unknown[] = []
  /** Actual SDK preparation assigns this installation before the genuine use() completes. */
  let installation!: IRpcFlowInstallation<object>
  /** Actual native construction requests supply one execution port per installed group. */
  const owners = new Map<string, IRpcPipelineOwner>()
  /** Only prepared original groups contribute namespace facts to this fixture. */
  const groups = new Map<string, IRpcFlowGroup>()
  /** Canonical native Feature inspection owns the local setup and its dependency closure. */
  const program = new RpcTransportFlowProgram([feature])
  /** Both qualified groups retain native declarations and their exact original execution owners. */
  const rpc = rpcHostPipelines(
    () => flow,
    (name, request) => flow.pipeline(name, request)
  )
  /** The same native declarations own ordering, snapshots and both traversal directions. */
  const flow = defineHost({
    domainCore(request) {
      /** The genuine native request fixes this registration's execution authority. */
      const domain = rpc.domainCore(request)
      owners.set(request.pluginName, domain[rpcPipelineOwner])
      return domain
    },
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Production registration receives a genuine native generation rather than a runner facade. */
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
  /** A second public feature uses default source bytes with an explicitly larger legal message. */
  const largeProgram = new RpcTransportFlowProgram([
    chunk({ chunkBytes: 1024 * 1024, maxMessageBytes: 32 * 1024 * 1024 })
  ])
  await flow.use(
    definePlugin({
      name: 'large',
      pipelines: RpcFlowPipelines,
      features: largeProgram.features,
      async install(core) {
        groups.set(
          'large',
          await registry.prepareTransport(core, largeProgram, setup.signal, {
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
  /** The same genuine owner retains each point payload axis while lending native execution. */
  const pipelines = owners.get('test')!
  expect(registry.facts('test').extensions).toEqual(['chunk@1'])
  expect(registry.facts('test').required).toEqual(['chunk@1'])
  expect(registry.facts('other').extensions).toEqual([])
  /** The genuine native feature hooks split and reassemble exactly thirty-two MiB. */
  const largePipelines = owners.get('large')!
  /** The ordinary fixture facts are relabeled to this genuine feature group's namespace. */
  const largeSource = context(setup.signal, new Set(['chunk@1']))
  /** Both directions borrow the same accepted source without a second assembly fixture. */
  const largeContext = {
    ...largeSource,
    namespace: 'large',
    carrierId: 'large-source',
    session: { ...largeSource.session!, namespace: 'large' }
  }
  /** This payload exceeds the former sixteen-MiB source default while fitting maxMessageBytes. */
  const largeOriginal: IRpcCarrierFrame = { kind: 'message', data: 'x'.repeat(32 * 1024 * 1024) }
  /** Physical output is read from the real public feature's outbound pipeline. */
  const largeFrames: IRpcCarrierFrame[] = []
  await largePipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'large')
    .run({ frame: largeOriginal, context: largeContext }, async (payload) => {
      largeFrames.push(payload.frame)
    })
  expect(largeFrames).toHaveLength(32)
  /** The only delivered complete message comes from the original inbound assembly owner. */
  const largeDelivered: IRpcCarrierFrame[] = []
  for (const frame of largeFrames)
    await largePipelines
      .pipeline(RpcFlowPoint.frameInbound, 'large')
      .run({ frame, context: { ...largeContext, direction: 'inbound' } }, async (payload) => {
        largeDelivered.push(payload.frame)
      })
  expect(largeDelivered).toEqual([largeOriginal])
  /** One accepted source owns its actual retirement signal. */
  const source = new AbortController()
  /** Native drain is deliberately held independently from the plugin Promise. */
  const drain = deferred<void>()
  /** Real physical output is observed at the pipeline's existing continuation. */
  const frames: IRpcCarrierFrame[] = []
  /** Original encoded text matches the existing canonical assembly oracle. */
  const original: IRpcCarrierFrame = { kind: 'message', data: 'abcdefgh' }
  /** Returned completion must include all sequential writes, including the held first drain. */
  const pending = pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run(
      { frame: original, context: context(source.signal, new Set(['chunk@1'])) },
      async ({ frame }) => {
        frames.push(frame)
        if (frames.length === 1) await drain.promise
      }
    )
  expect(frames).toHaveLength(1)
  drain.resolve()
  await pending
  expect(frames).toHaveLength(4)
  expect(frames.every((frame) => frame.kind === 'extension' && frame.extension === 'chunk@1')).toBe(
    true
  )
  /** Actual inbound hooks reuse the same original length/order/single-copy owner. */
  const delivered: IRpcCarrierFrame[] = []
  for (const frame of frames)
    await pipelines.pipeline(RpcFlowPoint.frameInbound, 'test').run(
      {
        frame,
        context: { ...context(source.signal, new Set(['chunk@1'])), direction: 'inbound' }
      },
      async (payload) => {
        delivered.push(payload.frame)
      }
    )
  expect(delivered).toEqual([original])
  expect(timers.size).toBe(0)
  /** Optional absence keeps the original whole physical frame and identity. */
  const whole: IRpcCarrierFrame[] = []
  await pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run({ frame: original, context: context(source.signal, new Set()) }, async (payload) => {
      whole.push(payload.frame)
    })
  expect(whole[0]).toBe(original)
  /** A new real partial message retains one timer until its actual physical source retires. */
  const partial: IRpcCarrierFrame[] = []
  await pipelines
    .pipeline(RpcFlowPoint.frameOutbound, 'test')
    .run(
      { frame: original, context: context(source.signal, new Set(['chunk@1'])) },
      async (payload) => {
        partial.push(payload.frame)
      }
    )
  await pipelines.pipeline(RpcFlowPoint.frameInbound, 'test').run(
    {
      frame: partial[0]!,
      context: { ...context(source.signal, new Set(['chunk@1'])), direction: 'inbound' }
    },
    async () => undefined
  )
  expect(timers.size).toBe(1)
  /** A44 admits another physical source while this source's message and byte quotas remain held. */
  const quotaFrames = partial.map((frame) => {
    /** Changing only the opaque message id admits a separate valid physical message. */
    const data = frame.data as { messageId: string }
    return { ...frame, data: { ...data, messageId: `${data.messageId}:quota` } }
  })
  await expect(
    pipelines.pipeline(RpcFlowPoint.frameInbound, 'test').run(
      {
        frame: quotaFrames[0]!,
        context: { ...context(source.signal, new Set(['chunk@1'])), direction: 'inbound' }
      },
      async () => undefined
    )
  ).rejects.toMatchObject({ code: 'FRAME_LIMIT_EXCEEDED' })
  /** The second physical source completes the same valid fragment sequence while A stays pending. */
  const independent: IRpcCarrierFrame[] = []
  for (const frame of quotaFrames)
    await pipelines.pipeline(RpcFlowPoint.frameInbound, 'test').run(
      {
        frame,
        context: {
          ...context(source.signal, new Set(['chunk@1'])),
          direction: 'inbound',
          carrierId: 'source-b'
        }
      },
      async (payload) => {
        independent.push(payload.frame)
      }
    )
  expect(independent).toEqual([original])
  expect(timers.size).toBe(1)
  source.abort()
  expect(timers.size).toBe(0)
  await installation.dispose?.()
  await installation.dispose?.()
  await flow.dispose()
  expect(errors).toEqual([])
})
