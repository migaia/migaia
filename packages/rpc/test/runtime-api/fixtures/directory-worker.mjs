import { createThreadPeer, readThreadBootstrap } from '../../../dist/threads/index.js'
import { workerData } from 'node:worker_threads'

/** The original launcher supplies a real replacement's business configuration in its bootstrap. */
const data = readThreadBootstrap(workerData).data
/** Each accepted generation installs these actual routes before exposing its directory. */
const methods =
  data.sequence === 1
    ? { removed: () => 1, changed: () => 2, stable: () => 3 }
    : {
        added: () => 4,
        changed: async function* () {
          yield 5
        },
        stable: () => 3
      }
/** Declared modes restrict the actual route set rather than reflect an erased TypeScript type. */
const declarations =
  data.sequence === 1
    ? {
        removed: { mode: 'request', idempotent: false },
        changed: { mode: 'request', idempotent: false },
        stable: { mode: 'request', idempotent: false }
      }
    : {
        added: { mode: 'request', idempotent: false },
        changed: { mode: 'async-generator', idempotent: false },
        stable: { mode: 'request', idempotent: false }
      }
await createThreadPeer({
  provide: { service: { data: methods } },
  contract: { schemaVersion: 1, plugin: 'service', features: { data: { methods: declarations } } },
  report: (error) => process.stderr.write(`${error?.code ?? 'fixture-error'}\n`)
})
