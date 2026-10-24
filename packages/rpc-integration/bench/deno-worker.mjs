import { snapshot } from './observe.mjs'
import { report, nativeProviderLimits } from './classification.mjs'
import { IpcBenchControl } from './text.mjs'

/** Loaded-byte hooks are installed before the actual SDK is dynamically loaded. */
const { createRpcHost } = await import('@migaia/rpc-host')
const { threadPlugin } = await import('@migaia/rpc-plugin-thread')
/** Attach the original automatic bootstrap capture before signalling cold construction readiness. */
const initialized = createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: { bench: { echo: (payload) => payload, snapshot } },
  providerLimits: nativeProviderLimits,
  report
})
globalThis.postMessage(IpcBenchControl.ready)
await initialized
