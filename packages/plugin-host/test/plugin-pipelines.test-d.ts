/** A8 keeps own and dependency-qualified names tied to genuine declarations. */
import {
  defineFeature,
  defineHost,
  definePlugin,
  pipelineSpec,
  type IFeatureCore
} from '../src/index.js'
/** Genuine declarations provide the same runtime and compile-time payload. */
const pipelines = { outgoing: pipelineSpec<{ text: string }>()({ mode: 'async' }) }
/** The Feature core derives its names from that actual definition map. */
const feature = defineFeature((core: IFeatureCore<{}, typeof pipelines>) => {
  core.pipeline('outgoing').use(async (value, next) => {
    const text: string = value.text
    await next({ text })
  })
  // @ts-expect-error Feature registration has no execution authority.
  core.pipeline('outgoing').run({ text: 'x' }, () => undefined)
  return { ready: true }
})
/** Own short names infer through the public trusted plugin definition. */
const plugin = definePlugin({
  name: 'producer',
  pipelines,
  features: { feature },
  install(core) {
    core.pipeline('outgoing').use(async (value, next) => {
      const text: string = value.text
      // @ts-expect-error Actual outgoing payload has no numeric count.
      const wrong: number = value.count
      void wrong
      await next({ text })
    })
    // @ts-expect-error Undeclared names cannot widen through an arbitrary string index.
    core.pipeline('missing')
    return {}
  }
})
/** Existing Feature references derive the dependency's qualified pipeline names. */
const dependency = defineFeature(() => ({}), { provider: plugin.getFeature('feature') })
definePlugin({
  name: 'consumer',
  features: { dependency },
  install(core) {
    core.pipeline('producer.outgoing').use(async (value, next) => {
      const text: string = value.text
      await next({ text })
    })
    // @ts-expect-error Dependency pipelines are qualified, not consumer-owned short names.
    core.pipeline('outgoing')
    return {}
  }
})
/** Known installed definitions retain each qualified payload at the Host owner. */
const host = defineHost<{}, never, readonly [typeof plugin]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
host.pipeline('producer.outgoing').run({ text: 'x' }, (value) => value.text)
// @ts-expect-error Qualified payload inference still rejects another data domain.
host.pipeline('producer.outgoing').run({ count: 1 }, () => undefined)
// @ts-expect-error Noninstalled definitions cannot grant arbitrary qualified names.
host.pipeline('other.outgoing')
