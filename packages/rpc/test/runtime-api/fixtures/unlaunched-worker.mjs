import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { createThreadPeer } from '../../../dist/threads/index.js'

/** Ordinary local Feature execution succeeds inside the actual plain Worker. */
const host = defineHost({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** This original install completes independently of RPC source discovery. */
const [local] = await host.use(
  definePlugin({
    name: 'ordinary',
    features: { data: defineFeature(() => ({ read: () => 42 })) },
    install: () => ({})
  })
)
postMessage({ ordinary: local.getFeature('data').read() })
try {
  const peer = await createThreadPeer({ report: () => undefined })
  await peer.close()
  postMessage({ code: 'UNEXPECTED_PREPARATION' })
} catch (error) {
  postMessage({ code: error?.code ?? error?.name })
}
await host.dispose()
