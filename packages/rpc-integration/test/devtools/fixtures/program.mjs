import assert from 'node:assert/strict'
import { isProcessChild, processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { RuntimePluginKey } from '@migaia/rpc-host/plugin'
import { runtimeTestHost } from '../../../../rpc-host/test/runtime-api/fixture.ts'
import { readRuntimeOutletConnection } from '../../../../rpc-host/dist/remote/runtime-api/outlet.js'
import {
  readRuntimePeerConnection,
  readRuntimePeerEndpoint
} from '../../../../rpc-host/dist/remote/runtime-api/peer.js'
import { fixtureAuthentication } from './auth.mjs'
import {
  observedCore,
  createFixtureReporter,
  createTraceCollector,
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

/** One actual child Host owns setup, Worker transport and local collector service state. */
class ChildProgram {
  /** The original strict reporter belongs to this real process. */
  #diagnostics
  /** The optional observer remains the exact collector created for this child. */
  #collector
  /** Original startup completion is shared only by this child's business providers. */
  #setup
  /** Resolve only after the actual Worker and diagnostic listener are ready. */
  #acceptSetup
  /** Preserve the original startup failure for every waiting business provider. */
  #rejectSetup
  /** Ordinary Host owns the automatic verified parent byte transport. */
  #childHost = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Ordinary Host owns the actual Worker and its native termination resource. */
  #workerHost = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The genuine committed Worker Peer carries request and collector shutdown traffic. */
  #worker
  /** The Worker's actual native endpoint receives the original explicit caller trace. */
  #workerEndpoint
  /** Physical worker routing identity comes only from its original accepted channel. */
  #workerId
  /** This child alone owns its actual bound collector listener. */
  #service
  /** Actual Worker ready response supplies its independent collector listener descriptor. */
  #workerService
  /**
   * Capture native observers and allocate the original one-time startup promise.
   *
   * @param {ReturnType<typeof createFixtureReporter>} diagnostics Strict child reporter.
   * @param {ReturnType<typeof createTraceCollector> | undefined} collector Actual optional
   *   observer.
   */
  constructor(diagnostics, collector) {
    this.#diagnostics = diagnostics
    this.#collector = collector
    this.#setup = new Promise((resolve, reject) => {
      this.#acceptSetup = resolve
      this.#rejectSetup = reject
    })
  }
  /** Actual providers access only this process's original setup and native Worker state. */
  #provide = {
    /**
     * Cascading business explicitly passes the original caller trace to the real Worker Endpoint.
     *
     * @param {number} value Parent's real business payload.
     * @param {import('@migaia/rpc-host').IRpcContext} context Original admitted caller context and
     *   explicit trace.
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
    [FixtureMethod.cascade]: async (value, context) => {
      await this.#setup
      /** The value and thread identity come from the actual Worker provider. */
      const reply = await this.#workerEndpoint.send(
        this.#workerId,
        FixtureMethod.increment,
        value,
        {
          trace: context.trace
        }
      )
      return {
        value: reply.value + 1,
        childPid: process.pid,
        workerPid: reply.pid,
        workerThreadId: reply.threadId,
        workerIsMainThread: reply.isMainThread,
        childCollectorInstalled: this.#collector !== undefined,
        workerCollectorInstalled: reply.collectorInstalled
      }
    },
    /**
     * Join actual setup without making test-runner or transport readiness guesses.
     *
     * @returns {Promise<boolean>} Successful real Worker startup.
     * @throws {Error} Original Worker startup failure.
     */
    [FixtureMethod.ready]: async () => {
      await this.#setup
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
    [FixtureMethod.diagnostics]: async () => {
      await this.#setup
      return {
        child: this.#service ? { address: this.#service.address, id: this.#service.id } : null,
        worker: this.#workerService ?? null
      }
    },
    /**
     * Both remote observers close while business connections stay intact for the repeated call.
     *
     * @returns {Promise<boolean>} Completion of both real remote-host collector closes.
     * @throws {Error} Original startup or remote close request failure.
     */
    [FixtureMethod.closeCollectors]: async () => {
      await this.#setup
      await this.#worker.request(FixtureMethod.closeCollector)
      await this.#service?.close()
      this.#collector?.close()
      return true
    }
  }
  /**
   * Open the real automatic parent before starting the genuine managed Worker.
   *
   * @returns {Promise<void>} Actual child provider and Worker setup completion.
   * @throws {Error} Original parent, Worker or diagnostic listener startup failure.
   */
  async run() {
    await this.#childHost.use(
      processPlugin({
        connectToParent: true,
        authentication: fixtureAuthentication(),
        probe: this.#collector,
        provide: this.#provide,
        report: this.#diagnostics.report
      })
    )
    try {
      await this.#workerHost.use(
        threadPlugin({
          self: { name: FixtureTrace.caller.child, instanceId: FixtureTrace.caller.child },
          spawn: { entry: new URL('./worker.mjs', import.meta.url), data: { observed } },
          authentication: fixtureAuthentication(),
          probe: this.#collector,
          report: this.#diagnostics.report
        })
      )
      this.#worker = readRuntimeOutletConnection(
        this.#workerHost.thread,
        RuntimePluginKey.thread
      ).peer
      this.#workerEndpoint = readRuntimePeerEndpoint(this.#worker).endpoint
      this.#workerId = readRuntimePeerConnection(this.#worker).peerId
      this.#workerService = await this.#worker.request(FixtureMethod.ready)
      if (this.#collector)
        this.#service = await startFixtureService(
          this.#collector,
          FixtureTrace.host.child,
          this.#diagnostics.report
        )
      this.#acceptSetup()
    } catch (error) {
      this.#rejectSetup(error)
      await this.#workerHost.dispose()
      await this.#childHost.dispose()
      this.#diagnostics.report(error)
      throw error
    }
  }
}

