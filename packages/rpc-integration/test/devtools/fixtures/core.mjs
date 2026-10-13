import assert from 'node:assert/strict'
import { MessageChannel } from 'node:worker_threads'
import { encode } from 'cborg'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import {
  createRuntimeApiEndpoint,
  codec,
  framer,
  authentication,
  abort,
  timeout,
  hooks,
  ping,
  connect
} from '@migaia/rpc-core'
import { RpcProbeStageName } from '@migaia/rpc-core/probe'
import { createNativeProcessOffer, createProcessTransport } from '@migaia/rpc-process'
import {
  listenProcessByteChannel,
  dialProcessByteChannel
} from '@migaia/rpc-process/adapters/node-socket'
import {
  CapabilityLevel,
  StandardCapability,
  SupervisionErrorCode,
  SUPERVISION_SOURCE
} from '@migaia/supervision'
import { createNodeThreadChannel } from '@migaia/rpc-threads'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRpcDevtools } from '@migaia/rpc-devtools'
import { createRpcDevtoolsHub } from '@migaia/rpc-devtools/hub'
import { decodeRpcDevtoolsRecord } from '@migaia/rpc-devtools/contract'
import { fixtureAuthentication, reportFailure } from './auth.mjs'
import { FixtureMethod, FixtureTrace, fixtureServiceId, fixtureServiceClientId } from './text.mjs'

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
 * Captured content is kept by the collector; the original service alone owns portable conversion.
 *
 * @returns {Promise<{
 *   events: number
 *   frameEvents: number
 *   protectedEvents: number
 *   localFrameDiffersFromProtected: boolean
 *   orderedTimeline: boolean
 *   recordingEvents: number
 *   recordingSequencePreserved: boolean
 *   metadataContentHidden: boolean
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
    stages: RpcProbeStageName,
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
        liveServiceQuery: 'next real assertion'
      })
    )
    /** The original genuine service query remains unchanged; no fixture result adaptation is used. */
    await hub.addTarget(CoreFixture.target, {
      request: (method, payload) =>
        serviceClient.request(CoreFixture.servicePrefix + method, payload),
      stream: (method, payload) => serviceClient.stream(CoreFixture.servicePrefix + method, payload)
    })
    /** Service-owned metadata must remain nonempty, ordered and free of captured content. */
    const timeline = hub.timeline({ targets: [CoreFixture.target] })
    assert.ok(timeline.length > 0)
    for (const item of timeline) assert.equal(Object.hasOwn(item.event, 'content'), false)
    for (let index = 1; index < timeline.length; index++)
      assert.ok(timeline[index].alignedAt >= timeline[index - 1].alignedAt)
    await hub.close()
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
      metadataContentHidden: true,
      result,
      afterCollectorClose
    }
  } finally {
    await hub.close()
    collector.close()
    await Promise.all(peers.map((peer) => peer.close()))
    business.port1.close()
    business.port2.close()
    diagnostic.port1.close()
    diagnostic.port2.close()
  }
}

/**
 * Report native classification and fail every report except the existing termination warning.
 *
 * @param {string} host Actual producing fixture host.
 * @returns {{ report(error: unknown): void; reports: object[] }} Host-owned reporter and scalar
 *   receipts.
 * @throws {Error} Unexpected reports retain their original exception; console failures propagate.
 */
