import { createPipeline, GENERATOR_UNDEFINED, type ICreatePipelineOptions } from '../src/index.js'
// @ts-expect-error Internal mode predicate is not a public type contract.
import type { IMiddlewarePipelineSyncMode } from '../src/index.js'

/** Keep the forbidden import check live without publishing a compatibility alias. */
const hidden = undefined as unknown as IMiddlewarePipelineSyncMode
void hidden

/** Custom sentinels are control values; the payload remains strictly numeric. */
const signals = { undefined: Symbol('u'), halt: Symbol('h'), continue: Symbol('c') }
const generator = createPipeline<number>({ mode: 'generator', signals })
generator.run(
  [
    function* () {
      return signals.halt
    }
  ],
  1,
  (value) => {
    value.toFixed()
  }
)
const asyncGenerator = createPipeline<number>({ mode: 'async-generator', signals })
void asyncGenerator.run(
  [
    async function* () {
      return signals.continue
    }
  ],
  1,
  (value) => {
    value.toFixed()
  }
)

/** Default sentinels keep the existing guard against undefined payload in a numeric pipeline. */
const defaults = createPipeline<number>({ mode: 'generator' })
defaults.run(
  [
    // @ts-expect-error An explicit undefined terminal requires undefined in the payload type.
    function* () {
      return GENERATOR_UNDEFINED
    }
  ],
  1,
  () => undefined
)

/**
 * Annotated supported options must retain custom control support even when signals is optional in
 * the annotation.
 */
const typedOptions: ICreatePipelineOptions<'generator'> = { mode: 'generator', signals }
const typedGenerator = createPipeline<number>(typedOptions)
typedGenerator.run(
  [
    function* () {
      return signals.halt
    }
  ],
  1,
  (value) => {
    value.toFixed()
  }
)
