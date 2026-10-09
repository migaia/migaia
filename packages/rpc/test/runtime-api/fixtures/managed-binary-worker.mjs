import { parentPort, workerData } from 'node:worker_threads'
import { createHmac } from 'node:crypto'
import { readThreadBootstrap } from '../../../dist/threads/index.js'
import { createRuntimePeer } from '../../../dist/remote/runtime-api/peer.js'
import { createRuntimeApiEndpoint } from '../../../dist/core/internal/runtime-api-endpoint.js'
import { createNodeThreadChannel } from '../../../dist/threads/channel.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { codec, framer, connect, abort, timeout, authentication } from '../../../dist/core/index.js'
import fixture from './managed-binary-key.json' with { type: 'json' }

/** Original launcher metadata provides the real native address and portable business configuration. */
const { peerId, data } = readThreadBootstrap(workerData)
/** Shared test-only material signs the actual original bound metadata rather than a fake auth layer. */
const signature = (value) =>
  createHmac('sha256', fixture.key).update(JSON.stringify(value)).digest('hex')
/** The true Worker uses the same canonical Peer and original authenticated endpoint composition. */
let prepared
prepared = createRuntimePeer({
  self: { name: 'managed-binary-child', instanceId: peerId },
  connect: async () =>
    createNodeThreadChannel(parentPort, data.parentId, {
      scheduler: systemScheduler,
      capabilities: data.capabilities
    }),
  endpointFactory: async (channel) => {
    const endpoint = createRuntimeApiEndpoint(
      {
        id: peerId,
        scheduler: channel.scheduler,
        transport: channel.transport,
        targetIds: [channel.peerId],
        middlewares: [
          codec(channel.pipeline.codec),
          framer(channel.pipeline.framer),
          connect({ transport: channel.transport }),
          abort(),
          timeout(),
          authentication({
            sign: (value) => ({ body: value, signature: signature(value) }),
            verify: (value) => {
              if (value.signature !== signature(value.body))
                throw new TypeError('managed binary fixture signature mismatch')
              return value.body
            }
          })
        ]
      },
      channel
    )
    await endpoint.ready
    return { endpoint, oneWay: endpoint, stream: endpoint.stream }
  },
  contract: {
    schemaVersion: 1,
    plugin: 'service',
    features: {
      data: {
        methods: {
          echo: { mode: 'request', idempotent: true },
          values: { mode: 'async-generator', idempotent: false },
          crash: { mode: 'request', idempotent: true }
        }
      }
    }
  },
  provide: {
    service: {
      data: {
        echo: (value) => value,
        /** The real managed stream restores and returns its native input through the original owner. */
        values: async function* (value) {
          yield value
        },
        crash: async (value) => {
          const peer = await prepared
          await peer.request('parent.started')
          if (data.sequence === 1) process.exit(7)
          return value
        }
      }
    }
  },
  report: (error) => process.stderr.write(`${error?.code ?? 'fixture-error'}\n`)
})
await prepared
