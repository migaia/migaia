import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { isProcessChild } from '@migaia/rpc-plugin-process'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'
import { decodeRpcDevtoolsRecord } from '../../../../rpc-plugin-devtools/dist/contract/record-codec.js'
import { deserializeRpcError } from '@migaia/rpc-contract/errors'
import {
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeStage
} from '@migaia/rpc-host/probe'
import {
  CapabilityLevel,
  StandardCapability,
  SupervisionErrorCode,
  SUPERVISION_SOURCE
} from '@migaia/supervision'

/** Shared argv, provider routes and receipt identity belong to this standalone portability fixture. */
export const ServicePortableFixture = {
  acceptance: 'real-process service portability',
  modes: { metadata: 'metadata', exposed: 'exposed' },
  methods: {
    describe: 'devtools.describe',
    query: 'devtools.query',
    watch: 'devtools.watch',
    stats: 'devtools.stats',
    start: 'devtools.record.start',
    stop: 'devtools.record.stop',
    watchReady: 'fixture.watchReady',
    emit: 'fixture.emit',
    close: 'fixture.close'
  },
  endpoint: 'service-portable-business',
  business: 'service-portable.business',
  source: '@migaia/rpc/closure-fixture',
  primaryCode: 'FIXTURE_PRIMARY',
  causeCode: 'FIXTURE_CAUSE',
  primaryMessage: 'service portability primary failure',
  causeMessage: 'service portability original cause',
  messagePrefix: 'service-portable-',
  processKind: 'process',
  reportClassification: { warning: 'existing platform warning', failure: 'unexpected failure' }
}

/** Child and parent report native failures without changing their source, code or cause. */
const reports = []

/**
 * Preserve the complete observable classification on stderr and in the final parent receipt.
 *
 * @param {unknown} error Original runtime, collector or fixture failure.
 * @returns {void} Retains scalar diagnostic fields and writes one JSON diagnostic line.
 * @throws {Error} Original console/reporting failure; no failed operation is suppressed.
 */
function reportFailure(error) {
  /** Canonical owners expose classification through the original error and its detail field. */
  const original = /**
   * @type {Error & {
   *   source?: string
   *   code?: string
   *   reason?: string
   *   detail?: { reason?: string; capability?: string; level?: string; kind?: string }
   * }}
   */ (error)
  /** Known best-effort termination degradation is recorded separately from unexpected failures. */
  const warning =
    original?.source === SUPERVISION_SOURCE &&
    original.code === SupervisionErrorCode.capabilityUnsupported &&
    original.detail?.capability === StandardCapability.termination &&
    original.detail.level === CapabilityLevel.unsupported &&
    original.detail.kind === ServicePortableFixture.processKind
  /** The fixture owns no secret material; library messages retain their existing redaction. */
  const receipt = {
    classification: warning
      ? ServicePortableFixture.reportClassification.warning
      : ServicePortableFixture.reportClassification.failure,
    source: original?.source ?? null,
    code: original?.code ?? null,
    name: original?.name ?? typeof error,
    reason: original?.reason ?? original?.detail?.reason ?? null,
    message: String(original?.message ?? error),
    capability: original?.detail?.capability ?? null,
    level: original?.detail?.level ?? null,
    kind: original?.detail?.kind ?? null
  }
  reports.push(receipt)
  console.error(JSON.stringify(receipt))
}

/** An application class and own function deliberately reach the real service conversion boundary. */
class CapturedPayload {
  /**
   * Keep one data property and one non-portable member on the captured application instance.
   *
   * @param {number} value Data that must survive class/function conversion.
   * @throws {Error} No intentional failure; allocation failures retain their native identity.
   */
  constructor(value) {
    /** This own data field must survive the process service response. */
    this.value = value
    /** Undefined fields must not escape as invalid portable object values. */
    this.missing = undefined
    /**
     * This function must be removed by the service, rather than by a fixture serializer.
     *
     * @returns {number} Original instance value if application code invokes the member.
     */
    this.callback = () => this.value
  }
}

/**
 * Construct a native coded graph whose original classes and stacks remain observable remotely.
 *
 * @returns {RangeError} Coded primary error with a separately coded TypeError cause.
 * @throws {Error} Original native construction or property-definition failure.
 */
function codedError() {
  /** Native cause identity is retained by the primary Error until the service crosses the wire. */
  const cause = new TypeError(ServicePortableFixture.causeMessage)
  Object.defineProperties(cause, {
    source: { value: ServicePortableFixture.source, enumerable: true },
    code: { value: ServicePortableFixture.causeCode, enumerable: true }
  })
  /** Native type and stack are not reconstructed in the producing host. */
  const primary = new RangeError(ServicePortableFixture.primaryMessage, { cause })
  Object.defineProperties(primary, {
    source: { value: ServicePortableFixture.source, enumerable: true },
    code: { value: ServicePortableFixture.primaryCode, enumerable: true }
  })
  return primary
}

