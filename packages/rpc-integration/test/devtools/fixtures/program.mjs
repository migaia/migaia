import assert from 'node:assert/strict'
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'
import { createThreadPeer } from '@migaia/rpc-threads'
import { fixtureAuthentication } from './auth.mjs'
import {
  observedCore,
  createFixtureReporter,
  createTraceCollector,
  traceEndpointFactory,
  startFixtureService,
  connectFixtureService,
  proveFixtureSelfFilter,
  proveLiveTrace
} from './core.mjs'
import { FixtureMethod, FixtureMode, FixtureScope, FixtureTrace } from './text.mjs'

/** The same genuine entry and mode are replayed by Process spawn:true. */
const observed = process.argv[2] === FixtureMode.observed
/** The original marker decides this entry's host before native discovery consumes it. */
const childMode = isProcessChild()
/**
 * Every unexpected report fails at its original host, while known native warnings remain
 * classified.
 */
const diagnostics = createFixtureReporter(
  childMode ? FixtureTrace.host.child : FixtureTrace.host.parent
)
/** Actual hosts capture all seven stages; each service uses a separate unprobed endpoint. */
const collector = observed ? createTraceCollector(diagnostics.report) : undefined

if (childMode) {
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
  /** The child's own Worker caller retains the public Endpoint that accepts explicit trace. */
  let workerEndpoint
  /** The original channel's actual remote address is retained, never inferred from probe events. */
  let workerId
  /** Actual diagnostic setup is published only after each native listener has bound its port. */
  let service
  /** Worker descriptor comes from its real ready provider, after its service listener binds. */
  let workerService
  /** Automatic stdio consumption occurs before other host setup can inspect the launcher marker. */
  const child = await createProcessPeer({
    authentication: fixtureAuthentication(),
    probe: collector,
    provide: {
      /**
       * Cascading business explicitly passes the original caller trace to the real Worker Endpoint.
       *
       * @param {number} value Parent's real business payload.
       * @param {import('@migaia/rpc-core').IRpcContext} context Original admitted caller context
       *   and explicit trace.
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
      async [FixtureMethod.cascade](value, context) {
        await setup
        /** The value and thread identity come from the actual Worker provider. */
        const reply = await workerEndpoint.send(workerId, FixtureMethod.increment, value, {
          trace: context.trace
        })
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
       * Return only actual bound socket descriptors needed by the parent's live service clients.
       *
       * @returns {Promise<{
       *   child: { address: string; id: string } | null
       *   worker: { address: string; id: string } | null
       * }>}
       *   Ordinary application connection configuration.
       * @throws {Error} Original Worker or diagnostic listener setup failure.
       */
      async [FixtureMethod.diagnostics]() {
        await setup
        return {
          child: service ? { address: service.address, id: service.id } : null,
          worker: workerService ?? null
        }
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
        await service?.close()
        collector?.close()
        return true
      }
    },
    report: diagnostics.report
  })
  try {
    worker = await createThreadPeer({
      self: { name: FixtureTrace.caller.child, instanceId: FixtureTrace.caller.child },
      spawn: {
        entry: new URL('./worker.mjs', import.meta.url),
        data: { observed }
      },
      authentication: fixtureAuthentication(),
      endpointFactory: traceEndpointFactory(
        FixtureTrace.caller.child,
        (endpoint, peerId) => {
          workerEndpoint = endpoint
          workerId = peerId
        },
        diagnostics.report
      ),
      probe: collector,
      report: diagnostics.report
    })
    workerService = await worker.request(FixtureMethod.ready)
    if (collector)
      service = await startFixtureService(collector, FixtureTrace.host.child, diagnostics.report)
    acceptSetup()
  } catch (error) {
    rejectSetup(error)
    await child.close()
    diagnostics.report(error)
    throw error
  }
} else {
  /** Caller-owned Endpoint and channel address are the only surfaces used for explicit trace sends. */
  let endpoint
  /** Actual remote address is delivered by the public factory callback. */
  let childId
  /** The parent also exposes its original collector through a separate unprobed service Peer. */
  let service
  /** All ready diagnostic clients retain their original public close operations. */
  const serviceClients = []
  /** This standalone parent satisfies the literal root spawn:true acceptance without a test runner. */
  const child = await createProcessPeer({
    self: { name: FixtureTrace.caller.parent, instanceId: FixtureTrace.caller.parent },
    spawn: true,
    authentication: fixtureAuthentication(),
    endpointFactory: traceEndpointFactory(
      FixtureTrace.caller.parent,
      (prepared, peerId) => {
        endpoint = prepared
        childId = peerId
      },
      diagnostics.report
    ),
    probe: collector,
    report: diagnostics.report
  })
  try {
    await child.request(FixtureMethod.ready)
    /** Only actual setup data, not trace observations, crosses the existing ready/config path. */
    const addresses = await child.request(FixtureMethod.diagnostics)
    /** Parent recording starts before the traced business through its real independent service. */
    let parentService
    /** Self-filter proof uses actual traffic on a distinct service endpoint before recording begins. */
    let selfFiltered = false
    if (collector) {
      selfFiltered = await proveFixtureSelfFilter(collector, diagnostics.report)
      service = await startFixtureService(collector, FixtureTrace.host.parent, diagnostics.report)
      parentService = await connectFixtureService(
        service,
        FixtureTrace.host.parent,
        diagnostics.report
      )
      serviceClients.push(parentService)
      await parentService.request(FixtureTrace.recordStart)
    }
    /** The first call executes parent -> actual child -> actual Worker. */
    const reply = await endpoint.send(childId, FixtureMethod.cascade, 40, {
      trace: FixtureTrace.id
    })
    assert.equal(reply.value, 42)
    assert.notEqual(reply.childPid, process.pid)
    assert.equal(reply.workerPid, reply.childPid)
    assert.equal(reply.workerIsMainThread, false)
    assert.ok(reply.workerThreadId > 0)
    assert.equal(reply.childCollectorInstalled, observed)
    assert.equal(reply.workerCollectorInstalled, observed)
    /** Live catch-up queries run after the real cascade, so no watcher-arrival timing is guessed. */
    let trace
    if (collector) {
      assert.ok(addresses.child)
      assert.ok(addresses.worker)
      /** The canonical service record contains only genuinely emitted parent observations. */
      const recording = await parentService.request(FixtureTrace.recordStop)
      /** Existing native socket APIs connect the parent to each remote host's original service. */
      const childService = await connectFixtureService(
        addresses.child,
        FixtureTrace.host.child,
        diagnostics.report
      )
      serviceClients.push(childService)
      const workerService = await connectFixtureService(
        addresses.worker,
        FixtureTrace.host.worker,
        diagnostics.report
      )
      serviceClients.push(workerService)
      trace = {
        ...(await proveLiveTrace(
          [
            { host: FixtureTrace.host.parent, peer: parentService },
            { host: FixtureTrace.host.child, peer: childService },
            { host: FixtureTrace.host.worker, peer: workerService }
          ],
          recording,
          diagnostics.report
        )),
        selfFiltered
      }
      // The hub has closed its actual watches before any diagnostic clients/listeners are retired.
      await Promise.all(serviceClients.map((peer) => peer.close()))
      await service.close()
    }
    await child.request(FixtureMethod.closeCollectors)
    collector?.close()
    /** Native business remains the same after all three real-host observers are closed. */
    const closedReply = await endpoint.send(childId, FixtureMethod.cascade, 40, {
      trace: FixtureTrace.id
    })
    assert.equal(closedReply.value, reply.value)
    /** Actual two-hop evidence is reported only after live service and carrier assertions pass. */
    console.error(
      JSON.stringify({
        acceptance: FixtureTrace.acceptance,
        observed,
        result: reply.value,
        afterCollectorClose: closedReply.value,
        parentPid: process.pid,
        childPid: reply.childPid,
        workerPid: reply.workerPid,
        workerThreadId: reply.workerThreadId,
        trace
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
        core,
        trace,
        reports: diagnostics.reports
      })
    )
  } finally {
    await Promise.all(serviceClients.map((peer) => peer.close()))
    await service?.close()
    collector?.close()
    await child.close()
  }
}
