import { installPage } from './page-common.mjs'
import { BrowserBenchText } from './text.mjs'

installPage('/worker-bare.js', async (createWorker, payload) => {
  /** The original raw Worker, codec and physical echo loop remain unchanged. */
  const worker = createWorker()
  /** Every bare postMessage resolves exactly once from its own physical echo. */
  let waiting
  worker.onmessage = (event) => {
    if (event.data === payload) waiting.resolve()
    else waiting.reject(new Error(BrowserBenchText.mismatch))
  }
  return () =>
    new Promise((resolve, reject) => {
      waiting = { resolve, reject }
      worker.postMessage(payload)
    })
})