/**
 * Supply controlled collector input through its existing public host-form emit interface.
 *
 * @param {number} seq Distinct fixture sequence inside this producer.
 * @param {number} stage Canonical numeric message or encoded stage.
 * @param {unknown} content Original captured application reference.
 * @param {Error | undefined} error Native error for the failed logical completion.
 * @returns {import('@migaia/rpc-host/probe').IRpcProbeEventView} Complete public event view.
 * @throws {Error} No intentional failure; allocation failures retain their native identity.
 */
function view(seq, stage, content, error = undefined) {
  return {
    seq,
    carrierSeq: -1,
    at: performance.now(),
    endpointId: ServicePortableFixture.endpoint,
    stage,
    direction: RpcProbeDirection.outbound,
    kind: stage === RpcProbeStage.message ? RpcProbeKind.request : -1,
    outcome: error === undefined ? RpcProbeOutcome.none : RpcProbeOutcome.failed,
    messageId: ServicePortableFixture.messagePrefix + seq,
    method: ServicePortableFixture.business,
    senderId: ServicePortableFixture.endpoint,
    targetId: undefined,
    receiverId: undefined,
    peerId: undefined,
    trace: undefined,
    sizeBytes: -1,
    chunkIndex: -1,
    chunkCount: -1,
    members: -1,
    durationMs: stage === RpcProbeStage.message ? 10 : -1,
    rejection: undefined,
    lifecycle: undefined,
    error,
    carrier: undefined,
    detail: undefined,
    content
  }
}

/**
 * Ingest native errors, both byte brands, and a class/function reference without converting them.
 *
 * @param {import('@migaia/rpc-plugin-devtools').IRpcDevtools} collector Actual independent
 *   collector.
 * @param {number} start First sequence of this four-event fixture batch.
 * @returns {number} Number of events synchronously ingested through the public collector.
 * @throws {Error} Original collector or native construction failure.
 */
function emitBatch(collector, start) {
  collector.emit(view(start, RpcProbeStage.message, undefined, codedError()))
  collector.emit(view(start + 1, RpcProbeStage.encoded, new Uint8Array([1, 2, 3])))
  /** The buffer itself reaches the service; the fixture does not pre-wrap or encode it. */
  const backing = new Uint8Array([4, 5, 6]).buffer
  collector.emit(view(start + 2, RpcProbeStage.encoded, backing))
  collector.emit(view(start + 3, RpcProbeStage.encoded, new CapturedPayload(17)))
  return 4
}

/**
 * Verify the public error deserializer restores codes, native classes, cause and remote stacks.
 *
 * @param {unknown} wire Error graph returned by the actual process service.
 * @returns {void} Completes the graph assertions.
 * @throws {Error} Original deserializer failure or concrete assertion failure.
 */
function assertError(wire) {
  /** The public owner validates and restores the actual received graph, without a fixture decoder. */
  const restored = deserializeRpcError(wire)
  assert.ok(restored instanceof RangeError)
  assert.equal(restored.message, ServicePortableFixture.primaryMessage)
  assert.equal(Reflect.get(restored, 'source'), ServicePortableFixture.source)
  assert.equal(Reflect.get(restored, 'code'), ServicePortableFixture.primaryCode)
  assert.ok(restored.stack && restored.stack.length > 0)
  assert.ok(restored.cause instanceof TypeError)
  assert.equal(restored.cause.message, ServicePortableFixture.causeMessage)
  assert.equal(Reflect.get(restored.cause, 'source'), ServicePortableFixture.source)
  assert.equal(Reflect.get(restored.cause, 'code'), ServicePortableFixture.causeCode)
  assert.ok(restored.cause.stack && restored.cause.stack.length > 0)
}

/**
 * Assert the real service's wire representation without serializing or repairing its output.
 *
 * @param {readonly import('../../../../rpc-plugin-devtools/dist/contract/wire.js').IRpcDevtoolsWireEvent[]} events
 *   Received query/watch rows.
 * @param {boolean} exposed Whether the producing collector enables remote content.
 * @returns {void} Completes metadata, error and captured-content assertions.
 * @throws {Error} Concrete assertion or public error-deserializer failure.
 */
function assertWireEvents(events, exposed) {
  assert.equal(events.length, 4)
  assertError(events[0].error)
  if (!exposed) {
    for (const event of events) assert.equal(Object.hasOwn(event, 'content'), false)
    return
  }
  assert.equal(events[1].content.$rpc, 'bytes')
  assert.equal(events[1].content.base64url, 'AQID')
  assert.equal(events[2].content.$rpc, 'bytes')
  assert.equal(events[2].content.base64url, 'BAUG')
  assert.equal(events[3].content.value, 17)
  assert.deepEqual(Object.keys(events[3].content), ['value'])
  assert.equal(Object.hasOwn(events[3].content, 'callback'), false)
  assert.equal(Object.hasOwn(events[3].content, 'missing'), false)
}

