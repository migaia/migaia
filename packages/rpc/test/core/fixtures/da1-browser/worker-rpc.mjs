import { controlPort } from './worker-common.mjs'
import { endpointFor } from './rpc.mjs'
import { BrowserBenchText } from './text.mjs'

/** Initialization is out-of-band, while business traffic uses the actual canonical adapter. */
const control = await controlPort()
/** Existing onRejected callbacks retain semantic reasons; no new production diagnostic path. */
const classification = { failures: [], rejections: [] }
globalThis.__IPC_BROWSER_CLASSIFICATION = classification
/** Explicit 1200 entries are sampling capacity, never a product-default sustained claim. */
const endpoint = await endpointFor(globalThis, 'worker', 'page', classification)
endpoint.provide(BrowserBenchText.echo, (context) => context.success(context.data))
control.postMessage(BrowserBenchText.ready)
