import { createThreadPeer, readThreadBootstrap } from '../../../dist/threads/index.js'
import { workerData } from 'node:worker_threads'

/** The original launcher nests business data inside its validated bootstrap envelope. */
const data = readThreadBootstrap(workerData).data ?? {}
/** Native automatic bootstrap supplies this generation's actual identity and parent route. */
let prepared
prepared = createThreadPeer({
  ...(data.advanced
    ? {
        contract: {
          schemaVersion: 1,
          plugin: 'service',
          features: { data: { methods: { read: { mode: 'request', idempotent: true } } } }
        }
      }
    : {}),
  provide: {
    probe: async (value) => {
      const peer = await prepared
      return { value, self: peer.self, parent: await peer.request('parent.echo') }
    },
    hold: async () => {
      const peer = await prepared
      await peer.request('parent.started')
      return new Promise(() => undefined)
    },
    service: {
      data: {
        read: async (value) => {
          if (value === 'ordinary') {
            const peer = await prepared
            await peer.request('parent.echo')
          }
          if (data.crash && data.sequence === 1 && value === 'retry') {
            const peer = await prepared
            await peer.request('parent.started')
            process.exit(7)
          }
          return value
        }
      }
    }
  },
  report: (error) => process.stderr.write(`${error?.code ?? 'fixture-error'}\n`)
})
await prepared
