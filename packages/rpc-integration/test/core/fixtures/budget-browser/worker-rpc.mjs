import { controlPort } from './worker-common.mjs'
import { peerOptions } from './rpc.mjs'
import { BrowserBenchText } from './text.mjs'
import { createRpcHost } from '@migaia/rpc-host'
import {
  defineTransportPlugin,
  createAdapterDeployment,
  holdAdapterMessageBootstrapSource,
  createAdapterSourceConfigurationError
} from '@migaia/rpc-host/plugin'
import { threadChildResource } from '../../../../../rpc-plugin-thread/dist/threads/child.js'

/** Initialization is out-of-band, while business traffic uses the actual canonical adapter. */
const control = await controlPort()
/** Existing onRejected callbacks retain semantic reasons; no new production diagnostic path. */
const classification = { failures: [], rejections: [] }
globalThis.__IPC_BROWSER_CLASSIFICATION = classification
/** Explicit 1200 entries are sampling capacity, never a product-default sustained claim. */
/** The real native global provides the first bootstrap frame and its buffered message lifetime. */
const options = peerOptions(classification)
/** One cold author transport lends its actual child resource to the sole Host endpoint. */
const deployment = createAdapterDeployment({
  runtimeOptions: { probe: globalThis.__PROBE_BENCH_PROBE },
  open: async () => {
    throw createAdapterSourceConfigurationError()
  },
  bootstrap: (context) =>
    holdAdapterMessageBootstrapSource(threadChildResource(globalThis), {
      connectTimeoutMs: context.connectTimeoutMs,
      report: context.report
    })
})
/** Identity and ACK come from the actual parent bootstrap before this Host publishes its provider. */
await createRpcHost({
  ...options,
  plugins: [defineTransportPlugin({ name: 'page', mode: 'connect-to-parent', deployment })],
  provide: { bench: { echo: (payload) => payload } }
})

control.postMessage(BrowserBenchText.ready)
