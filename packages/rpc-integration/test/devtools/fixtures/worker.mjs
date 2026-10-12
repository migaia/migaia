import { isMainThread, threadId, workerData } from 'node:worker_threads'
import { createThreadPeer, readThreadBootstrap } from '@migaia/rpc-threads'
import { createRpcDevtools } from '@migaia/rpc-devtools'
import { fixtureAuthentication, reportFailure } from './auth.mjs'
import { FixtureMethod } from './text.mjs'

/** Ordinary portable fixture configuration is read from the public launcher bootstrap. */
const { data } = readThreadBootstrap(workerData)
/** Each observed real host constructs its own actual collector, without fabricating events. */
const collector = data?.observed ? createRpcDevtools({ onError: reportFailure }) : undefined

/** The normal automatic Worker Peer remains the business owner; native trace is deliberately absent. */
await createThreadPeer({
  authentication: fixtureAuthentication(),
  probe: collector,
  provide: {
    /**
     * Real Worker execution supplies both the business result and native host identity.
     *
     * @param {number} value Business payload passed through the real child Peer.
     * @returns {{
     *   value: number
     *   pid: number
     *   threadId: number
     *   isMainThread: boolean
     *   collectorInstalled: boolean
     * }}
     *   Actual Worker result and native execution identity.
     */
    [FixtureMethod.increment](value) {
      return {
        value: value + 1,
        pid: process.pid,
        threadId,
        isMainThread,
        collectorInstalled: collector !== undefined
      }
    },
    /**
     * Remote control closes the actual observer while retaining the same business Peer.
     *
     * @returns {boolean} Completion of this host's synchronous collector close.
     */
    [FixtureMethod.closeCollector]() {
      collector?.close()
      return true
    }
  },
  report: reportFailure
})
