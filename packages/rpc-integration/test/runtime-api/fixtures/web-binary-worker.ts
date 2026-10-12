import { readThreadBootstrap } from '@migaia/rpc-threads'
import { createEventTargetMessageResource } from '@migaia/rpc-core/adapter/internal-advanced'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IThreadWebPort } from '@migaia/rpc-threads'
import { webBinaryEndpoint } from './web-binary-endpoint.js'

/** The real Worker global supplies initial input and ACK through the canonical Core resource. */
const port = globalThis as unknown as IThreadWebPort
/** Capture before awaiting anything so the actual launcher bootstrap cannot be missed. */
const resource = createEventTargetMessageResource(port)
/** Core admits the original versioned launch message and keeps its received offer private. */
const raw = await resource.receiveInitial()
/** Fixture identity is read from actual bootstrap I/O, separate from business bytes. */
const parsed = rpcMessageCapabilityControl.readInitial(raw)
if (!parsed.valid) throw new TypeError(`Invalid binary fixture bootstrap: ${parsed.field}`)
/** Exact runtime identities are supplied by the actual original launch message. */
const { self, parent } = parsed.value.metadata
/** Custom authenticated assembly explicitly implements this independently declared profile. */
const data = readThreadBootstrap(raw).data as { capabilities: readonly string[] }
/** Business receipt records actual native provider inputs, not caller-side buffer metadata. */
let received = 0
/** Failures remain classified without printing signature, configuration or raw payload. */
const report = (error: unknown): void => {
  const failure = error as { source?: string; code?: string; name?: string }
  console.error(JSON.stringify({ source: failure.source, code: failure.code, name: failure.name }))
}
await createRuntimePeer({
  self,
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
    resource.open({
      peerId: parent.instanceId,
      scheduler: systemScheduler,
      offer: data.capabilities,
      control: rpcMessageCapabilityControl
    }),
  endpointFactory: (channel) => webBinaryEndpoint(channel, self.instanceId, report),
  report
})
