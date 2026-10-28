/** Proves named payload/mode inference and the separation of owner and plugin authority. */
import {
  defineHost,
  pipelineSpec,
  type IPluginHostCoreFor,
  type IPipelineDefinitions
} from '../src/index.ts'

/** Host policy is orthogonal to the named payload axes. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
/** Different payloads and modes must be inferred from their own construction descriptions. */
const host = defineHost({
  host: { execution },
  pipelines: {
    count: pipelineSpec<{ count: number }>()({ mode: 'sync' }),
    text: pipelineSpec<{ text: string }>()({ mode: 'async', next: 'multiple', order: 'reverse' }),
    generated: pipelineSpec<number>()({ mode: 'generator' }),
    asyncGenerated: pipelineSpec<string>()({ mode: 'async-generator' }),
    defaultMode: pipelineSpec<boolean>()({})
  }
})

host.pipeline('count').use((value, next) => {
  /** This pipeline's payload retains its numeric field. */
  const count: number = value.count
  // @ts-expect-error a named payload does not widen to an unrelated field type.
  const wrong: string = value.count
  next({ count: count + 1 })
  void wrong
})
host.pipeline('text').use(async (value, next) => {
  /** The other pipeline independently infers its string payload. */
  const text: string = value.text
  // @ts-expect-error another pipeline's payload cannot be submitted here.
  await next({ count: 1 })
  await next({ text })
})
// @ts-expect-error async mode cannot accept the incompatible generator stage shape.
host.pipeline('text').use(function* (value) {
  return value
})
// @ts-expect-error only declared names are accepted.
host.pipeline('missing')

/** Synchronous terminals return synchronously, including possible halt. */
const syncResult: number | undefined = host
  .pipeline('count')
  .run({ count: 1 }, (value) => value.count)
/** Async terminals are awaited without nesting their Promise result. */
const asyncResult: Promise<number | undefined> = host
  .pipeline('text')
  .run({ text: 'x' }, async (value) => value.text.length)
/** Generator mode preserves a synchronous return surface. */
const generatedResult: number | undefined = host.pipeline('generated').run(1, (value) => value + 1)
/** Async-generator mode returns a Promise even when its terminal is synchronous. */
const asyncGeneratedResult: Promise<number | undefined> = host
  .pipeline('asyncGenerated')
  .run('x', (value) => value.length)
/** Omitted mode is inferred as sync instead of a mode union. */
const defaultResult: boolean | undefined = host.pipeline('defaultMode').run(true, (value) => value)

/** Plugin core derives its full named mapping from the host, without a parallel type table. */
declare const core: IPluginHostCoreFor<typeof host>
core.pipeline('count').use((value, next) => next({ count: value.count + 1 }))
core.pipeline('text').use(async (value, next) => {
  await next({ text: value.text })
})
// @ts-expect-error plugin registration authority never includes execution.
core.pipeline('count').run({ count: 1 }, (value: { count: number }) => value)
// @ts-expect-error plugin core rejects undeclared names too.
core.pipeline('missing')

/** Existing callers with explicit old generics retain their empty named mapping. */
const defaultOnly = defineHost<Record<string, never>, number>({ host: { execution } })
defaultOnly.usePipeline((value, next) => next(value + 1))
// @ts-expect-error no named declaration was supplied.
defaultOnly.pipeline('count')

/** Supplying old explicit generics does not silently invent a new inferred trailing axis. */
const explicitWithoutAxis = defineHost<Record<string, never>, number>({
  host: { execution },
  pipelines: { count: pipelineSpec<number>()({ mode: 'sync' }) }
})
// @ts-expect-error explicit generics require explicitly carrying the new pipeline axis too.
explicitWithoutAxis.pipeline('count')

/** Explicit generic callers can reuse the inferred description object as the final axis. */
const declarations = {
  count: pipelineSpec<number>()({ mode: 'sync' })
} satisfies IPipelineDefinitions
/** The fifth argument extends the previous four axes without changing their order. */
const explicitWithAxis = defineHost<
  Record<string, never>,
  number,
  readonly [],
  Record<never, never>,
  typeof declarations
>({
  host: { execution },
  pipelines: declarations
})
explicitWithAxis.pipeline('count').use((value, next) => next(value + 1))

void syncResult
void asyncResult
void generatedResult
void asyncGeneratedResult
void defaultResult
