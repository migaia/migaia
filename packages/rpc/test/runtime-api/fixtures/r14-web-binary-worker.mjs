/**
 * Fixture emit of maintained fixtures/web-binary-worker.ts for runtimes requiring concrete .js/.mjs
 * specifiers; production is unchanged.
 */
import { receiveThreadData, createWebThreadChannel } from '../../../dist/threads/index.js'
import { createRuntimePeer } from '../../../dist/remote/runtime-api/peer.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { webBinaryEndpoint } from './r14-web-binary-endpoint.mjs'
/** The real Worker global is the EventTarget carrier, never a structural fake port. */
const port = globalThis
/** The original bootstrap carries the launcher's actual identity before any application message. */
let initialized
/** Business receipt records actual native provider inputs, not caller-side buffer metadata. */
let received = 0
/** Failures remain classified without printing signature, configuration or raw payload. */
const report = (error) => {
  const failure = error
  console.error(JSON.stringify({ source: failure.source, code: failure.code, name: failure.name }))
}
await receiveThreadData(port, async (value, peerId) => {
  /** This is the launcher-owned portable bootstrap, separate from business bytes. */
  const data = value
  /** ACK waits for actual canonical subscription, while directory exchange needs the parent ACK. */
  let subscribed
  const active = new Promise((resolve) => {
    subscribed = resolve
  })
  initialized = createRuntimePeer({
    self: { name: 'binary-web-child', instanceId: peerId },
    provide: {
      echo: (payload) => {
        received++
        return payload
      },
      count: () => received,
      values: async function* (payload) {
        received++
        yield payload
      }
    },
    connect: async () =>
      createWebThreadChannel(port, data.parentId, {
        scheduler: systemScheduler,
        capabilities: data.capabilities
      }),
    endpointFactory: async (channel) => {
      const endpoint = await webBinaryEndpoint(channel, peerId, report)
      subscribed()
      return endpoint
    },
    report
  })
  void initialized.catch(report)
  await active
})
await initialized
