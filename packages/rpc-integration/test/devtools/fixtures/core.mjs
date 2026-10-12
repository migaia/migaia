import assert from 'node:assert/strict'
import { MessageChannel } from 'node:worker_threads'
import { encode } from 'cborg'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import { createNodeThreadChannel } from '@migaia/rpc-threads'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRpcDevtools } from '@migaia/rpc-devtools'
import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'
import { decodeRpcDevtoolsRecord } from '@migaia/rpc-devtools/contract'
import { fixtureAuthentication, reportFailure } from './auth.mjs'
import { FixtureMethod } from './text.mjs'

/** These names belong to this direct-Core fixture, separate from the managed three-host program. */
const CoreFixture = {
  client: 'devtools-core-client',
  provider: 'devtools-core-provider',
  serviceClient: 'devtools-service-client',
  serviceProvider: 'devtools-service-provider',
  target: 'core',
  offline: 'recording',
  servicePrefix: 'devtools.',
  recordStart: 'devtools.record.start',
  recordStop: 'devtools.record.stop'
}

/**
 * Prove genuine local capture and a nonempty service-record/offline-hub boundary before live query.
 * Live service attachment remains RED for the owning source's portable-result failure. Captured
 * content is never normalized or cloned to hide that failure or manufacture a passing query.
 *
 * @returns {Promise<{
 *   events: number
 *   frameEvents: number
 *   protectedEvents: number
 *   localFrameDiffersFromProtected: boolean
 *   orderedTimeline: boolean
 *   recordingEvents: number
 *   recordingSequencePreserved: boolean
 *   result: number
 *   afterCollectorClose: number
 * }>}
 *   Actual evidence.
 * @throws {Error} Original public API failures and concrete fixture assertions.
 */