/**
 * The real parent owns its automatic child source, collector connections and explicit trace
 * endpoint.
 */
class ParentProgram {
  /** Strict reporter retains the actual parent failure classification. */
  #diagnostics
  /** This is the original optional parent collector, never a synthetic event source. */
  #collector
  /** One ordinary native Host owns the actual spawn:true child installation. */
  #host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Genuine committed Peer supplies ready, diagnostics and collector-close requests. */
  #child
  /** The exact original native endpoint accepts explicit caller trace metadata. */
  #endpoint
  /** Accepted physical routing identity is read from this same genuine child Peer. */
  #childId
  /** Parent collector listener stays separate from every probed business endpoint. */
  #service
  /** Each actual remote service client retains its original close operation. */
  #serviceClients = []
  /** The original parent recording is controlled through its real independent service client. */
  #parentService
  /** The actual self-filter proof completes before business recording begins. */
  #selfFiltered = false
  /**
   * Capture the exact optional collector and original strict diagnostic owner.
   *
   * @param {ReturnType<typeof createFixtureReporter>} diagnostics Strict parent reporter.
   * @param {ReturnType<typeof createTraceCollector> | undefined} collector Actual optional
   *   observer.
   */
  constructor(diagnostics, collector) {
    this.#diagnostics = diagnostics
    this.#collector = collector
  }
  /**
   * Execute the actual parent-to-child-to-Worker cascade and all original native trace assertions.
   *
   * @returns {Promise<void>} Actual business, live trace and resource cleanup completion.
   * @throws {Error} Original native startup, request, assertion or cleanup failure.
   */
  async run() {
    try {
      await this.#host.use(
        processPlugin({
          self: { name: FixtureTrace.caller.parent, instanceId: FixtureTrace.caller.parent },
          spawn: true,
          authentication: fixtureAuthentication(),
          probe: this.#collector,
          report: this.#diagnostics.report
        })
      )
      this.#child = readRuntimeOutletConnection(this.#host.process, RuntimePluginKey.process).peer
      this.#endpoint = readRuntimePeerEndpoint(this.#child).endpoint
      this.#childId = readRuntimePeerConnection(this.#child).peerId
      await this.#child.request(FixtureMethod.ready)
      /** The real ready/config path returns only actually bound diagnostic listener addresses. */
      const addresses = await this.#child.request(FixtureMethod.diagnostics)
      await this.#startRecording()
      /**
       * This exact send carries caller-owned trace through both real native process and Worker
       * hops.
       */
      const reply = await this.#endpoint.send(this.#childId, FixtureMethod.cascade, 40, {
        trace: FixtureTrace.id
      })
      assert.equal(reply.value, 42)
      assert.notEqual(reply.childPid, process.pid)
      assert.equal(reply.workerPid, reply.childPid)
      assert.equal(reply.workerIsMainThread, false)
      assert.ok(reply.workerThreadId > 0)
      assert.equal(reply.childCollectorInstalled, observed)
      assert.equal(reply.workerCollectorInstalled, observed)
      /**
       * Queries observe actual emitted events after business completion, without guessed watcher
       * timing.
       */
      const trace = await this.#collectTrace(addresses)
      await this.#child.request(FixtureMethod.closeCollectors)
      this.#collector?.close()
      /** Original native business remains available after all three observers have closed. */
      const closedReply = await this.#endpoint.send(this.#childId, FixtureMethod.cascade, 40, {
        trace: FixtureTrace.id
      })
      assert.equal(closedReply.value, reply.value)
      await this.#reportResult(reply, closedReply, trace)
    } finally {
      await Promise.all(this.#serviceClients.map((peer) => peer.close()))
      await this.#service?.close()
      this.#collector?.close()
      await this.#host.dispose()
    }
  }
  /**
   * Prove self-filtering with actual independent service traffic before starting its original
   * recording.
   *
   * @returns {Promise<void>} Actual parent recording startup, or no work when unobserved.
   * @throws {Error} Original native service or self-filter assertion failure.
   */
  async #startRecording() {
    if (!this.#collector) return
    this.#selfFiltered = await proveFixtureSelfFilter(this.#collector, this.#diagnostics.report)
    this.#service = await startFixtureService(
      this.#collector,
      FixtureTrace.host.parent,
      this.#diagnostics.report
    )
    this.#parentService = await connectFixtureService(
      this.#service,
      FixtureTrace.host.parent,
      this.#diagnostics.report
    )
    this.#serviceClients.push(this.#parentService)
    await this.#parentService.request(FixtureTrace.recordStart)
  }
  /**
   * Query the original three actual collectors and close only their independent diagnostic clients.
   *
   * @param {{
   *   child: { address: string; id: string } | null
   *   worker: { address: string; id: string } | null
   * }} addresses
   *   Bound descriptors.
   * @returns {Promise<unknown>} Original proven live trace or undefined when observers are absent.
   * @throws {Error} Original descriptor, carrier, catch-up or service failure.
   */
  async #collectTrace(addresses) {
    if (!this.#collector) return undefined
    assert.ok(addresses.child)
    assert.ok(addresses.worker)
    /** Stop returns only genuinely emitted observations from the original parent collector. */
    const recording = await this.#parentService.request(FixtureTrace.recordStop)
    /** Real native socket clients contact each original remote collector service. */
    const childService = await connectFixtureService(
      addresses.child,
      FixtureTrace.host.child,
      this.#diagnostics.report
    )
    this.#serviceClients.push(childService)
    /** Worker diagnostics retain their distinct physical host and thread identity. */
    const workerService = await connectFixtureService(
      addresses.worker,
      FixtureTrace.host.worker,
      this.#diagnostics.report
    )
    this.#serviceClients.push(workerService)
    /** Carrier and trace assertions consume original service snapshots before any client closes. */
    const trace = {
      ...(await proveLiveTrace(
        [
          { host: FixtureTrace.host.parent, peer: this.#parentService },
          { host: FixtureTrace.host.child, peer: childService },
          { host: FixtureTrace.host.worker, peer: workerService }
        ],
        recording,
        this.#diagnostics.report
      )),
      selfFiltered: this.#selfFiltered
    }
    await Promise.all(this.#serviceClients.map((peer) => peer.close()))
    await this.#service.close()
    return trace
  }
  /**
   * Publish original two-hop evidence only after every actual business/carrier assertion passes.
   *
   * @param {Record<string, unknown>} reply Actual initial cascade result and native identities.
   * @param {Record<string, unknown>} closedReply Actual cascade after observer close.
   * @param {unknown} trace Original proven service trace, absent when unobserved.
   * @returns {Promise<void>} Original independent Core observation and both JSON output writes.
   * @throws {Error} Original Core diagnostic assertion failure.
   */
  async #reportResult(reply, closedReply, trace) {
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
    /** Direct Core observations remain independent and run after the managed business assertions. */
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
          parent: this.#collector !== undefined,
          child: reply.childCollectorInstalled,
          worker: reply.workerCollectorInstalled
        },
        core,
        trace,
        reports: this.#diagnostics.reports
      })
    )
  }
}

if (childMode) await new ChildProgram(diagnostics, collector).run()
else await new ParentProgram(diagnostics, collector).run()
