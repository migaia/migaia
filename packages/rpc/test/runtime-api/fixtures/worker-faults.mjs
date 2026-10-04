import { parentPort, workerData } from 'node:worker_threads'
import { ThreadBootstrap, ThreadEvent } from '../../../dist/threads/constants.js'

/** A genuine native child deliberately exercises the existing private startup failure paths. */
parentPort.on(ThreadEvent.message, () => {
  if (workerData.data.mode === 'bad-ack')
    parentPort.postMessage({
      kind: ThreadBootstrap.runtimeAcknowledged,
      version: -1,
      capabilities: []
    })
  if (workerData.data.mode === 'overflow') {
    parentPort.postMessage({ fixture: 'first-cold-frame' })
    parentPort.postMessage({ fixture: 'second-cold-frame' })
  }
  if (workerData.data.mode === 'exit') process.exit(0)
})