export function createFixtureReporter(host) {
  /** Receipts are diagnostic boundary objects, never substitute probe events. */
  const reports = []
  return {
    reports,
    /**
     * Classify the original owner error without swallowing a failed operation.
     *
     * @param {unknown} error Original native or observation failure.
     * @returns {void} Logs a full scalar receipt for the admitted environment warning.
     * @throws {unknown} Every unexpected reported error, without changing its identity.
     */
    report(error) {
      /** Exact source/code/detail come from the original supervision error. */
      const original = /**
       * @type {Error & {
       *   source?: string
       *   code?: string
       *   reason?: string
       *   detail?: { reason?: string; capability?: string; level?: string; kind?: string }
       * }}
       */ (error)
      /** Node currently declares process-tree termination unsupported under best-effort admission. */
      const warning =
        original?.source === SUPERVISION_SOURCE &&
        original.code === SupervisionErrorCode.capabilityUnsupported &&
        original.detail?.capability === StandardCapability.termination &&
        original.detail.level === CapabilityLevel.unsupported &&
        original.detail.kind === FixtureTrace.processKind
      /** Only public fixture material can appear in the fixture's own diagnostic message. */
      const receipt = {
        host,
        classification: warning ? FixtureTrace.warning : FixtureTrace.failure,
        source: original?.source ?? null,
        code: original?.code ?? null,
        name: original?.name ?? typeof error,
        reason: original?.reason ?? original?.detail?.reason ?? null,
        message: String(original?.message ?? error).replaceAll(FixtureTrace.token, '<REDACTED>'),
        capability: original?.detail?.capability ?? null,
        level: original?.detail?.level ?? null,
        kind: original?.detail?.kind ?? null
      }
      reports.push(receipt)
      console.error(JSON.stringify(receipt))
      if (!warning) throw error
    }
  }
}

/**
 * Capture every stage on an actual host while allowing its service to expose physical content.
 *
 * @param {(error: unknown) => void} report Host's original strict diagnostic reporter.
 * @returns {import('@migaia/rpc-devtools').IRpcDevtools} Independent genuine collector/probe.
 * @throws {Error} Original public collector configuration failure.
 */
export function createTraceCollector(report) {
  return createRpcDevtools({
    stages: RpcProbeStageName,
    capture: RpcProbeStageName,
    exposeContent: true,
    maxEvents: 4096,
    maxContentBytes: 1_048_576,
    onError: report
  })
}

/**
 * Retain the real public Endpoint for explicit caller-owned trace sends on an existing Peer.
 *
 * @param {string} id Exact configured self.instanceId of this outgoing Peer.
 * @param {(endpoint: import('@migaia/rpc-core').IRpcEndpoint, peerId: string) => void} ready
 *   Receives the actual completed endpoint and channel peer address.
 * @param {(error: unknown) => void} report Original host diagnostic reporter.
 * @returns {NonNullable<import('@migaia/rpc-core/remote').IRuntimePeerOptions['endpointFactory']>}
 *   Public custom assembly callback.
 * @throws {Error} Original canonical endpoint construction or readiness failure.
 */
export function traceEndpointFactory(id, ready, report) {
  return async (channel) => {
    /** The factory reuses every actual negotiated pipeline and IPC Feature from the channel owner. */
    const endpoint = createRuntimeApiEndpoint(
      {
        id,
        scheduler: channel.scheduler,
        transport: channel.transport,
        targetIds: [channel.peerId],
        features: channel.features,
        middlewares: [
          codec(channel.pipeline.codec),
          framer(channel.pipeline.framer),
          authentication(fixtureAuthentication()),
          abort(),
          timeout(),
          hooks({ onHookError: report }),
          ping(),
          connect({ transport: channel.transport })
        ]
      },
      channel
    )
    await endpoint.ready
    ready(endpoint, channel.peerId)
    return {
      endpoint: /** @type {import('@migaia/rpc-core').IRpcEndpoint} */ (
        /** @type {unknown} */ (endpoint)
      ),
      oneWay: endpoint,
      stream: endpoint.stream
    }
  }
}

/**
 * Expose one actual collector through separate unprobed socket Peers in its native host.
 *
 * @param {import('@migaia/rpc-devtools').IRpcDevtools} collector Collector whose original service
 *   is mounted unchanged.
 * @param {string} host Canonical parent, child or worker name.
 * @param {(error: unknown) => void} report Original strict host reporter.
 * @returns {Promise<{ address: string; id: string; close(): Promise<void> }>} Bound listener
 *   descriptor and cleanup of its accepted Peers.
 * @throws {Error} Original socket, authenticated handshake, Peer or cleanup failure.
 */
