import { installPage } from './page-common.mjs'
import { endpointFor } from './rpc.mjs'
import { BrowserBenchText } from './text.mjs'

installPage('/worker-rpc.js', async (worker, payload, classification) => {
  /** Both sides jointly deploy the canonical default static batch capability. */
  const endpoint = await endpointFor(worker, 'page', 'worker', classification)
  return async () => {
    if ((await endpoint.send('worker', BrowserBenchText.echo, payload)) !== payload)
      throw new Error(BrowserBenchText.mismatch)
  }
})
