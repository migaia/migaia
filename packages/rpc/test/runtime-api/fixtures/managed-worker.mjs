import { createThreadPeer, readThreadBootstrap } from '../../../dist/threads/index.js'
import { workerData } from 'node:worker_threads'

/** The original launcher nests business data inside its validated bootstrap envelope. */
const data = readThreadBootstrap(workerData).data ?? {}
/** Native automatic bootstrap supplies this generation's actual identity and parent route. */
let prepared
prepared = createThreadPeer({
  ...(data.lifecycleMode
    ? {
        contract: {
          schemaVersion: 1,
          plugin: 'service',
          features: {
            data: {
              methods: {
                [data.lifecycleMode]: {
                  mode: data.lifecycleMode === 'tell' ? 'one-way' : 'async-generator',
                  idempotent: false
                }
              }
            }
          }
        }
      }
    : data.advanced
      ? {
          contract: {
            schemaVersion: 1,
            plugin: 'service',
            features: { data: { methods: { read: { mode: 'request', idempotent: true } } } }
          }
        }
      : {}),
  provide: {
    /** D40 observes the real Worker timer, never a parent-side synthetic deadline. */
    delay: async (duration) => {
      await new Promise((resolve) => setTimeout(resolve, duration))
      return 7
    },
    /** Real provider entry is acknowledged before a short operation holds native drain open. */
    drainGroup: async (value) => {
      const peer = await prepared
      await peer.request('parent.started')
      await new Promise((resolve) => setTimeout(resolve, 80))
      return value
    },
    /** The original stream consumer must enforce its launcher cap from lazy first-next. */
    delayedValues: async function* (duration) {
      await new Promise((resolve) => setTimeout(resolve, duration))
      yield 7
    },
    /** The caller has observed one item before a real native timer holds its next pull. */
    drainValues: async function* () {
      yield 'first'
      await new Promise((resolve) => setTimeout(resolve, 80))
      yield 'second'
      return 'terminal'
    },
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
        tell: async (value) => {
          const peer = await prepared
          await peer.request(value === 'hold' ? 'parent.started' : 'parent.fresh')
          if (value === 'hold') return new Promise(() => undefined)
        },
        async *values(value) {
          const peer = await prepared
          await peer.request(value === 'hold' ? 'parent.started' : 'parent.fresh')
          if (value === 'hold') await new Promise(() => undefined)
          yield value
        },
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
