import assert from 'node:assert/strict'
import { isMainThread, threadId, workerData } from 'node:worker_threads'
import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { readThreadBootstrap } from '../../../../rpc-plugin-thread/dist/threads/bootstrap.js'
import { fixtureAuthentication } from './auth.mjs'
import { createFixtureReporter, createTraceCollector, startFixtureService } from './core.mjs'
import { FixtureMethod, FixtureTrace } from './text.mjs'

/** Ordinary portable fixture configuration is read from the public launcher bootstrap. */
const { data } = readThreadBootstrap(workerData)
/** The Worker retains its own native warning classification and fails unexpected reports. */
const diagnostics = createFixtureReporter(FixtureTrace.host.worker)
/** Every real host captures all stages without constructing synthetic acceptance events. */
const collector = data?.observed ? createTraceCollector(diagnostics.report) : undefined
/**
 * Diagnostic listener setup has its own real readiness Promise, exposed through the normal
 * provider.
 */
let ready
/**
 * Failure reaches the original Worker ready provider rather than disappearing into a background
 * task.
 */
let failReady
/** The parent awaits actual listener readiness before the traced cascade starts. */
const serviceReady = new Promise((resolve, reject) => {
  ready = resolve
  failReady = reject
})
/** A separate unprobed socket service cannot cause the business endpoint to be self-filtered. */
let service

/** The automatic Worker Peer receives the explicit raw Endpoint trace through its original context. */
await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true, probe: collector, report: diagnostics.report })],
  authentication: fixtureAuthentication(),
  provide: {
    /**
     * Real Worker execution supplies both the business result and native host identity.
     *
     * @param {number} value Business payload passed through the real child Peer.
     * @param {import('@migaia/rpc-host').IRpcContext} context Original admitted provider context
     *   with the caller-owned trace.
     * @returns {{
     *   value: number
     *   pid: number
     *   threadId: number
     *   isMainThread: boolean
     *   collectorInstalled: boolean
     * }}
     *   Actual Worker result and native execution identity.
     * @throws {Error} A concrete trace assertion failure; the original provider reports it.
     */
    [FixtureMethod.increment](value, context) {
      if (data?.observed) assert.equal(context.trace, FixtureTrace.id)
      return {
        value: value + 1,
        pid: process.pid,
        threadId,
        isMainThread,
        collectorInstalled: collector !== undefined
      }
    },
    /**
     * Publish the actual bound diagnostic address after its native listener is ready.
     *
     * @returns {Promise<{ address: string; id: string } | null>} Ordinary diagnostic connection
     *   configuration.
     * @throws {Error} Original diagnostic setup failure.
     */
    [FixtureMethod.ready]() {
      return serviceReady
    },
    /**
     * Remote control closes the actual observer while retaining the same business Peer.
     *
     * @returns {Promise<boolean>} Completion after actual diagnostic cleanup and collector close.
     * @throws {Error} Original listener or Peer cleanup failure.
     */
    async [FixtureMethod.closeCollector]() {
      await service?.close()
      collector?.close()
      return true
    }
  },
  report: diagnostics.report
})
try {
  if (collector)
    service = await startFixtureService(collector, FixtureTrace.host.worker, diagnostics.report)
  ready(service ? { address: service.address, id: service.id } : null)
} catch (error) {
  failReady(error)
  diagnostics.report(error)
  throw error
}
