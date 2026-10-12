import { describe, expect, expectTypeOf, it } from 'vitest'
import { createRpcDevtools, RpcDevtoolsErrorCode, RPC_DEVTOOLS_SOURCE } from '@migaia/rpc-devtools'
import { createRpcDevtoolsHub, RpcDevtoolsTargetStatus } from '@migaia/rpc-devtools/hub'
import {
  decodeRpcDevtoolsRecord,
  encodeRpcDevtoolsRecord,
  RpcDevtoolsRecordFormat
} from '@migaia/rpc-devtools/contract'
import type {
  IRpcDevtoolsCounters,
  IRpcDevtoolsServiceApi,
  IRpcDevtoolsStats
} from '@migaia/rpc-devtools/contract'
import type { IRuntimeTypedPeer } from '@migaia/rpc-core/remote'

/** A typed Peer call must preserve the service's concrete stats result across the public API. */
function requestStats(peer: IRuntimeTypedPeer<IRpcDevtoolsServiceApi>): Promise<IRpcDevtoolsStats> {
  return peer.request('stats')
}

/** All counters required by the collector and contract exist in one declaration. */
const counters: IRpcDevtoolsCounters = {
  evicted: 0,
  contentDropped: 0,
  droppedReentrant: 0,
  sampledOut: 0,
  ignoredWhilePaused: 0,
  ignoredAfterClose: 0,
  internOverflow: 0
}

/** A real object-shaped fixture proves the nested service and async-generator contract compile. */
const service: IRpcDevtoolsServiceApi = {
  describe: () => ({
    version: '1',
    now: 0,
    paused: false,
    descriptors: [],
    limits: { maxEvents: 1, maxContentBytes: 0 },
    counters
  }),
  query: () => ({ events: [], nextSeq: 0, counters }),
  /** Empty stream satisfies the provider's declared async-generator result. */
  watch: async function* () {
    yield { events: [], dropped: 0 }
  },
  stats: () => ({ since: 0, methods: [] }),
  record: {
    start: () => {},
    stop: () => encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: [] })
  },
  clear: () => {},
  pause: () => {},
  resume: () => {}
}

describe('A3 public scaffold', () => {
  it('imports all three entries with the collector installed and the hub still uninstalled', () => {
    /** Layer 2 replaces only the collector placeholder; its live public host now owns closure. */
    const collector = createRpcDevtools()
    expect(collector.query().events).toEqual([])
    collector.close()
    expect(() => createRpcDevtoolsHub()).toThrowError(
      expect.objectContaining({ source: RPC_DEVTOOLS_SOURCE, code: RpcDevtoolsErrorCode.closed })
    )
    expect(RpcDevtoolsTargetStatus.offline).toBe('offline')
    expect(decodeRpcDevtoolsRecord(service.record.stop())).toEqual({
      header: RpcDevtoolsRecordFormat,
      events: []
    })
  })

  it('retains a typed service implementation and typed Peer stats request', () => {
    expect(service.stats()).toEqual({ since: 0, methods: [] })
    expectTypeOf(requestStats).returns.toEqualTypeOf<Promise<IRpcDevtoolsStats>>()
  })
})