export async function startFixtureService(collector, host, report) {
  /** Explicit service identity belongs to this independently constructed diagnostic endpoint. */
  const id = fixtureServiceId(host)
  /** This one application client uses a distinct actual handshake identity per target. */
  const clientId = fixtureServiceClientId(host)
  /** The native listener closes pending accepts; this fixture owns the ready diagnostic Peers. */
  const peers = new Set()
  /** The public raw listener works even after the child's automatic stdio marker was consumed. */
  const listener = await listenProcessByteChannel({
    address: FixtureTrace.address,
    auth: {
      mode: 'required',
      /**
       * Admit only the fixture's actual diagnostic client and its local credential.
       *
       * @param {import('@migaia/rpc-contract').IRpcPortableValue | undefined} auth Native handshake
       *   credential.
       * @param {import('@migaia/rpc-contract').IRpcPeerInfo} peer Native handshake peer identity.
       * @returns {string} Verified diagnostic client principal.
       * @throws {Error} Concrete credential or route-identity assertion failure.
       */
      verify(auth, peer) {
        assert.equal(auth, FixtureTrace.token)
        assert.equal(peer.id, clientId)
        return clientId
      }
    },
    report,
    /**
     * Construct one genuine service Peer over this accepted native socket resource.
     *
     * @param {import('@migaia/rpc-process').IProcessPendingByteConnection} pending Original
     *   listener-owned pending connection.
     * @returns {Promise<void>} Resolves after the accepted Core directory is ready.
     * @throws {Error} Original authenticated accept, endpoint or directory failure.
     */
    async onConnection(pending) {
      /** Core completes the directory on the exact channel returned by the original socket accept. */
      const peer = await createRuntimePeer({
        self: { name: id, instanceId: id },
        provide: { devtools: collector.service },
        authentication: fixtureAuthentication(),
        report,
        /**
         * Use Core's source offer on the original pending socket, without a prepared-context copy.
         *
         * @param {import('@migaia/rpc-core/remote').IRuntimePeerSourceContext} context Original
         *   local Core proposal.
         * @returns {Promise<import('@migaia/rpc-core/remote').IRuntimePeerSourceResult>} Actual
         *   accepted channel.
         * @throws {Error} Original native authenticated handshake failure.
         */
        connect: async (context) => {
          /** Ordinary authenticated acceptance uses Core's actual source capability offer. */
          const accepted = await pending.accept({
            peerId: clientId,
            offer: createNativeProcessOffer({
              peer: { id: context.self.instanceId, runtime: 'node' },
              capabilities: context.capabilities,
              stream: true
            }),
            scheduler: systemScheduler,
            report,
            ipc: { connectionId: id, sessionId: clientId, log: () => undefined }
          })
          return accepted.channel
        }
      })
      peers.add(peer)
    }
  })
  /** Repeated cleanup joins the one listener/Peer release operation. */
  let closing
  return {
    address: listener.address,
    id,
    /**
     * Stop new accepts before joining every actual ready diagnostic Peer close.
     *
     * @returns {Promise<void>} One idempotent native listener/Peer cleanup operation.
     * @throws {Error} Original listener or Peer cleanup rejection.
     */
    close() {
      return (closing ??= (async () => {
        await listener.close()
        await Promise.all([...peers].map((peer) => peer.close()))
        peers.clear()
      })())
    }
  }
}

/**
 * Connect the parent's unprobed public Peer to an actual bound diagnostic socket.
 *
 * @param {{ address: string; id: string }} target Descriptor returned by the original listener.
 * @param {string} host Target's canonical fixture name.
 * @param {(error: unknown) => void} report Original strict parent reporter.
 * @returns {Promise<import('@migaia/rpc-core/remote').IRuntimePeer>} Actual Core Peer over the
 *   public Process socket channel.
 * @throws {Error} Original dial, handshake, directory or endpoint failure.
 */
export async function connectFixtureService(target, host, report) {
  /** Source identity is explicit configuration, not reconstructed from a probe event. */
  const id = fixtureServiceClientId(host)
  return createRuntimePeer({
    self: { name: id, instanceId: id },
    authentication: fixtureAuthentication(),
    report,
    /**
     * Dial the published actual address and negotiate Core's original source offer.
     *
     * @param {import('@migaia/rpc-core/remote').IRuntimePeerSourceContext} context Original local
     *   source identity and capabilities.
     * @returns {Promise<import('@migaia/rpc-core/remote').IRuntimePeerSourceResult>} Actual
     *   initiated Process channel.
     * @throws {Error} Original native socket or authenticated handshake failure.
     */
    connect: async (context) => {
      /** The platform adapter owns the actual loopback socket resource. */
      const raw = await dialProcessByteChannel({ address: target.address })
      return createProcessTransport(raw, {
        role: 'initiator',
        peerId: target.id,
        offer: createNativeProcessOffer({
          peer: { id: context.self.instanceId, runtime: 'node' },
          auth: FixtureTrace.token,
          capabilities: context.capabilities,
          stream: true
        }),
        scheduler: systemScheduler,
        report,
        ipc: { connectionId: id, sessionId: target.id, log: () => undefined }
      })
    }
  })
}

