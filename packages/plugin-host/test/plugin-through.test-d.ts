/** Keeps through payloads exact and preserves use as stage-only registration. */
import { defineHost, pipelineSpec, type IPluginHostCoreFor } from '../src/index.ts'

/** Genuine declarations provide both the current registration and target-name payload types. */
const host = defineHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } },
  pipelines: {
    y: pipelineSpec<{ count: number }>()({ mode: 'async' }),
    z: pipelineSpec<{ count: number }>()({ mode: 'async' }),
    different: pipelineSpec<{ text: string }>()({ mode: 'async' }),
    narrower: pipelineSpec<{ count: number; label: string }>()({ mode: 'async' }),
    multipleSource: pipelineSpec<{ count: number }>()({ mode: 'async', next: 'multiple' }),
    multipleTarget: pipelineSpec<{ count: number }>()({ mode: 'async', next: 'multiple' })
  }
})

/** Plugin registration sees the actual Host's same pipeline inventory without execution authority. */
declare const core: IPluginHostCoreFor<typeof host>

/** Through exposes only the original occurrence's idempotent removal receipt. */
const throughHandle: Readonly<{ remove(): void }> = core.pipeline('y').through('z')
core.pipeline('multipleSource').through('multipleTarget')
core.pipeline('multipleSource').through('z')
// @ts-expect-error through does not convert a numeric payload into a text payload.
core.pipeline('y').through('different')
// @ts-expect-error assignable but narrower payloads are not the same declared payload.
core.pipeline('y').through('narrower')
// @ts-expect-error the reverse assignability direction cannot implicitly discard a required field.
core.pipeline('narrower').through('y')
// @ts-expect-error target names retain the normal declared-pipeline lookup boundary.
core.pipeline('y').through('missing')

/** Ordinary use returns the same registration handle instead of accepting a pipeline as stage. */
const stageHandle: typeof throughHandle = core.pipeline('y').use(async (value, next) => {
  /** Ordinary stages still transform their own declared payload explicitly. */
  const count: number = value.count
  await next({ count: count + 1 })
})
throughHandle.remove()
stageHandle.remove()
// @ts-expect-error use installs a stage, never a target pipeline name.
core.pipeline('y').use('z')
// @ts-expect-error use installs a stage, never a plugin registration view.
core.pipeline('y').use(core.pipeline('z'))
// @ts-expect-error owner use also rejects a pipeline name.
host.pipeline('y').use('z')
// @ts-expect-error owner use also rejects an executable pipeline object.
host.pipeline('y').use(host.pipeline('z'))
// @ts-expect-error through does not grant execution authority to the plugin-facing handle.
core.pipeline('y').run({ count: 1 }, (value: { count: number }) => value.count)
// @ts-expect-error through belongs to scoped plugin registration rather than the owner run handle.
host.pipeline('y').through('z')
