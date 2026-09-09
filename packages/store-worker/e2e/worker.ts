import { createWorkerHandler } from '@migaia/store-worker'
import { isArrayBuffer } from '@migaia/utils/bytes'
import { StoreWorkerFixtureErrorText } from './fixture-error-text.js'

const handler = createWorkerHandler<unknown, number>(
  async (payload) => {
    if (payload === 'hang') {
      await new Promise<never>(() => undefined)
    }
    if (payload === 'fail') throw new Error(StoreWorkerFixtureErrorText.calculationFailed)
    if (isArrayBuffer(payload)) return payload.byteLength
    return (payload as number) * 2
  },
  (message) => self.postMessage(message)
)

self.onmessage = (event) => {
  void handler(event.data)
}
