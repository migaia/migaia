import assert from 'node:assert/strict'
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'
import { createThreadPeer } from '@migaia/rpc-threads'
import { createRpcDevtools } from '@migaia/rpc-devtools'
import { fixtureAuthentication, reportFailure } from './auth.mjs'
import { observedCore } from './core.mjs'
import { FixtureMethod, FixtureMode, FixtureScope } from './text.mjs'

/** The same genuine entry and mode are replayed by Process spawn:true. */
const observed = process.argv[2] === FixtureMode.observed
/** Actual hosts construct independent collectors; managed option forwarding remains a known gap. */
const collector = observed ? createRpcDevtools({ onError: reportFailure }) : undefined

if (isProcessChild()) {
  /** The parent may become ready before the child has finished starting its actual Worker. */
  let acceptSetup
  /** Startup failure is returned through the original provider instead of leaving a readiness wait. */
  let rejectSetup
  /** This one fixture readiness promise represents real Worker setup, not synthetic collector data. */
  const setup = new Promise((resolve, reject) => {
    acceptSetup = resolve
    rejectSetup = reject
  })
  /** Worker lifetime stays with the real Thread Peer and its ordinary managed source. */
  let worker
  /** Automatic stdio consumption occurs before other host setup can inspect the launcher marker. */
  const child = await createProcessPeer({
    authentication: fixtureAuthentication(),
    probe: collector,
    provide: {
      /**
       * Cascading business uses the public native request path with no unsupported trace option.
       *
       * @param {number} value Parent's real business payload.
       * @returns {Promise<{
       *   value: number
       *   childPid: number
       *   workerPid: number
       *   workerThreadId: number
       *   workerIsMainThread: boolean
       *   childCollectorInstalled: boolean
       *   workerCollectorInstalled: boolean
       * }>}
       *   Result and actual native host identities.
       * @throws {Error} Original Worker startup or request failure.
       */
      async [FixtureMethod.cascade](value) {
        await setup
        /** The value and thread identity come from the actual Worker provider. */
        const reply = await worker.request(FixtureMethod.increment, value)
        return {
          value: reply.value + 1,
          childPid: process.pid,
          workerPid: reply.pid,
          workerThreadId: reply.threadId,
          workerIsMainThread: reply.isMainThread,
          childCollectorInstalled: collector !== undefined,
          workerCollectorInstalled: reply.collectorInstalled
        }
      },
      /**
       * Join actual setup without making test-runner or transport readiness guesses.
       *
       * @returns {Promise<boolean>} Successful real Worker startup.
       * @throws {Error} Original Worker startup failure.
       */
      async [FixtureMethod.ready]() {
        await setup
        return true
      },
      /**
       * Both remote observers close while business connections stay intact for the repeated call.
       *
       * @returns {Promise<boolean>} Completion of both real remote-host collector closes.
       * @throws {Error} Original startup or remote close request failure.
       */
      async [FixtureMethod.closeCollectors]() {
        await setup
        await worker.request(FixtureMethod.closeCollector)
        collector?.close()
        return true
      }
    },
    report: reportFailure
  })
  try {
    worker = await createThreadPeer({
      spawn: {
        entry: new URL('./worker.mjs', import.meta.url),
        data: { observed }
      },
      authentication: fixtureAuthentication(),
      probe: collector,
      report: reportFailure
    })
    acceptSetup()
  } catch (error) {
    rejectSetup(error)
    reportFailure(error)
    await child.close()
    throw error
  }
} else {
  /** This standalone parent satisfies the literal root spawn:true acceptance without a test runner. */
  const child = await createProcessPeer({
    spawn: true,
    authentication: fixtureAuthentication(),
    probe: collector,
    report: reportFailure
  })
  try {
    await child.request(FixtureMethod.ready)
    /** The first call executes parent -> actual child -> actual Worker. */
    const reply = await child.request(FixtureMethod.cascade, 40)
    assert.equal(reply.value, 42)
    assert.notEqual(reply.childPid, process.pid)
    assert.equal(reply.workerPid, reply.childPid)
    assert.equal(reply.workerIsMainThread, false)
    assert.ok(reply.workerThreadId > 0)
    assert.equal(reply.childCollectorInstalled, observed)
    assert.equal(reply.workerCollectorInstalled, observed)
    await child.request(FixtureMethod.closeCollectors)
    collector?.close()
    /** Native business remains the same after all three real-host observers are closed. */
    const closedReply = await child.request(FixtureMethod.cascade, 40)
    assert.equal(closedReply.value, reply.value)
    /**
     * Native business evidence remains observable even when the later independent live query is
     * RED.
     */
    console.error(
      JSON.stringify({
        acceptance: 'A-total applicable managed three-host business only',
        observed,
        result: reply.value,
        afterCollectorClose: closedReply.value,
        parentPid: process.pid,
        childPid: reply.childPid,
        workerPid: reply.workerPid,
        workerThreadId: reply.workerThreadId,
        managedProbeForwarding: 'pending'
      })
    )
    /**
     * Direct Core observations remain independent from managed business and run after its
     * assertions.
     */
    const core = observed ? await observedCore() : undefined
    console.log(
      JSON.stringify({
        scope: FixtureScope,
        result: reply.value,
        afterCollectorClose: closedReply.value,
        parentPid: process.pid,
        childPid: reply.childPid,
        workerPid: reply.workerPid,
        workerThreadId: reply.workerThreadId,
        collectorInstallations: {
          parent: collector !== undefined,
          child: reply.childCollectorInstalled,
          worker: reply.workerCollectorInstalled
        },
        core
      })
    )
  } finally {
    collector?.close()
    await child.close()
  }
}
