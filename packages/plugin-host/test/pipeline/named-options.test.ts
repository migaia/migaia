/** Proves named construction admission and primary-first failure identity at public boundaries. */
import { describe, expect, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode
} from '@migaia/middleware-pipeline'
import {
  defineHost,
  pipelineSpec,
  PLUGIN_HOST_SOURCE,
  PluginHostErrorCode,
  type IPipelineDefinitions
} from '../../src/index.js'

/** Constructor failures must occur synchronously before an owner handle becomes available. */
function constructionFailure(pipelines: unknown): Error {
  /** A returned handle would contradict fail-closed construction. */
  let returned = false
  /** Captures the exact synchronous rejection for native-type and identity assertions. */
  let failure: unknown
  try {
    defineHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
      pipelines: pipelines as IPipelineDefinitions
    })
    returned = true
  } catch (error) {
    failure = error
  }
  expect(returned).toBe(false)
  expect(failure).toBeInstanceOf(Error)
  return failure as Error
}

/** The two failure scenarios use the public owner path with one async numeric payload. */
function createFailureHost(multiple = false) {
  return defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
    pipelines: {
      work: pipelineSpec<number>()({ mode: 'async', next: multiple ? 'multiple' : 'single' })
    }
  })
}

describe('named pipeline options and errors', () => {
  it('preserves a failing configuration getter as the original invalid-option cause', () => {
    /** A valid TypeScript getter may fail while the public factory snapshots configuration. */
    const original = new Error('configuration getter failed')
    /** The constructor must read the supplied property once instead of retrying its getter. */
    let reads = 0
    /** Captures one synchronous factory failure for identity assertions. */
    let failure: unknown
    try {
      pipelineSpec<number>()({
        get mode(): 'sync' {
          reads += 1
          throw original
        }
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidPipelineOption
    })
    expect((failure as Error).cause).toBe(original)
    expect(reads).toBe(1)
  })

  it.each([null, undefined])(
    'rejects non-record config %s in the declaration factory',
    (config) => {
      expect(() => pipelineSpec<number>()(config as never)).toThrowError(TypeError)
      try {
        pipelineSpec<number>()(config as never)
      } catch (error) {
        expect(error).toMatchObject({
          source: PLUGIN_HOST_SOURCE,
          code: PluginHostErrorCode.invalidPipelineOption
        })
      }
    }
  )

  it('rejects a non-record pipelines map synchronously without returning a handle', () => {
    /** These distinct malformed public inputs all fail the same construction boundary. */
    for (const pipelines of [null, [], 1, 'named', () => undefined]) {
      /** Each attempted construction must carry the native TypeError and Host identity. */
      const error = constructionFailure(pipelines)
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.invalidPipelineOption
      })
    }
  })

  it('rejects an empty name and structural copies of real descriptions', () => {
    /** Only pipelineSpec owns declaration authenticity; copying its shape cannot grant it. */
    const spec = pipelineSpec<number>()({ mode: 'sync' })
    /** Empty names and unauthenticated records are distinct invalid-declaration cases. */
    for (const pipelines of [{ '': spec }, { work: { mode: 'sync' } }, { work: { ...spec } }]) {
      /** All cases reject before a public Host handle can escape. */
      const error = constructionFailure(pipelines)
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.invalidPipelineOption
      })
    }
  })

  it('rejects an invalid order with the named-option code and preserves mode admission identity', () => {
    /** The factory keeps invalid untyped options for constructor-owned admission. */
    const orderError = constructionFailure({
      work: pipelineSpec<number>()({ order: 'sideways' as never })
    })
    expect(orderError).toBeInstanceOf(TypeError)
    expect(orderError).toMatchObject({
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidPipelineOption
    })
    /** Mode uses the existing default-pipeline code rather than inventing another failure. */
    const modeError = constructionFailure({
      work: pipelineSpec<number>()({ mode: 'invalid-mode' as never })
    })
    expect(modeError).toMatchObject({
      source: PLUGIN_HOST_SOURCE,
      code: PluginHostErrorCode.invalidPipelineMode
    })
  })

  it('rejects null and unknown next policies while retaining canonical middleware admission cause', () => {
    /** Explicit null is invalid, while only undefined selects the single default. */
    for (const next of [null, 'invalid-next']) {
      /** The Host reports the declaration failure while preserving the runner's original cause. */
      const error = constructionFailure({ work: pipelineSpec<number>()({ next: next as never }) })
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.invalidPipelineOption
      })
      /** Middleware remains the canonical owner of next-policy validation. */
      const cause = Reflect.get(error, 'cause')
      expect(cause).toBeInstanceOf(TypeError)
      expect(cause).toMatchObject({
        source: MIDDLEWARE_PIPELINE_SOURCE,
        code: MiddlewarePipelineErrorCode.invalidOption
      })
    }
  })

  it('preserves independent stage and downstream originals in a named PIPELINE_FAILED aggregate', async () => {
    /** Original stage failure must be first, independent of downstream settlement. */
    const stageError = new Error('named stage failure')
    /** Original terminal failure remains directly reachable as the second entry. */
    const downstreamError = new Error('named terminal failure')
    /** Public named execution uses the same Host error-combination policy as the default lane. */
    const host = createFailureHost()
    try {
      host.pipeline('work').use((_value, next) => {
        void next(1)
        throw stageError
      })
      /** Catch retains the exact aggregate for identity checks without a second execution. */
      const error = await host
        .pipeline('work')
        .run(0, () => {
          throw downstreamError
        })
        .catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(AggregateError)
      expect(error).toMatchObject({
        source: PLUGIN_HOST_SOURCE,
        code: PluginHostErrorCode.pipelineFailed
      })
      expect((error as AggregateError).errors).toHaveLength(2)
      expect((error as AggregateError).errors[0]).toBe(stageError)
      expect((error as AggregateError).errors[1]).toBe(downstreamError)
    } finally {
      await host.dispose()
    }
  })

  it('retains both already-started multiple failures in submission order with the middleware code', async () => {
    /** Submission one deliberately settles after submission two. */
    const first = new Error('first named branch')
    /** Original identity and start order must survive the reversed settlement order. */
    const second = new Error('second named branch')
    /** Existing deferred utility controls business settlement without a timer. */
    const gate = deferred<void>()
    /** Named multiple execution must wait for every branch under the original Host lease. */
    const host = createFailureHost(true)
    try {
      host.pipeline('work').use((_value, next) => {
        void next(1)
        void next(2)
      })
      /** Error observation starts before the delayed first branch is released. */
      const task = host
        .pipeline('work')
        .run(0, (value) => (value === 1 ? gate.promise : Promise.reject(second)))
      gate.reject(first)
      /** Complete semantic identities pass through without losing their canonical package owner. */
      const error = await task.catch((failure: unknown) => failure)
      expect(error).toBeInstanceOf(AggregateError)
      expect(error).toMatchObject({
        source: MIDDLEWARE_PIPELINE_SOURCE,
        code: MiddlewarePipelineErrorCode.multipleDownstreamFailed
      })
      expect((error as AggregateError).errors).toHaveLength(2)
      expect((error as AggregateError).errors[0]).toBe(first)
      expect((error as AggregateError).errors[1]).toBe(second)
    } finally {
      await host.dispose()
    }
  })
})
