/** BC3/BC5 contract snapshots describe the actual supported authoring and capability boundaries. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as root from '@migaia/rpc-host'
import * as sdk from '@migaia/rpc-host/sdk'
import * as features from '@migaia/rpc-host/features'
import * as plugins from '@migaia/rpc-host/plugins'

/** These are the exact publication paths declared by core3.6, without legacy entry aliases. */
const expectedEntries = [
  '.',
  './features',
  './features/retry',
  './features/timeout',
  './plugins',
  './plugins/auth',
  './plugins/batch',
  './plugins/chunk',
  './plugins/idempotency',
  './plugins/limits',
  './plugins/link-policy',
  './plugins/probe',
  './plugins/schema',
  './plugins/typegen',
  './sdk'
]

/** Root owns construction, lifetime and public error diagnostics; code tables belong to Contract. */
const expectedRoot = [
  'RPC_CORE_ERROR_SOURCE',
  'RpcLifecycleError',
  'createRpcHost',
  'defaultRpcReporter',
  'isRpcError',
  'isRpcErrorInstance',
  'isRpcRemoteError',
  'isRpcTimeoutError'
]

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
  'defineLinkPolicy',
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
  'withRpcLaunchFacts'
]

/** Optional flow behavior is published only through its actual owning plugin entry. */
const expectedPlugins = [
  'auth',
  'batch',
  'chunk',
  'createRpcIdempotencyStore',
  'defineProbe',
  'idempotency',
  'limits',
  'linkPolicy',
  'probe',
  'schema',
  'typegen'
]

it('publishes exactly the final Host package entries and runtime symbols', () => {
  /** This real manifest is independent of generated export metadata. */
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(new Set(Object.keys(manifest.exports))).toEqual(new Set(expectedEntries))
  expect(new Set(Object.keys(root))).toEqual(new Set(expectedRoot))
  expect(new Set(Object.keys(sdk))).toEqual(new Set(expectedSdk))
  expect(new Set(Object.keys(features))).toEqual(new Set(['retry', 'timeout']))
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
  for (const name of ['retry', 'timeout'] as const) {
    /** Resolve the actual package subpath rather than a test alias or source module. */
    const entry = await import(`@migaia/rpc-host/features/${name}`)
    expect(entry.default).toBe(features[name])
  }
  for (const name of [
    'auth',
    'batch',
    'chunk',
    'idempotency',
    'limits',
    'probe',
    'schema',
    'typegen'
  ] as const) {
    /** Each complete optional capability has the same factory at both supported entries. */
    const entry = await import(`@migaia/rpc-host/plugins/${name}`)
    expect(entry.default).toBe(plugins[name])
  }
  /** Camel-case factory and stable hyphenated subpath belong to the same link policy owner. */
  const entry = await import('@migaia/rpc-host/plugins/link-policy')
  expect(entry.default).toBe(plugins.linkPolicy)
})