export async function observedCore() {
  /** Public Thread adapters borrow these real native resources; the fixture closes the ports. */
  const business = new MessageChannel()
  /** Diagnostic traffic uses its own unprobed endpoints, avoiding collector self-observation. */
  const diagnostic = new MessageChannel()
  /** One actual collector observes both direct Core endpoints in this one host. */
  const collector = createRpcDevtools({
    stages: ['message', 'envelope', 'encoded', 'frame', 'protected', 'carrier'],
    capture: ['envelope', 'encoded', 'frame', 'protected', 'carrier'],
    exposeContent: false,
    maxEvents: 4096,
    maxContentBytes: 1_048_576,
    onError: reportFailure
  })
  /** Hub creates no connections; it receives only the application's actual service client. */
  const hub = createRpcDevtoolsHub({ onError: reportFailure })
  /** Successfully opened Peers retain their original close operations for final cleanup. */
  const peers = []
  try {
    /** Both direct Core peers use the supported options-forwarding connect source. */
    const [client, provider] = await Promise.all([
      createRuntimePeer({
        self: { name: CoreFixture.client, instanceId: CoreFixture.client },
        authentication: fixtureAuthentication(),
        probe: collector,
        connect: async (context) =>
          createNodeThreadChannel(business.port1, CoreFixture.provider, {
            scheduler: systemScheduler,
            capabilities: context.capabilities
          }),
        report: reportFailure
      }),
      createRuntimePeer({
        self: { name: CoreFixture.provider, instanceId: CoreFixture.provider },
        authentication: fixtureAuthentication(),
        probe: collector,
        provide: { [FixtureMethod.increment]: (value) => value + 1 },
        connect: async (context) =>
          createNodeThreadChannel(business.port2, CoreFixture.client, {
            scheduler: systemScheduler,
            capabilities: context.capabilities
          }),
        report: reportFailure
      })
    ])
    peers.push(client, provider)
    /** The collector's real service object is exposed unchanged on a distinct unprobed Peer. */
    const [serviceClient, serviceProvider] = await Promise.all([
      createRuntimePeer({
        self: { name: CoreFixture.serviceClient, instanceId: CoreFixture.serviceClient },
        connect: async (context) =>
          createNodeThreadChannel(diagnostic.port1, CoreFixture.serviceProvider, {
            scheduler: systemScheduler,
            capabilities: context.capabilities
          }),
        report: reportFailure
      }),
      createRuntimePeer({
        self: { name: CoreFixture.serviceProvider, instanceId: CoreFixture.serviceProvider },
        provide: { devtools: collector.service },
        connect: async (context) =>
          createNodeThreadChannel(diagnostic.port2, CoreFixture.serviceClient, {
            scheduler: systemScheduler,
            capabilities: context.capabilities
          }),
        report: reportFailure
      })
    ])
    peers.push(serviceClient, serviceProvider)
    await serviceClient.request(CoreFixture.recordStart)
    /** Actual signed/encrypted business creates the events; no view or wire event is synthesized. */
    const result = await client.request(FixtureMethod.increment, 40)
    assert.equal(result, 41)
    /** The service record boundary returns actual collector text after the completed call. */
    const text = await serviceClient.request(CoreFixture.recordStop)
    assert.equal(typeof text, 'string')
    /** Local query preserves actual captured references without crossing the unsupported wire path. */
    const events = collector.query().events
    assert.ok(events.length > 0)
    /** Local frame observations precede protection; these are genuine Core captures. */
    const frames = events.filter((event) => event.stage === 'frame')
    /** Local protected observations carry the actual HMAC/AES-GCM output. */
    const protectedEvents = events.filter((event) => event.stage === 'protected')
    assert.ok(frames.length > 0)
    assert.ok(protectedEvents.length > 0)
    assert.ok(frames[0].content !== undefined)
    assert.ok(protectedEvents[0].content !== undefined)
    /** SC9(b): CBOR provides a comparison representation without mutating stored event content. */
    const frameBytes = encode(frames[0].content)
    /** SC9(b): compare the actual protected boundary representation to its clear frame. */
    const protectedBytes = encode(protectedEvents[0].content)
    assert.notDeepEqual(frameBytes, protectedBytes)
    /** The nonempty recording is decoded by the canonical frozen record owner. */
    const recording = decodeRpcDevtoolsRecord(text)
    assert.ok(recording.events.length > 0)
    hub.importRecord(CoreFixture.offline, text)
    /** Only the explicit acceptance tuple is compared; original event content is never cloned. */
    const expectedSequence = recording.events.map((event) => [
      event.seq,
      event.stage,
      event.kind,
      event.outcome,
      event.method
    ])
    /** Offline import must preserve the actual recorded sequence, including missing optional fields. */
    const actualSequence = hub
      .timeline({ targets: [CoreFixture.offline] })
      .map((item) => [
        item.event.seq,
        item.event.stage,
        item.event.kind,
        item.event.outcome,
        item.event.method
      ])
    assert.deepEqual(actualSequence, expectedSequence)
    /** Evidence is emitted only after each applicable local/record assertion actually passes. */
    console.error(
      JSON.stringify({
        acceptance: 'A-total applicable direct-Core local capture and service-record/offline-hub',
        result,
        localEvents: events.length,
        localFrameEvents: frames.length,
        localProtectedEvents: protectedEvents.length,
        localFrameDiffersFromProtected: true,
        remoteRecordEvents: recording.events.length,
        offlineSequencePreserved: true,
        liveServiceQuery: 'pending'
      })
    )
    /** The original genuine service query stays RED; no payload adaptation or expected-failure path. */
    await hub.addTarget(CoreFixture.target, {
      request: (method, payload) =>
        serviceClient.request(CoreFixture.servicePrefix + method, payload),
      stream: (method, payload) => serviceClient.stream(CoreFixture.servicePrefix + method, payload)
    })
    /**
     * A future owning-source fix must still deliver nonempty actual metadata and an ordered
     * timeline.
     */
    const timeline = hub.timeline({ targets: [CoreFixture.target] })
    assert.ok(timeline.length > 0)
    for (let index = 1; index < timeline.length; index++)
      assert.ok(timeline[index].alignedAt >= timeline[index - 1].alignedAt)
    collector.close()
    /** Closed observation must leave the same genuine public business call result unchanged. */
    const afterCollectorClose = await client.request(FixtureMethod.increment, 40)
    assert.equal(afterCollectorClose, result)
    return {
      events: timeline.length,
      frameEvents: frames.length,
      protectedEvents: protectedEvents.length,
      localFrameDiffersFromProtected: true,
      orderedTimeline: true,
      recordingEvents: recording.events.length,
      recordingSequencePreserved: true,
      result,
      afterCollectorClose
    }
  } finally {
    collector.close()
    await hub.close()
    await Promise.all(peers.map((peer) => peer.close()))
    business.port1.close()
    business.port2.close()
    diagnostic.port1.close()
    diagnostic.port2.close()
  }
}
