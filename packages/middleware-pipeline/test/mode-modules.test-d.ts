import { createPipeline } from '../src/index.ts'
import { asyncMode } from '../src/modes/async.ts'
import { asyncGeneratorMode } from '../src/modes/async-generator.ts'

// @ts-expect-error Construction requires a registered mode object, not a string key.
createPipeline({ mode: 'async' })
/** Literal mode inference retains its async execution and lift contracts. */
const asyncPipeline = createPipeline<number>({ mode: asyncMode })
/** Async result inference remains unchanged after replacing only the mode option. */
const result: Promise<void> = asyncPipeline.run([], 1, () => {})
void result
/** Only the original generator promotion is accepted by the async-generator target. */
const generatorPipeline = createPipeline<number>({ mode: asyncGeneratorMode })
generatorPipeline.lift(function* (value: number): Generator<number, undefined, void> {
  yield value
  return undefined
}, 'generator')
generatorPipeline.lift(
  // @ts-expect-error Async-to-async-generator promotion is not supported.
  async (value: number, next: (value: number) => Promise<void>) => next(value),
  'async'
)
