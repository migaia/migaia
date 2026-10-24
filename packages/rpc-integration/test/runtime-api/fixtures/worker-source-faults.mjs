import { parentPort, workerData } from 'node:worker_threads'
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

/** Read genuine physical listener count without installing another source reader. */
const before = parentPort.listenerCount('message')
/** A conflicting callback must stay unreachable at configuration admission. */
let sourceCalls = 0
/** The fixture arg belongs to business data and grants no automatic-source authority. */
const conflict = workerData.data.mode === 'conflict'
/** Only safe classification reaches the independent actual Worker observer. */
let code
try {
  await createRpcHost({
    provide: {},
    report: () => undefined,
    plugins: [
      threadPlugin({
        connectToParent: true,
        ...(conflict
          ? {
              spawn: async () => {
                sourceCalls += 1
                return undefined
              }
            }
          : {})
      })
    ]
  })
} catch (error) {
  code = error?.code
}
parentPort.postMessage({ code, sourceCalls, before, after: parentPort.listenerCount('message') })
parentPort.close()