/**
 * Prove self-filtering with actual service traffic on an additional local observed endpoint.
 *
 * @param {import('@migaia/rpc-devtools').IRpcDevtools} collector Parent's original collector.
 * @param {(error: unknown) => void} report Original strict parent reporter.
 * @returns {Promise<boolean>} True only after real service traffic is absent by actual endpoint
 *   identity.
 * @throws {Error} Original Peer, service, assertion or cleanup failure.
 */
export async function proveFixtureSelfFilter(collector, report) {
  /** This real local carrier requires no native launch and contributes no fabricated event view. */
  const ports = new MessageChannel()
  /** Only the service endpoint receives the parent collector as its actual probe. */
  const peers = await Promise.all([
    createRuntimePeer({
      self: { name: FixtureTrace.selfClient, instanceId: FixtureTrace.selfClient },
      report,
      connect: async (context) =>
        createNodeThreadChannel(ports.port1, FixtureTrace.selfProvider, {
          scheduler: systemScheduler,
          capabilities: context.capabilities
        })
    }),
    createRuntimePeer({
      self: { name: FixtureTrace.selfProvider, instanceId: FixtureTrace.selfProvider },
      probe: collector,
      provide: { devtools: collector.service },
      report,
      connect: async (context) =>
        createNodeThreadChannel(ports.port2, FixtureTrace.selfClient, {
          scheduler: systemScheduler,
          capabilities: context.capabilities
        })
    })
  ])
  try {
    /** Construction must actually produce observations before the first service identity is known. */
    assert.ok(
      collector
        .describe()
        .descriptors.some((descriptor) => descriptor.endpointId === peers[1].self.instanceId)
    )
    assert.ok(
      collector.query().events.some((event) => event.endpointId === peers[1].self.instanceId)
    )
    await peers[0].request(FixtureTrace.servicePrefix + 'describe')
    /** The remote query crosses the original service context before this actual identity assertion. */
    const page = await peers[0].request(FixtureTrace.servicePrefix + 'query')
    assert.equal(
      page.events.some((event) => event.endpointId === peers[1].self.instanceId),
      false
    )
    assert.equal(
      collector.query().events.some((event) => event.endpointId === peers[1].self.instanceId),
      false
    )
    return true
  } finally {
    await Promise.all(peers.map((peer) => peer.close()))
    ports.port1.close()
    ports.port2.close()
  }
}

/**
 * Inspect the real live targets after their catch-up queries complete, without guessed delays.
 *
 * @param {readonly { host: string; peer: import('@migaia/rpc-core/remote').IRuntimePeer }[]} services
 *   Connected unprobed service clients.
 * @param {string} recording Parent's actual service-exported recording text.
 * @param {(error: unknown) => void} report Original strict parent reporter.
 * @returns {Promise<{
 *   hops: object[]
 *   orderedTimeline: boolean
 *   recordingEvents: number
 *   recordingSequencePreserved: boolean
 * }>}
 *   Actual two-hop, carrier and record evidence.
 * @throws {Error} Original live service, hub, codec, assertion or cleanup failure.
 */
