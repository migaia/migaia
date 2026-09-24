import { describe, expect, it } from 'vitest'
import { createPendingTracker } from '@migaia/lifecycle'
import {
  createPipeline,
  MiddlewarePipelineMode,
  type IMiddlewarePipelineMode
} from '@migaia/middleware-pipeline'
import { executePluginHostPipeline } from '../../src/pipeline-runtime.js'
import { StageLanes } from '../../src/stage-lanes.js'

/** Runs one lifted sync stage while mutating the live lane it came from. */
const verifySnapshot = async (mode: IMiddlewarePipelineMode): Promise<void> => {
  const seen: string[] = []
  const runner = createPipeline<number, IMiddlewarePipelineMode>({ mode })
  const stages: Function[] = []
  stages.push(
    runner.lift((value, next) => {
      seen.push('first')
      stages.push(runner.lift(() => seen.push('appended'), MiddlewarePipelineMode.sync))
      next(value)
    }, MiddlewarePipelineMode.sync)
  )
  await executePluginHostPipeline({
    mode,
    stages,
    value: 0,
    done: () => seen.push('done'),
    runner,
    assertActive: () => undefined,
    retainLease: () => () => undefined,
    enter: () => undefined,
    leave: () => undefined,
    pending: createPendingTracker()
  } as never)
  expect(seen).toEqual(['first', 'done'])
  expect(stages).toHaveLength(2)
}

describe('pipeline lane snapshot', () => {
  it('reuses one frozen snapshot until the lane mutates', () => {
    const lanes = new StageLanes<number>()
    const first = lanes.snapshot()
    const second = lanes.snapshot()
    expect(first).toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    lanes.replace({
      stages: [(value: number, next: (value: number) => void) => next(value)] as never
    })
    const changed = lanes.snapshot()
    expect(changed).not.toBe(first)
    expect(Object.isFrozen(changed)).toBe(true)
  })

  it.each(Object.values(MiddlewarePipelineMode))(
    '%s mode does not run a stage appended during the run',
    async (mode) => verifySnapshot(mode)
  )
})
