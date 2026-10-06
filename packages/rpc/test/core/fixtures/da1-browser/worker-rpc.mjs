import { controlPort } from './worker-common.mjs'
import { peerOptions } from './rpc.mjs'
import { BrowserBenchText } from './text.mjs'
import { createThreadPeer } from '@migaia/rpc/threads'

/** Initialization is out-of-band, while business traffic uses the actual canonical adapter. */
const control = await controlPort()
/** Existing onRejected callbacks retain semantic reasons; no new production diagnostic path. */
const classification = { failures: [], rejections: [] }
globalThis.__IPC_BROWSER_CLASSIFICATION = classification
/** Explicit 1200 entries are sampling capacity, never a product-default sustained claim. */
await createThreadPeer({
  ...peerOptions(classification),
  provide: { bench: { echo: (payload) => payload } }
})
control.postMessage(BrowserBenchText.ready)
