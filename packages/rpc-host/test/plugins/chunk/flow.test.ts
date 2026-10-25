import { expect, it } from 'vitest'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import type { IRpcFlowContext, IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { chunk } from '../../../dist/plugins/chunk/index.js'
import { readRpcDefinition } from '../../../dist/sdk/metadata.js'
import { FlowRegistry } from '../../../dist/flow/registry.js'
import { RpcFlowPipelines, RpcFlowPoint } from '../../../dist/sdk/flow-pipelines.js'

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
  /** The public factory creates a genuine SDK native plugin identity. */
  const plugin = chunk({
    namespaces: ['test'],
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
  /** Read the actual registered native definition rather than constructing fake contribution config. */
  const metadata = readRpcDefinition(plugin)
  if (metadata?.kind !== 'flow') throw new TypeError('expected actual native flow definition')
  /** Installation lifetime stays separate from the actual accepted source signal. */
  const setup = new AbortController()
  /** Existing report channel observes callback failures without changing delivery. */
  const errors: unknown[] = []
  /** The same native setup returns the hooks registered by ordinary host installation. */
  const installation = await metadata.definition.setup({
    signal: setup.signal,
    report: (error) => {
      errors.push(error)
    },
    retire: async () => undefined,
    call: async () => undefined
  })
  /** The same native declarations own ordering, snapshots and both traversal directions. */
  const flow = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
    pipelines: RpcFlowPipelines
  })
  /** Production registration receives a genuine native generation rather than a runner facade. */
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
  expect(registry.extensions('test')).toEqual(['chunk@1'])
  expect(registry.requiredExtensions('test')).toEqual(['chunk@1'])
  expect(registry.extensions('other')).toEqual([])
  /** One accepted source owns its actual retirement signal. */
  const source = new AbortController()
  /** Native drain is deliberately held independently from the plugin Promise. */
  const drain = deferred<void>()
  /** Real physical output is observed at the pipeline's existing continuation. */
  const frames: IRpcCarrierFrame[] = []
  /** Original encoded text matches the existing canonical assembly oracle. */
  const original: IRpcCarrierFrame = { kind: 'message', data: 'abcdefgh' }
  /** Returned completion must include all sequential writes, including the held first drain. */
  const pending = flow
    .pipeline(RpcFlowPoint.frameOutbound)
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
    await flow
      .pipeline(RpcFlowPoint.frameInbound)
      .run(
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
  await flow
    .pipeline(RpcFlowPoint.frameOutbound)
    .run({ frame: original, context: context(source.signal, new Set()) }, async (payload) => {
      whole.push(payload.frame)
    })
  expect(whole[0]).toBe(original)
  /** A new real partial message retains one timer until its actual physical source retires. */
  const partial: IRpcCarrierFrame[] = []
  await flow
    .pipeline(RpcFlowPoint.frameOutbound)
    .run(
      { frame: original, context: context(source.signal, new Set(['chunk@1'])) },
      async (payload) => {
        partial.push(payload.frame)
      }
    )
  await flow
    .pipeline(RpcFlowPoint.frameInbound)
    .run(
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
