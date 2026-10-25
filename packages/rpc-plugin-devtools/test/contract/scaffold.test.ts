import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  devtoolsPlugin,
  RpcDevtoolsErrorCode,
  RPC_DEVTOOLS_SOURCE
} from '@migaia/rpc-plugin-devtools'
import {
  decodeRpcDevtoolsRecord,
  encodeRpcDevtoolsRecord
} from '../../src/contract/record-codec.js'
import { RpcDevtoolsRecordFormat } from '../../src/contract/record.js'
import type {
  IRpcDevtoolsCounters,
  IRpcDevtoolsServiceApi,
  IRpcDevtoolsStats
} from '../../src/contract/service.js'
import type { IRpcNamespace } from '@migaia/rpc-host'

/** A typed namespace must preserve the service's concrete stats result across the public API. */
function requestStats(
  namespace: IRpcNamespace<IRpcDevtoolsServiceApi>
): Promise<IRpcDevtoolsStats> {
  return namespace.send('service', 'stats')
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

describe('public scaffold', () => {
  it('imports the collector and record codec and preserves its CLOSED identity', async () => {
    /** The integrated layer replaces both placeholders with live owners and real closure. */
    const collector = devtoolsPlugin().collector
    expect(collector.query().events).toEqual([])
    collector.close()
    expect(() => collector.query()).toThrowError(
      expect.objectContaining({ source: RPC_DEVTOOLS_SOURCE, code: RpcDevtoolsErrorCode.closed })
    )
    expect(decodeRpcDevtoolsRecord(service.record.stop())).toEqual({
      header: RpcDevtoolsRecordFormat,
      events: []
    })
  })

  it('retains a typed service implementation and typed namespace stats request', () => {
    expect(service.stats()).toEqual({ since: 0, methods: [] })
    expectTypeOf(requestStats).returns.toEqualTypeOf<Promise<IRpcDevtoolsStats>>()
  })
})
