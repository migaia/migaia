import { describe, expect, it } from 'vitest'
import { createAbortController, createPendingTracker } from '@migaia/lifecycle'
import { executePluginHostPipeline } from '../../src/pipeline-runtime.js'
import { PluginHostPipelineMode } from '../../src/state-constants.js'
import { StageLanes } from '../../src/stage-lanes.js'

/**
 * Every mode traverses a copy of its lane.
 *
 * A stage that adds another stage while the pipeline is running must not change the run it is
 * inside. Two of the four modes used to hand the live array to the runner and two copied it, so the
 * same program answered differently depending on the algebra it was configured with. These four
 * cases are the perturbation: each one appends to its own lane from inside the first stage and
 * asserts the appended stage did not execute in that run.
 */
const baseOptions = {
  value: 0,
  onViolation: () => undefined,
  assertActive: () => undefined,
  retainLease: () => () => undefined,
  enter: () => undefined,
  leave: () => undefined,
  pending: createPendingTracker(),
  liveSignal: createAbortController().signal as never
}

describe('pipeline lane snapshot', () => {
  it('reuses one frozen snapshot until a lane mutation commits', () => {
    const lanes = new StageLanes<number>()
    const first = lanes.snapshot(PluginHostPipelineMode.sync)
    const second = lanes.snapshot(PluginHostPipelineMode.sync)
    expect(first).toBe(second)
    expect(Object.isFrozen(first)).toBe(true)

    lanes.replace({
      syncStages: [(value, next) => next(value)],
      asyncStages: [],
      generatorStages: [],
      asyncGeneratorStages: []
    })
    const changed = lanes.snapshot(PluginHostPipelineMode.sync)
    expect(changed).not.toBe(first)
    expect(Object.isFrozen(changed)).toBe(true)
  })

  it('sync mode does not run a stage appended during the run', () => {
    const seen: string[] = []
    const lane: ((value: number, next: (value: number) => void) => void)[] = []
    lane.push((value, next) => {
      seen.push('first')
      lane.push(() => seen.push('appended'))
      next(value)
    })
    executePluginHostPipeline({
      ...baseOptions,
      mode: PluginHostPipelineMode.sync,
      syncStages: lane,
      asyncStages: [],
      generatorStages: [],
      asyncGeneratorStages: [],
      done: () => seen.push('done')
    } as never)
    expect(seen).toEqual(['first', 'done'])
    // The lane itself did change — the snapshot is what the run traversed, not a frozen lane.
    expect(lane).toHaveLength(2)
  })

  it('async mode does not run a stage appended during the run', async () => {
    const seen: string[] = []
    const lane: ((value: number, next: (value: number) => Promise<void>) => Promise<void>)[] = []
    lane.push(async (value, next) => {
      seen.push('first')
      lane.push(async () => {
        seen.push('appended')
      })
      await next(value)
    })
    await executePluginHostPipeline({
      ...baseOptions,
      mode: PluginHostPipelineMode.async,
      syncStages: [],
      asyncStages: lane,
      generatorStages: [],
      asyncGeneratorStages: [],
      done: () => seen.push('done')
    } as never)
    expect(seen).toEqual(['first', 'done'])
    expect(lane).toHaveLength(2)
  })

  it('generator mode does not run a stage appended during the run', () => {
    const seen: string[] = []
    const lane: ((value: number) => Generator<never, number>)[] = []
    lane.push(function* (value) {
      seen.push('first')
      lane.push(function* (next) {
        seen.push('appended')
        return next
      })
      return value
    })
    executePluginHostPipeline({
      ...baseOptions,
      mode: PluginHostPipelineMode.generator,
      syncStages: [],
      asyncStages: [],
      generatorStages: lane,
      asyncGeneratorStages: [],
      done: () => seen.push('done')
    } as never)
    expect(seen).toEqual(['first', 'done'])
    expect(lane).toHaveLength(2)
  })

  it('async-generator mode does not run a stage appended during the run', async () => {
    const seen: string[] = []
    const lane: ((value: number) => AsyncGenerator<never, number>)[] = []
    lane.push(async function* (value) {
      seen.push('first')
      lane.push(async function* (next) {
        seen.push('appended')
        return next
      })
      return value
    })
    await executePluginHostPipeline({
      ...baseOptions,
      mode: PluginHostPipelineMode.asyncGenerator,
      syncStages: [],
      asyncStages: [],
      generatorStages: [],
      asyncGeneratorStages: lane,
      done: () => seen.push('done')
    } as never)
    expect(seen).toEqual(['first', 'done'])
    expect(lane).toHaveLength(2)
  })
})
