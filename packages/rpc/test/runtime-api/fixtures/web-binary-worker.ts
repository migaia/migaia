import type { IRemoteChannel } from '../../../src/remote/types.js'
import { receiveThreadData, createWebThreadChannel } from '../../../dist/threads/index.js'
import { createRuntimePeer } from '../../../dist/remote/runtime-api/peer.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IThreadWebPort } from '../../../dist/threads/types.js'
import { webBinaryEndpoint } from './web-binary-endpoint.js'

/** The real Worker global is the EventTarget carrier, never a structural fake port. */
const port = globalThis as unknown as IThreadWebPort
/** The original bootstrap carries the launcher's actual identity before any application message. */
let initialized: ReturnType<typeof createRuntimePeer> | undefined
/** Business receipt records actual native provider inputs, not caller-side buffer metadata. */
let received = 0
/** Failures remain classified without printing signature, configuration or raw payload. */
const report = (error: unknown): void => {
  const failure = error as { source?: string; code?: string; name?: string }
  console.error(JSON.stringify({ source: failure.source, code: failure.code, name: failure.name }))
}
await receiveThreadData(port, async (value, peerId) => {
  /** This is the launcher-owned portable bootstrap, separate from business bytes. */
  const data = value as { parentId: string; capabilities: readonly string[] }
  /** ACK waits for actual canonical subscription, while directory exchange needs the parent ACK. */
  let subscribed!: () => void
  const active = new Promise<void>((resolve) => {
    subscribed = resolve
  })
  initialized = createRuntimePeer({
    self: { name: 'binary-web-child', instanceId: peerId },
    provide: {
      echo: (payload: unknown) => {
        received++
        return payload
      },
      count: () => received,
      values: async function* (payload: unknown) {
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
      const endpoint = await webBinaryEndpoint(channel as IRemoteChannel, peerId, report)
      subscribed()
      return endpoint
    },
    report
  })
  void initialized.catch(report)
  await active
})
await initialized
