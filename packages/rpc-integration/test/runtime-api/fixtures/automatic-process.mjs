import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { PROCESS_RUNTIME_API_ENV } from '@migaia/rpc-process'
import * as processApi from '@migaia/rpc-process'
import { openProcessStdioChannel } from '@migaia/rpc-process/adapters/node-child-process'
import { createComposedEndpoint } from '@migaia/rpc-core/composed'
import { createCanonicalChunkFeature } from '@migaia/rpc-core/stream'
import { createOutboundFeature } from '@migaia/rpc-core/features/outbound'
import { createProviderFeature } from '@migaia/rpc-core/features/provider'
import { connect } from '@migaia/rpc-core'
import { codec } from '@migaia/rpc-core'
import { framer } from '@migaia/rpc-core'

/** A missing public factory selects the genuine old owner instead of creating an import RED. */
let initialized
if (typeof processApi.createProcessPeer === 'function') {
  initialized = processApi.createProcessPeer({
    provide: {
      /** A real nested launch inherits the current environment without a fixture marker override. */
      auditSource: async () => {
        const script = `import { createProcessPeer } from ${JSON.stringify(new URL('../../../../rpc-process/dist/process/index.js', import.meta.url).href)};
const before = process.stdin.listenerCount('data');
try { await createProcessPeer({report: () => undefined}); }
catch (error) { console.log(JSON.stringify({code: error.code, before, after: process.stdin.listenerCount('data')})); }`
        const grandchild = await new Promise((resolve) => {
          execFile(
            process.execPath,
            ['--input-type=module', '-e', script],
            { timeout: 2000 },
            (error, output) => {
              resolve(error ? { code: 'NATIVE_CHILD_TIMEOUT' } : JSON.parse(output))
            }
          )
        })
        return { consumed: process.env[PROCESS_RUNTIME_API_ENV] === undefined, grandchild }
      },
      /** The actual factory result owns identity; fixture metadata never fabricates one. */
      probe: async (value) => {
        const peer = await initialized
        return { value, self: peer.self, parent: await peer.request('parentEcho') }
      }
    },
    report: () => undefined
  })
} else {
  /** Primitive bootstrap and ordinary provider operation establish the existing behavior. */
  const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })
  const token = new TextDecoder().decode(opened.bootstrap)
  const channel = await processApi.createProcessTransport(opened.channel, {
    role: 'responder',
    peerId: 'automatic-process-parent',
    offer: processApi.createNativeProcessOffer({
      peer: { id: 'legacy-process-child', runtime: 'node' }
    }),
    auth: {
      mode: 'required',
      verify: (auth) => {
        assert.equal(auth, token)
      }
    },
    ipc: { connectionId: 'c3-child', sessionId: 'c3-child', log: () => undefined },
    report: () => undefined
  })
  const chunk = createCanonicalChunkFeature()
  const outbound = createOutboundFeature(chunk)
  initialized = createComposedEndpoint(
    {
      id: 'legacy-process-child',
      transport: channel.transport,
      features: channel.features,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        connect({ transport: channel.transport })
      ],
      provider: {
        probe: (context) =>
          context.success({ value: context.data, self: null, parent: 'legacy-unavailable' })
      }
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': createProviderFeature(outbound)
    }
  )
}
await initialized
