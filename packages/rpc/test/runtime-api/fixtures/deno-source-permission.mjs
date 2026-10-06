import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createProcessPeer } from '../../../dist/process/index.js'
import { createMemoryTransportPair } from '../../../dist/core/adapters/memory.js'
import { messageFramerV1 } from '../../../dist/contract/framing/message-framer.js'
import { RpcCapability } from '../../../dist/contract/wire-constants.js'
import { registerBatchAgreement } from '../../../dist/core/internal/batch-frame.js'

/** Ordinary managed Feature business runs before the actual no-env source admission check. */
const host = defineHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** The physical reference carrier owns its genuine subscription and cleanup. */
const transports = createMemoryTransportPair()
/** Static source agreement installs the canonical batch sender/receiver fact on both sides. */
const capabilities = [RpcCapability.runtimeApi, RpcCapability.batch]
for (const transport of transports) registerBatchAgreement(transport, capabilities)
/** Both source callbacks join before either actual endpoint starts its directory exchange. */
let connected = 0
/** The second source callback releases this one cold preparation barrier. */
let accept
/** This cold fixture barrier does not own business admission or lifecycle state. */
const agreed = new Promise((resolve) => {
  accept = resolve
})
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
    /** Both real endpoints publish the mandatory v2 directory without reading discovery env. */
    const peers = await Promise.all(
      transports.map((transport, index) =>
        createProcessPeer({
          self: { name: 'explicit', instanceId: `explicit-${index + 1}` },
          connect: async () => {
            if (index === 0) sourceCalls += 1
            connected += 1
            if (connected === 2) accept()
            await agreed
            return {
              transport,
              peerId: `explicit-${2 - index}`,
              scheduler: systemScheduler,
              agreement: {
                source: 'static',
                codec: identityCodecV1.id,
                capabilities
              },
              pipeline: { codec: identityCodecV1, framer: messageFramerV1 },
              features: [],
              close: async () => undefined
            }
          },
          report: () => undefined
        })
      )
    )
    prepared += 1
    await Promise.all(peers.map((peer) => peer.close()))
  } catch (error) {
    code = error?.code ?? error?.name
  }
  console.log(JSON.stringify({ ordinary, prepared, sourceCalls, code }))
} finally {
  transports[0].close()
  await host.dispose()
}
