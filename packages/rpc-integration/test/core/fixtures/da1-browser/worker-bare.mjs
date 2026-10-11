import { controlPort } from './worker-common.mjs'
import { BrowserBenchText } from './text.mjs'

/** Bare echo has no RPC import, envelope, validation, provider or lifecycle layer. */
const control = await controlPort()
globalThis.onmessage = (event) => globalThis.postMessage(event.data)
control.postMessage(BrowserBenchText.ready)
