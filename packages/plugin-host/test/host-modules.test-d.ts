import { asyncPipelineModule } from '../src/modules/pipeline-modes/async.ts'
import { defineHost } from '../src/index.ts'
import { featuresModule } from '../src/modules/features/index.ts'
import { enablementModule } from '../src/modules/enablement/index.ts'
import { syncPipelineModule } from '../src/modules/pipeline-modes/sync.ts'
/** Core-only handles retain lifecycle operations while omitting unselected capabilities. */
const core = defineHost()
void core.use
void core.unUse
void core.dispose
// @ts-expect-error Enablement is absent until its module is selected.
void core.plugin
// @ts-expect-error Default pipelines are absent until a mode is selected.
void core.usePipeline
/** Exact literal module selection publishes the corresponding optional surface. */
const selected = defineHost({
  modules: [featuresModule, enablementModule, syncPipelineModule],
  host: { pipeline: { mode: 'sync' } }
})
void selected.plugin
void selected.usePipeline
// @ts-expect-error A selected sync module does not admit an async mode.
defineHost({ modules: [syncPipelineModule], host: { pipeline: { mode: 'async' } } })

// @ts-expect-error Core-only handles omit replacement authority.
void core.replace
// @ts-expect-error Core-only handles omit lazy activation authority.
void core.activate
// @ts-expect-error Core-only handles omit named pipeline authority.
void core.pipeline
// @ts-expect-error No selected mode means no default execution member.
void core.runPipeline

/** A valid numeric generator is a negative only because its mode is not installed. */
function* numericGenerator(value: number): Generator<number, number, unknown> {
  yield value
  return value
}
/** A valid async generator likewise cannot appear on an async-only owner. */
async function* numericAsyncGenerator(value: number): AsyncGenerator<number, number, unknown> {
  yield value
  return value
}
/** Explicit module/mode generic axes retain numeric async dispatch. */
const asyncOnly = defineHost<
  Record<string, never>,
  number,
  readonly [typeof asyncPipelineModule],
  'async'
>({ modules: [asyncPipelineModule], host: { pipeline: { mode: 'async' } } })
// @ts-expect-error An async-only owner has no generator registration member.
asyncOnly.useGeneratorPipeline(numericGenerator)
// @ts-expect-error An async-only owner has no async-generator registration member.
asyncOnly.useAsyncGeneratorPipeline(numericAsyncGenerator)
// @ts-expect-error Installing async alone does not admit sync as the selected mode.
defineHost({ modules: [asyncPipelineModule], host: { pipeline: { mode: 'sync' } } })

// BC6: explicit generics that stop before TModules/TMode keep the empty-module defaults,
// so a non-empty module list is rejected instead of silently dropping module members.
defineHost<Record<string, never>, number>({
  // @ts-expect-error The default module axis is readonly [], which cannot hold asyncPipelineModule.
  modules: [asyncPipelineModule]
})
/** Supplying the module and mode axes accepts the same selection. */
const explicitAxes = defineHost<
  Record<string, never>,
  number,
  readonly [typeof asyncPipelineModule],
  'async'
>({ modules: [asyncPipelineModule], host: { pipeline: { mode: 'async' } } })
void explicitAxes.usePipeline
