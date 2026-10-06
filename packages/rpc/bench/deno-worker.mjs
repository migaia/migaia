import { snapshot } from './observe.mjs'
import { report, nativeProviderLimits } from './classification.mjs'
import { IpcBenchControl } from './text.mjs'

/** Loaded-byte hooks are installed before the actual SDK is dynamically loaded. */
const { createThreadPeer } = await import('@migaia/rpc/threads')
/** Attach the original automatic bootstrap capture before signalling cold construction readiness. */
const initialized = createThreadPeer({
  provide: { bench: { echo: (payload) => payload, snapshot } },
  providerLimits: nativeProviderLimits,
  report
})
globalThis.postMessage(IpcBenchControl.ready)
await initialized
