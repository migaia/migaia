import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createProcessPeer } from '../../../dist/process/index.js'
import { createMemoryTransportPair } from '../../../dist/core/adapters/memory.js'
import { messageFramerV1 } from '../../../dist/contract/framing/message-framer.js'

/** Ordinary managed Feature business runs before the actual no-env source admission check. */
const host = defineHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** The physical reference carrier owns its genuine subscription and cleanup. */
const transports = createMemoryTransportPair()
/** Safe counters distinguish native permission failure from source callback execution. */
let sourceCalls = 0
/** A fully constructed original Peer is the only successful preparation. */
let prepared = 0
/** Native error identity is safe to return without its environment-dependent message. */
let code
try {
  const [local] = await host.use(
    definePlugin({
      name: 'ordinary',
      features: { data: defineFeature(() => ({ read: () => 42 })) },
      install: () => ({})
    })
  )
  /** This actual original Feature dispatch must precede any candidate failure. */
  const ordinary = local.getFeature('data').read()
  try {
    const peer = await createProcessPeer({
      self: { name: 'explicit', instanceId: 'explicit-1' },
      connect: async () => {
        sourceCalls += 1
        return {
          transport: transports[0],
          peerId: 'legacy-target',
          scheduler: systemScheduler,
          agreement: { source: 'static', codec: identityCodecV1.id, capabilities: [] },
          pipeline: { codec: identityCodecV1, framer: messageFramerV1 },
          features: [],
          close: async () => undefined
        }
      },
      report: () => undefined
    })
    prepared += 1
    await peer.close()
  } catch (error) {
    code = error?.code ?? error?.name
  }
  console.log(JSON.stringify({ ordinary, prepared, sourceCalls, code }))
} finally {
  transports[0].close()
  await host.dispose()
}