/**
 * Serve the untouched collector boundary on an unprobed automatic Process Peer.
 *
 * @param {boolean} exposed Remote content mode selected by the parent's argv.
 * @returns {Promise<void>} Resolves after the actual automatic provider Peer becomes ready.
 * @throws {Error} Original process/service setup failure; no fixture wire workaround is used.
 */
async function serve(exposed) {
  /** Collector input is independent from the unprobed service endpoint's transport traffic. */
  const collector = devtoolsPlugin({
    stages: ['message', 'encoded'],
    capture: ['encoded'],
    exposeContent: exposed,
    onError: reportFailure
  }).collector
  emitBatch(collector, 1)
  /** Readiness resolves only when Core actually calls the original service iterator's next method. */
  let started
  /**
   * This Promise observes an actual iterator operation, rather than elapsed time or a guessed
   * delay.
   */
  const watchStarted = new Promise((resolve) => {
    started = resolve
  })
  /** The public service object stays mutable while its own methods remain the conversion owner. */
  const service =
    /** @type {import('../../../../rpc-plugin-devtools/dist/contract/service.js').IRpcDevtoolsServiceApi} */ (
      collector.service
    )
  /** Runtime invocation supplies the original serving context as the second provider argument. */
  const originalWatch = /**
   * @type {(
   *   input?: Omit<
   *     import('../../../../rpc-plugin-devtools/dist/contract/service.js').IRpcDevtoolsQuery,
   *     'afterSeq' | 'limit'
   *   >,
   *   context?: import('@migaia/rpc-host').IRpcContext
   * ) => AsyncGenerator<
   *   import('../../../../rpc-plugin-devtools/dist/contract/service.js').IRpcDevtoolsWatchBatch
   * >}
   */ (service.watch)
  /**
   * Observe readiness while returning the exact service-owned iterator and forwarding its context.
   *
   * @param {Omit<
   *       import('../../../../rpc-plugin-devtools/dist/contract/service.js').IRpcDevtoolsQuery,
   *       'afterSeq' | 'limit'
   *     >
   *   | undefined} input
   *   Original watch filter.
   * @param {import('@migaia/rpc-host').IRpcContext | undefined} context Original serving provider
   *   context.
   * @returns {AsyncGenerator<
   *   import('../../../../rpc-plugin-devtools/dist/contract/service.js').IRpcDevtoolsWatchBatch
   * >}
   *   Exact original service iterator.
   * @throws {Error} Original synchronous service setup failure.
   */
  service.watch = (input, context) => {
    /** Original iterator retains all service exposure, conversion and cleanup semantics. */
    const iterator = originalWatch(input, context)
    /** Native async-generator next needs its exact original receiver. */
    const originalNext = iterator.next
    /**
     * Mark readiness after the genuine first pull has entered the original generator.
     *
     * @param {unknown} value Original optional generator input.
     * @returns {Promise<
     *   IteratorResult<
     *     import('../../../../rpc-plugin-devtools/dist/contract/service.js').IRpcDevtoolsWatchBatch
     *   >
     * >}
     *   Exact native next Promise.
     * @throws {Error} Original synchronous next invocation failure.
     */
    iterator.next = (value) => {
      /** Reflect.apply preserves the native receiver and does not introduce a reaction Promise. */
      const pending = Reflect.apply(originalNext, iterator, [value])
      started(true)
      return pending
    }
    return iterator
  }
  await createRpcHost({
    plugins: [processPlugin({ connectToParent: true })],
    provide: {
      devtools: service,
      fixture: {
        /**
         * @returns {Promise<boolean>} Actual original watch pull readiness. @throws {Error} No
         *   intentional failure.
         */
        watchReady: () => watchStarted,
        /** @returns {number} Four original events. @throws {Error} Original collector failure. */
        emit: () => emitBatch(collector, 5),
        /**
         * @returns {{ closed: boolean; reports: typeof reports }} Collector close and exact
         *   reported diagnostics. @throws {Error} Original collector failure.
         */
        close: () => {
          collector.close()
          return { closed: true, reports }
        }
      }
    },
    report: reportFailure
  })
}

/**
 * Exercise every portability boundary through the genuine standalone spawn:true process exchange.
 *
 * @param {boolean} exposed Remote content mode for this actual child instance.
 * @returns {Promise<void>} Writes one passing receipt only after assertions and native cleanup.
 * @throws {Error} Original operation, cleanup or assertion failure.
 */
