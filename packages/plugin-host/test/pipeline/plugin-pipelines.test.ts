/** A8 uses genuine definitions, Feature dependencies and the native owner transaction. */
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  defineFeature,
  defineHost,
  definePlugin,
  pipelineSpec,
  type IFeatureCore,
  type IPluginHostCoreFor,
  type IHostDomainCoreRequest
} from '../../src/index.js'

/** Host and plugin declarations carry distinct payloads and remain the only type authority. */
const hostPipelines = { request: pipelineSpec<{ count: number }>()({ mode: 'async' }) }
/** These genuine plugin declarations are reused by the Feature core without a supported-name list. */
const ownPipelines = { envelopeOutbound: pipelineSpec<{ text: string }>()({ mode: 'async' }) }
/** Unbounded native drain lets explicit business barriers control this fixture. */
const hostOptions = {
  execution: { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }
}

it('A8: plugin and Feature register host and own lanes; dependency-qualified lookup obeys the existing graph', async () => {
  /** Runtime observations prove independent payloads and actual execution order. */
  const events: string[] = []
  /** The Feature borrows exact real declarations, retaining registration-only authority. */
  const feature = defineFeature(
    (core: IFeatureCore<{}, typeof hostPipelines & typeof ownPipelines>) => {
      core.pipeline('request').use(async (value, next) => {
        events.push(`feature:request:${value.count}`)
        await next(value)
      })
      core.pipeline('envelopeOutbound').use(async (value, next) => {
        events.push(`feature:own:${value.text}`)
        await next(value)
      })
      return { ready: true }
    }
  )
  /** The committed definition carries the real qualified pipeline payload into its dependency. */
  const thread = definePlugin({
    name: 'thread',
    pipelines: ownPipelines,
    features: { feature },
    install(core) {
      core.pipeline('envelopeOutbound').use(async (value, next) => {
        events.push(`plugin:own:${value.text}`)
        await next({ text: `${value.text}/thread` })
      })
      return {}
    }
  })
  /** This Feature reference is the existing dependency declaration, not a pipeline permission list. */
  const dependentFeature = defineFeature(() => ({}), { provider: thread.getFeature('feature') })
  /** Known installed definitions let the Host owner's existing lookup infer qualified names. */
  const host = defineHost<{}, never, readonly [typeof thread], {}, typeof hostPipelines>({
    host: hostOptions,
    pipelines: hostPipelines
  })
  /** Host lookup uses its actual declared axes inside a native install. */
  type ICore = IPluginHostCoreFor<typeof host>
  try {
    await host.use(
      thread,
      definePlugin({
        name: 'consumer',
        features: { dependentFeature },
        install(core) {
          core.pipeline('thread.envelopeOutbound').use(async (value, next) => {
            events.push(`dependent:${value.text}`)
            await next(value)
          })
          return {}
        }
      }),
      definePlugin({
        name: 'host-stage',
        install(core: ICore) {
          core.pipeline('request').use(async (value, next) => {
            events.push(`plugin:request:${value.count}`)
            await next(value)
          })
          return {}
        }
      })
    )
    expect(
      await host.pipeline('thread.envelopeOutbound').run({ text: 'x' }, (value) => value.text)
    ).toBe('x/thread')
    expect(await host.pipeline('request').run({ count: 3 }, (value) => value.count)).toBe(3)
    expect(events).toEqual([
      'feature:own:x',
      'plugin:own:x',
      'dependent:x/thread',
      'feature:request:3',
      'plugin:request:3'
    ])
    await expect(
      host.use(
        definePlugin({
          name: 'outsider',
          install(core) {
            Reflect.apply(core.pipeline, undefined, ['thread.envelopeOutbound'])
            return {}
          }
        })
      )
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: 'PIPELINE_UNKNOWN',
        message: expect.stringMatching(/outsider.*host|thread.envelopeOutbound/)
      })
    })
  } finally {
    await host.dispose()
  }
})

