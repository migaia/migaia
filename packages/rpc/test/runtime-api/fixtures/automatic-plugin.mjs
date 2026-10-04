import { parentPort } from 'node:worker_threads'
import { setTimeout as delay } from 'node:timers/promises'
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { createProcessPlugin } from '../../../dist/process/index.js'
import { createThreadPlugin } from '../../../dist/threads/index.js'

/** This genuine child uses the same managed Host and public Plugin factory as its caller. */
const host = defineHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** The actual native execution context selects the platform; no fixture bootstrap is fabricated. */
const kind = parentPort ? 'thread' : 'process'
/** Service business waits for its original connection installation before making a reverse call. */
let installed
await host.use(
  definePlugin({
    name: 'service',
    features: {
      data: defineFeature(() => ({
        probe: async (payload) => {
          await installed
          return [42, await host[kind].request('bridge', 'parent.read', payload)]
        },
        values: function* () {
          yield 1
          yield 2
        }
      }))
    },
    install: () => ({})
  })
)
/** No source or self configuration is supplied on this real automatic side. */
installed = host.use(
  (kind === 'thread' ? createThreadPlugin : createProcessPlugin)({
    name: 'bridge',
    expose: ['service'],
    report: (error) => process.stderr.write(`${error?.code ?? 'fixture-error'}\n`)
  })
)
await installed
// The parent's Peer directory may finish before this independent Host commits its receipt.
/** Both independent commits must finish; an early exact-registration rejection is expected. */
for (let attempt = 0; ; attempt += 1) {
  try {
    await host[kind].request('bridge', 'parent.ready')
    break
  } catch (error) {
    if (error?.cause?.code !== 'REGISTRATION_REVOKED' || attempt >= 99) throw error
    await delay(10)
  }
}
