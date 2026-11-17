/** Contract snapshots describe the actual supported authoring and capability boundaries. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as root from '@migaia/rpc-host'
import * as sdk from '@migaia/rpc-host/sdk'
import * as features from '@migaia/rpc-host/features'
import * as plugins from '@migaia/rpc-host/plugins'

/** These are the exact publication paths declared by core3.6, without legacy entry aliases. */
const expectedEntries = [
  '.',
  './contract',
  './features',
  './features/auth',
  './features/batch',
  './features/chunk',
  './features/error-map',
  './features/idempotency',
  './features/limits',
  './features/retry',
  './features/schema',
  './features/timeout',
  './plugins',
  './plugins/probe',
  './plugins/typegen',
  './sdk'
]

/** Root owns Host construction and warnings; contract diagnostics live at the contract entry. */
const expectedRoot = ['RpcWarningCode', 'createRpcHost', 'defaultRpcReporter']

/** SDK owns native authoring, codecs and shared generations, without business Peer facades. */
const expectedSdk = [
  'HostObservationKind',
  'IpcReporterContext',
  'RPC_STREAM_MAX_FRAME_BYTES',
  'RpcBinaryProfile',
  'RpcBinaryStorage',
  'RpcBytePump',
  'RpcCarrierObservation',
  'RpcEventByteIO',
  'RpcJsonCarrierCodec',
  'RpcMemberConnectionDirection',
  'RpcMemberEventName',
  'RpcMemberGeneration',
  'RpcMemberMetricScope',
  'RpcMemberMetricUnit',
  'RpcMemberQueryClock',
  'RpcMemberQueryLimit',
  'RpcMemberQueryReason',
  'RpcMemberQueryStatus',
  'RpcMemberRecentKind',
  'RpcMemberResourceKind',
  'RpcMemberSourceKind',
  'RpcMemberStopSignal',
  'RpcNativeFeatureKind',
  'RpcNativeMemberKind',
  'RpcNativeMembers',
  'RpcNativePoolMember',
  'RpcPortableCapture',
  'RpcProtocolEvent',
  'RpcUtf8',
  'createRpcBackingDigest',
  'createRpcByteCarrier',
  'createRpcMessageCarrier',
  'createRpcStreamFrameDecoder',
  'createRpcStreamFrameDecoderWithLimit',
  'defaultRpcId',
  'defineFlowPlugin',
  'defineTransportPlugin',
  'encodeRpcStreamFrame',
  'encodeRpcStreamTextFrame',
  'hasRpcPortableBinary',
  'joinRpcPreparedMetadata',
  'portableBytes',
  'prepareRpcBinary',
  'readRpcLaunchFacts',
  'resolveAbortReason',
  'resolveRpcEntry',
  'restoreRpcBinary',
  'retainRpcRuntimeFlags',
  'rpcMemberConnectionDetail',
  'rpcMemberCounters',
  'rpcMemberErrorIdentity',
  'rpcMemberMetric',
  'rpcMemberResources',
  'rpcMemberUnavailable',
  'splitRpcPreparedMetadata',
  'withRpcLaunchFacts',
  'RpcFlowLayer',
  'RpcFlowPoint',
  'defineFlowFeature',
  'defineRpcSourcePlugin',
  'isRpcCarrierAdmissionFailure',
  'markRpcCarrierAdmissionFailure',
  'registerRpcNativeFeature',
  'readRpcFeature',
  'findRpcNativeFeatureOutput',
  'rpcHostPipelines'
]

/** Every Feature factory, call policy or flow capability, is published from the features entry. */
const expectedFeatures = [
  'authFeature',
  'batchFeature',
  'chunkFeature',
  'createRpcIdempotencyStore',
  'errorMapFeature',
  'idempotencyFeature',
  'limitsFeature',
  'retryFeature',
  'schemaFeature',
  'timeoutFeature'
]

/** Only host-level observer plugins remain at the plugins entry. */
const expectedPlugins = ['defineProbe', 'probe', 'typegen']

it('publishes exactly the final Host package entries and runtime symbols', () => {
  /** This real manifest is independent of generated export metadata. */
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(new Set(Object.keys(manifest.exports))).toEqual(new Set(expectedEntries))
  expect(new Set(Object.keys(root))).toEqual(new Set(expectedRoot))
  expect(new Set(Object.keys(sdk))).toEqual(new Set(expectedSdk))
  expect(new Set(Object.keys(features))).toEqual(new Set(expectedFeatures))
  expect(new Set(Object.keys(plugins))).toEqual(new Set(expectedPlugins))
  expect(sdk).not.toHaveProperty('registerJsonObjectPort')
  expect(sdk).not.toHaveProperty('registerBatchAgreement')
  for (const removed of [
    'holdAdapterRegistration',
    'RpcEndpointStatus',
    'validateAdapterPeerMethods',
    'validateAdapterPeerTimeout'
  ])
    expect(sdk).not.toHaveProperty(removed)
})

it('publishes the same feature factory through its named and default entry', async () => {
  for (const [name, factory] of [
    ['auth', 'authFeature'],
    ['batch', 'batchFeature'],
    ['chunk', 'chunkFeature'],
    ['error-map', 'errorMapFeature'],
    ['idempotency', 'idempotencyFeature'],
    ['limits', 'limitsFeature'],
    ['retry', 'retryFeature'],
    ['schema', 'schemaFeature'],
    ['timeout', 'timeoutFeature']
  ] as const) {
    /** Resolve the actual package subpath rather than a test alias or source module. */
    const entry = await import(`@migaia/rpc-host/features/${name}`)
    expect(entry.default).toBe(features[factory])
  }
  for (const name of ['probe', 'typegen'] as const) {
    /** Each observer plugin has the same factory at its index and named entry. */
    const entry = await import(`@migaia/rpc-host/plugins/${name}`)
    expect(entry.default).toBe(plugins[name])
  }
})