async function run(exposed) {
  /** Standalone argv is the launcher's supported actual entry, outside the test runner. */
  const peer = await createRpcHost({
    plugins: [processPlugin({ spawn: true })],
    report: reportFailure
  })
  /** One receipt carries concrete counts from actual remote query, watch and record results. */
  let receipt
  /** Actual child diagnostics cross the ordinary fixture-control provider without hiding failures. */
  let childReports = []
  try {
    /** Describe crosses the same service-owned plain-wire conversion as query and stats. */
    const description = await peer.request(ServicePortableFixture.methods.describe)
    assert.equal(description.paused, false)
    assert.ok(description.now > 0)
    /** No outcome filter must retain both the failed message and all none-outcome physical rows. */
    const page = await peer.request(ServicePortableFixture.methods.query)
    assertWireEvents(page.events, exposed)
    /** Statistics are separate from ring retention and count only the failed logical completion. */
    const initialStats = await peer.request(ServicePortableFixture.methods.stats)
    assert.equal(initialStats.methods.length, 1)
    assert.equal(initialStats.methods[0].calls, 1)
    assert.equal(initialStats.methods[0].failed, 1)
    await peer.request(ServicePortableFixture.methods.start)
    /** Real process streaming invokes the exact original service generator in the child. */
    const watching = peer.stream(ServicePortableFixture.methods.watch)
    /** The receipt reports the actual delivered watch length after its boundary assertions pass. */
    let watchEvents = 0
    try {
      /** First pull activates the original producer; readiness is acknowledged by its actual next. */
      const next = watching.next()
      assert.equal(await peer.request(ServicePortableFixture.methods.watchReady), true)
      assert.equal(await peer.request(ServicePortableFixture.methods.emit), 4)
      /** Watch content and native wire errors must pass the same real remote boundary as query. */
      const batch = await next
      assert.equal(batch.done, false)
      assert.equal(batch.value.dropped, 0)
      assertWireEvents(batch.value.events, exposed)
      watchEvents = batch.value.events.length
    } finally {
      await watching.return(undefined)
    }
    /** The canonical public record decoder alone restores the actual service-exported recording. */
    const recording = decodeRpcDevtoolsRecord(
      await peer.request(ServicePortableFixture.methods.stop)
    )
    assert.equal(recording.events.length, 4)
    assert.ok(recording.events[0].error instanceof RangeError)
    assert.equal(Reflect.get(recording.events[0].error, 'source'), ServicePortableFixture.source)
    assert.equal(Reflect.get(recording.events[0].error, 'code'), ServicePortableFixture.primaryCode)
    if (exposed) {
      assert.ok(recording.events[1].content instanceof Uint8Array)
      assert.deepEqual(Array.from(recording.events[1].content), [1, 2, 3])
      assert.ok(recording.events[2].content instanceof Uint8Array)
      assert.deepEqual(Array.from(recording.events[2].content), [4, 5, 6])
      assert.deepEqual(recording.events[3].content, { value: 17 })
    } else
      for (const event of recording.events) assert.equal(Object.hasOwn(event, 'content'), false)
    /** A second completion updates the same original aggregate through a live service stats call. */
    const finalStats = await peer.request(ServicePortableFixture.methods.stats)
    assert.equal(finalStats.methods[0].calls, 2)
    /**
     * Close acknowledges the collector's real operation and returns its observed report
     * classifications.
     */
    const closed = await peer.request(ServicePortableFixture.methods.close)
    assert.equal(closed.closed, true)
    childReports = closed.reports
    receipt = {
      acceptance: ServicePortableFixture.acceptance,
      exposed,
      queryEvents: page.events.length,
      watchEvents,
      recordingEvents: recording.events.length,
      calls: finalStats.methods[0].calls,
      errorGraphRestored: true,
      byteBrandsPortable: exposed,
      classAndFunctionsPortable: exposed,
      metadataContentHidden: !exposed
    }
  } finally {
    await peer.close()
  }
  /** Existing platform degradation is visible; unexpected reported failures cannot count as success. */
  for (const report of childReports)
    assert.equal(report.classification, ServicePortableFixture.reportClassification.warning)
  for (const report of reports)
    assert.equal(report.classification, ServicePortableFixture.reportClassification.warning)
  // JSON is the standalone receipt boundary, never an adaptation of service results.
  console.log(JSON.stringify({ ...receipt, reports: [...childReports, ...reports] }))
}

/** Importing shared fixture constants in Vitest never launches a native child. */
const entry = process.argv[1] === fileURLToPath(import.meta.url)
if (entry) {
  /**
   * Spawn:true replays the same argv, so parent and child agree on content mode without a side
   * channel.
   */
  const exposed = process.argv[2] === ServicePortableFixture.modes.exposed
  try {
    if (isProcessChild()) await serve(exposed)
    else await run(exposed)
  } catch (error) {
    reportFailure(error)
    throw error
  }
}