it('A8: failed groups roll back and host declarations cannot be overridden', async () => {
  /** The native domain owner retains only genuine construction requests. */
  const requests: IHostDomainCoreRequest[] = []
  /** No forged scope reaches candidate pipelines. */
  const host = defineHost({
    host: hostOptions,
    pipelines: hostPipelines,
    domainCore(request) {
      requests.push(request)
      return {}
    }
  })
  try {
    await expect(
      host.use(definePlugin({ name: 'conflict', pipelines: hostPipelines, install: () => ({}) }))
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: 'INVALID_PIPELINE_OPTION' }) })
    await expect(
      host.use(
        definePlugin({
          name: 'failed',
          pipelines: ownPipelines,
          install(core) {
            core.pipeline('envelopeOutbound').use(async (value, next) => next(value))
            throw new Error('A8 original install failure')
          }
        })
      )
    ).rejects.toThrow()
    expect(() => host.pipeline('envelopeOutbound', requests.at(-1)!)).toThrowError(
      expect.objectContaining({ code: 'PIPELINE_UNKNOWN' })
    )
    expect(() =>
      host.pipeline('envelopeOutbound', { pluginName: 'failed', batch: {} })
    ).toThrowError(expect.objectContaining({ code: 'PIPELINE_UNKNOWN' }))
    /** No group resource is needed to revoke an empty definition's genuine construction scope. */
    await expect(
      host.use(
        definePlugin({
          name: 'empty-failed',
          install() {
            throw new Error('A8 empty original failure')
          }
        })
      )
    ).rejects.toThrow()
    expect(() => host.pipeline('request', requests.at(-1)!)).toThrowError(
      expect.objectContaining({ code: 'PIPELINE_UNKNOWN' })
    )
  } finally {
    await host.dispose()
  }
})

it('A8: native removal drains the real group before releasing its registered resources', async () => {
  /** The real target stage owns the in-flight execution until this explicit barrier opens. */
  const entered = deferred<void>()
  /** A shared gate avoids timeout-based synchronization. */
  const release = deferred<void>()
  /** Cleanup cannot run before the original owner execution finishes. */
  const cleanup = vi.fn()
  /** Construction scope also proves own stages execute before external publication. */
  let candidateRun: unknown
  /** The domain owner receives the original native construction scope. */
  const requests: IHostDomainCoreRequest[] = []
  /** No plugin core receives run authority; the Host owner performs candidate execution. */
  const host = defineHost({
    host: hostOptions,
    domainCore(request) {
      requests.push(request)
      return {}
    }
  })
  const plugin = definePlugin({
    name: 'drained',
    pipelines: ownPipelines,
    install(core) {
      core.pipeline('envelopeOutbound').use(async (value, next) => {
        if (value.text === 'held') {
          entered.resolve()
          await release.promise
        }
        await next(value)
      })
      core.onDispose(cleanup)
      expect(() =>
        Reflect.apply(host.pipeline, undefined, ['drained.envelopeOutbound'])
      ).toThrowError(expect.objectContaining({ code: 'PIPELINE_UNKNOWN' }))
      candidateRun = host
        .pipeline('envelopeOutbound', requests.at(-1)!)
        .run({ text: 'candidate' }, (value) => value)
      return {}
    }
  })
  try {
    await host.use(plugin)
    await expect(candidateRun).resolves.toEqual({ text: 'candidate' })
  } catch (error) {
    await host.dispose()
    throw error
  }
  /** Public qualified execution has no transaction request after publication. */
  const run = Reflect.apply(host.pipeline, undefined, ['drained.envelopeOutbound']).run(
    { text: 'held' },
    (value: unknown) => value
  )
  await entered.promise
  const removal = host.unUse('drained')
  expect(cleanup).not.toHaveBeenCalled()
  release.resolve()
  await run
  expect((await removal).ok).toBe(true)
  expect(cleanup).toHaveBeenCalledTimes(1)
  expect(() => Reflect.apply(host.pipeline, undefined, ['drained.envelopeOutbound'])).toThrowError(
    expect.objectContaining({ code: 'PIPELINE_UNKNOWN' })
  )
  await host.dispose()
})
