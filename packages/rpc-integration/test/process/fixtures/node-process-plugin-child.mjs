import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

/** The real child serves the original scalar and two-yield generator through its native Host. */
const contract = {
  schemaVersion: 1,
  plugin: 'p',
  features: {
    f: {
      methods: {
        request: { mode: 'request', idempotent: false },
        generator: { mode: 'generator', idempotent: false }
      }
    }
  }
}
/** Native application installation precedes the single automatic parent transport. */
const host = new PluginHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
await host.use(
  definePlugin({
    name: 'p',
    features: {
      f: defineFeature(() => ({
        /**
         * Retain the original exact business value while replacement changes only the environment.
         *
         * @param {unknown} value Original portable request value.
         * @returns {string} Child label followed by the original payload.
         */
        request: (value) => `${process.env.RPC_VALUE ?? 'child'}:${value}`,
        /**
         * Yield the two original values through the actual process stream.
         *
         * @param {unknown} value Original portable stream payload.
         * @returns {Generator<string, void, unknown>} Original two-yield iterator.
         */
        generator: function* (value) {
          yield `${value}:1`
          yield `${value}:2`
        }
      }))
    },
    install: () => ({})
  })
)
await host.use(
  processPlugin({
    name: 'parent',
    expose: ['p'],
    contract,
    connectToParent: true,
    report: (error) => process.stderr.write(`${String(error)}\n`)
  })
)
