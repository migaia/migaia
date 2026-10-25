import { expect, it } from 'vitest'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import type { IRpcFlowContext, IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { chunk } from '../../../dist/features/chunk/index.js'
import { readRpcDefinition, RpcDefinitionKind } from '../../../dist/sdk/metadata.js'
import { FlowRegistry } from '../../../dist/flow/registry.js'
import {
  rpcHostPipelines,
  rpcPipelineOwner,
  RpcFlowPoint
} from '../../../dist/sdk/flow-pipelines.js'
import { RpcFlowSetup } from '../../../dist/sdk/flow-setup.js'
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
    schedule: (task) => {
      timers.set(++token, task)
      return token
    },
    cancel: (handle) => {
      timers.delete(handle as number)
    }
  })
  /** The original factory supplies exact private builtin identity, not a name-based placement. */
  const metadata = readRpcDefinition(feature)
  if (metadata?.kind !== RpcDefinitionKind.feature)
    throw new TypeError('expected actual native feature')
  /** Installation lifetime stays separate from the actual accepted source signal. */
  const setup = new AbortController()
  /** Existing report channel observes callback failures without changing delivery. */
  const errors: unknown[] = []
  /** Actual SDK preparation assigns this installation before the genuine use() completes. */
  let installation!: IRpcFlowInstallation<object>
  /** Both qualified groups retain native declarations and their exact original execution owners. */
  const rpc = rpcHostPipelines(
    () => flow,
    (name) => flow.pipeline(name),
    ['test', 'other']
  )
  /** The same native declarations own ordering, snapshots and both traversal directions. */
  const flow = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Production registration receives a genuine native generation rather than a runner facade. */
  const registry = new FlowRegistry((error) => {
    errors.push(error)
  })
  await flow.use(
    definePlugin({
      name: metadata.definition.name,
      features: { flow: feature },
      async install(core) {
        /** Native Feature construction returns this original cold definition. */
        const definition = core.features.flow
        /** SDK setup retains the real native cleanup owner and original timer callbacks. */
        installation = await new RpcFlowSetup(definition).prepare(core, setup.signal, {
          signal: setup.signal,
          report: (error) => {
            errors.push(error)
          },
          retire: async () => undefined,
          call: async () => undefined
        })
        /** The test group's exact installation leaves the separately declared other lane empty. */
        const groups = new Map([
          ['test', [{ definition, installed: installation, builtin: metadata.builtin }]],
          ['other', []]
        ])
        registry.registerFeatures(core, groups)
        return {}
      }
    })
  )
  registry.start()
  /** The same genuine owner retains each point payload axis while lending native execution. */
  const pipelines = rpc.domainCore()[rpcPipelineOwner]
  expect(registry.facts('test').extensions).toEqual(['chunk@1'])
  expect(registry.facts('test').required).toEqual(['chunk@1'])
  expect(registry.facts('other').extensions).toEqual([])
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
  source.abort()
  expect(timers.size).toBe(0)
  await installation.dispose?.()
  await installation.dispose?.()
  await flow.dispose()
  expect(errors).toEqual([])
})
