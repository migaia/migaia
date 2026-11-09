import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { measureBundle } from '../../../scripts/bundle-size.mts'
import { createPipeline, MiddlewarePipelineErrorCode } from '../src/index.ts'
import { syncMode } from '../src/modes/sync.ts'
import { asyncMode } from '../src/modes/async.ts'
import { generatorMode } from '../src/modes/generator.ts'
import { asyncGeneratorMode } from '../src/modes/async-generator.ts'

/** Fixed mode graph contract: adapters belong to the target runner, including its reused helpers. */
const cases = [
  { entry: 'main', runners: [], adapters: [] },
  { entry: 'sync', runners: ['sync'], adapters: [] },
  { entry: 'async', runners: ['async'], adapters: ['async'] },
  { entry: 'generator', runners: ['generator'], adapters: ['generator'] },
  {
    entry: 'async-generator',
    runners: ['async-generator'],
    adapters: ['async-generator', 'generator']
  }
] as const
/** Match actual source owners from the exact build metafile, never compressed contributions. */
function graphOwner(input: string, directory: string): string | undefined {
  /** Only source files under the requested execution owner participate in this assertion. */
  const prefix = 'packages/middleware-pipeline/src/' + directory + '/'
  return input.startsWith(prefix) ? input.slice(prefix.length, -3) : undefined
}
/** Each actual mode retains its original identity and promotion/rejection matrix. */
function modeAdmission(): void {
  expect(Object.isFrozen(syncMode)).toBe(true)
  expect(Object.keys(asyncMode)).toEqual(['key'])
  expect(() => createPipeline({ mode: 'async' } as never)).toThrowError(
    expect.objectContaining({
      source: 'middleware.pipeline',
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  )
  expect(() => createPipeline({ mode: Object.freeze({ key: 'async' }) } as never)).toThrowError(
    expect.objectContaining({
      source: 'middleware.pipeline',
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  )
  /** Original async stage must return by identity for same-mode lifting. */
  const stage = async (_value: number, _next: (value: number) => Promise<void>) => {}
  /** Genuine registered object uses the sole private mode registry. */
  const pipeline = createPipeline<number>({ mode: asyncMode })
  expect(pipeline.lift(stage, 'async')).toBe(stage)
  expect(() => pipeline.lift(generatorStage as never, 'generator' as never)).toThrowError(
    expect.objectContaining({
      source: 'middleware.pipeline',
      code: MiddlewarePipelineErrorCode.invalidOption,
      message: 'middleware pipeline stage cannot be lifted to the target mode'
    })
  )
  expect(createPipeline<number>({ mode: generatorMode }).lift(syncStage, 'sync')).toBeTypeOf(
    'function'
  )
  expect(
    createPipeline<number>({ mode: asyncGeneratorMode }).lift(generatorStage, 'generator')
  ).toBeTypeOf('function')
}
/** Original sync continuation semantics are the positive lift witness. */
function syncStage(value: number, next: (value: number) => void): void {
  next(value)
}
/** Original generator shape witnesses the one approved generator-to-async-generator promotion. */
function* generatorStage(value: number): Generator<number, undefined, void> {
  yield value
  return undefined
}
/** Register only the fixed five public source graph cases. */
function registerModeCases(): void {
  // Five entries and their at-most-two adapters are compile-time constants in cases above.
  for (const row of cases)
    it(`keeps ${row.entry} execution graph separate`, async () => {
      /** All assertions inspect the same source bundle's actual input graph. */
      const result = await measureBundle(
        fileURLToPath(new URL(`./fixtures/mode-${row.entry}.ts`, import.meta.url))
      )
      /** Constant-time membership preserves linear traversal of potentially growing input graphs. */
      const runners = new Set<string>(row.runners),
        adapters = new Set<string>(row.adapters)
      for (const input of result.inputs) {
        expect(input).not.toMatch(/middleware-pipeline\/src\/(?:runtime|execution-runtime)\.ts$/)
        /** Source owner extraction is independent of tree-shaken bytes in each file. */
        const runner = graphOwner(input, 'runners'),
          adapter = graphOwner(input, 'adapters'),
          mode = graphOwner(input, 'modes')
        if (runner !== undefined) expect(runners.has(runner), input).toBe(true)
        if (adapter !== undefined) expect(adapters.has(adapter), input).toBe(true)
        if (mode !== undefined) expect(mode, input).toBe(row.entry)
      }
      // Required runner list is fixed at zero or one by cases above.
      for (const runner of row.runners)
        expect(result.inputs).toContain(`packages/middleware-pipeline/src/runners/${runner}.ts`)
      expect(result.external.filter((name) => name.startsWith('@migaia/'))).toEqual([])
    })
  it('authenticates mode identities and preserves the lift matrix', modeAdmission)
}
describe('optional execution modes', registerModeCases)