export async function proveLiveTrace(services, recording, report) {
  /** The hub receives already connected clients and never acquires a transport itself. */
  const hub = createRpcDevtoolsHub({ onError: report })
  try {
    for (const service of services)
      await hub.addTarget(service.host, {
        request: (method, payload) =>
          service.peer.request(FixtureTrace.servicePrefix + method, payload),
        stream: (method, payload) =>
          service.peer.stream(FixtureTrace.servicePrefix + method, payload)
      })
    /** Only genuine caller-provided T1 membership may select the two actual interactions. */
    const interactions = hub.interactions(FixtureTrace.id)
    assert.equal(interactions.length, 2)
    assert.deepEqual(
      interactions.map((hop) => hop.method).sort(),
      [FixtureMethod.cascade, FixtureMethod.increment].sort()
    )
    /** Receipt projections exist only at this explicit acceptance boundary (SC9b). */
    const hops = interactions.map((hop) => {
      assert.equal(hop.oneSided, false)
      assert.ok(
        hop.events.some(
          (item) =>
            item.event.stage === 'message' &&
            item.event.direction === 'outbound' &&
            item.event.kind === 'request'
        )
      )
      assert.ok(
        hop.events.some(
          (item) =>
            item.event.stage === 'message' &&
            item.event.direction === 'inbound' &&
            item.event.kind === 'request'
        )
      )
      /** Each hop retains actual production at all five physical/logical expansion stages. */
      const stages = [...new Set(hop.events.map((item) => item.event.stage))]
      for (const stage of ['envelope', 'encoded', 'frame', 'protected', 'carrier'])
        assert.ok(stages.includes(stage))
      /** Carrier provenance is checked in both directions inside the exact same interaction. */
      const outgoing = hop.events.filter(
        (item) => item.event.stage === 'carrier' && item.event.direction === 'outbound'
      )
      const incoming = hop.events.filter(
        (item) => item.event.stage === 'carrier' && item.event.direction === 'inbound'
      )
      assert.ok(outgoing.length > 0)
      assert.ok(incoming.length > 0)
      for (const item of outgoing) {
        assert.equal(item.event.trace, FixtureTrace.id)
        assert.ok(item.event.messageId)
        assert.ok(item.event.senderId)
      }
      for (const item of incoming)
        assert.ok(
          hop.events.some(
            (linked) =>
              linked.target === item.target &&
              (linked.event.stage === 'protected' || linked.event.stage === 'frame') &&
              linked.event.carrierSeq === item.event.seq
          )
        )
      /** Compare the clear/protected representations of one matching actual outbound frame. */
      const frame = hop.events.find(
        (item) => item.event.stage === 'frame' && item.event.direction === 'outbound'
      )
      assert.ok(frame)
      const protectedFrame = hop.events.find(
        (item) =>
          item.event.stage === 'protected' &&
          item.event.direction === 'outbound' &&
          item.target === frame.target &&
          item.event.endpointId === frame.event.endpointId &&
          item.event.messageId === frame.event.messageId &&
          item.event.chunk?.index === frame.event.chunk?.index
      )
      assert.ok(protectedFrame)
      assert.notEqual(frame.event.content, undefined)
      assert.notEqual(protectedFrame.event.content, undefined)
      assert.notDeepEqual(frame.event.content, protectedFrame.event.content)
      return {
        method: hop.method,
        stages,
        outboundCarriers: outgoing.length,
        inboundCarriers: incoming.length,
        frameContentDiffers: true
      }
    })
    /** Aligned ordering is tested on the actual trace-filtered live timeline. */
    const timeline = hub.timeline({ trace: FixtureTrace.id })
    assert.ok(timeline.length > 0)
    for (let i = 1; i < timeline.length; i++)
      assert.ok(timeline[i].alignedAt >= timeline[i - 1].alignedAt)
    /** Only the public record codec restores the actual exported parent window. */
    const decoded = decodeRpcDevtoolsRecord(recording)
    assert.ok(decoded.events.length > 0)
    hub.importRecord(FixtureTrace.offline, recording)
    /** The oracle compares only the specified stable tuple, without cloning retained content. */
    const expected = decoded.events.map((event) => [
      event.seq,
      event.stage,
      event.kind,
      event.outcome,
      event.method
    ])
    const actual = hub
      .timeline({ targets: [FixtureTrace.offline] })
      .map((item) => [
        item.event.seq,
        item.event.stage,
        item.event.kind,
        item.event.outcome,
        item.event.method
      ])
    assert.deepEqual(actual, expected)
    return {
      hops,
      orderedTimeline: true,
      recordingEvents: decoded.events.length,
      recordingSequencePreserved: true
    }
  } finally {
    await hub.close()
  }
}
