import { describe, expect, it } from 'vitest'
import {
  GENERATOR_CONTINUE,
  MiddlewarePipelineMode,
  type IMiddlewarePipelineContext,
  type IMiddlewarePipelineMode
} from '@migaia/middleware-pipeline'
import { PluginHost } from '../../src/index.js'

/** A15 (BC5): every host mode hands stages the lifecycle abort signal that disposal aborts. */
class SignalHost extends PluginHost<Record<string, never>, number> {
  constructor(mode: IMiddlewarePipelineMode) {
    super({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      pipeline: { mode }
    })
  }

  run(value: number): void | Promise<void> {
    return this.runPipeline(value, () => undefined)
  }
}

/** Registers one native stage of the host's own mode that records the context it received. */
const registerRecorder = (
  host: SignalHost,
  mode: IMiddlewarePipelineMode,
  seen: Array<IMiddlewarePipelineContext | undefined>
): void => {
  if (mode === MiddlewarePipelineMode.sync)
    host.usePipeline((value, next, context) => {
      seen.push(context)
      next(value)
    })
  else if (mode === MiddlewarePipelineMode.async)
    host.useAsyncPipeline(async (value, next, context) => {
      seen.push(context)
      await next(value)
    })
  else if (mode === MiddlewarePipelineMode.generator)
    host.useGeneratorPipeline(function* (value, context) {
      seen.push(context)
      yield value
      return GENERATOR_CONTINUE
    })
  else
    host.useAsyncGeneratorPipeline(async function* (value, context) {
      seen.push(context)
      yield value
      return GENERATOR_CONTINUE
    })
}

describe('lifecycle abort signal in every host mode', () => {
  it.each(Object.values(MiddlewarePipelineMode))(
    'BC5: %s stages observe the host lifecycle signal aborting on dispose',
    async (mode) => {
      const host = new SignalHost(mode)
      const seen: Array<IMiddlewarePipelineContext | undefined> = []
      registerRecorder(host, mode, seen)
      await host.run(1)
      expect(seen).toHaveLength(1)
      const signal = seen[0]?.signal
      expect(signal).toBeDefined()
      expect(signal!.aborted).toBe(false)
      await host.dispose()
      expect(signal!.aborted).toBe(true)
    }
  )
})
