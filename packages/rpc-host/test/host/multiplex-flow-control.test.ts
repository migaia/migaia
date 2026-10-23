import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { createHostMultiplexTransport } from '../../dist/runtime-adapter/host-multiplex.js'
import { attachIpcConnection } from '../../dist/runtime-adapter/byte/ipc-connection.js'
import { readOutboundGate } from '../../dist/core/internal/outbound-gate.js'
import { envelope } from '../core/fixtures/physical-batch-envelope.js'
import type { IRpcTransport } from '../../dist/core/transport.js'

/** Native IPC construction retains the existing gate, log sink and physical close receipt. */
function connection(peerId: string, send: IRpcTransport['send']) {
  /** One actual canonical installation supplies capacity; the mux must not build another queue. */
  const records = vi.fn()
  /** This native sender is intentionally controllable without replacing the canonical gate. */
  const ipc = attachIpcConnection(
    { platform: 'Memory', send, subscribe: () => () => undefined },
    {
      connectionId: peerId,
      sessionId: peerId,
      maxPendingData: 1,
      maxPendingControl: 1,
      log: records
    },
    vi.fn()
  )
  return {
    ipc,
    records,
    channel: {
      ...ipc,
      peerId,
      scheduler: systemScheduler,
      agreement: { source: 'static' as const, codec: identityCodec.id, capabilities: [] },
      pipeline: { codec: identityCodec, framer: messageFramerV1 }
    }
  }
}

describe('host multiplexed IPC admission', () => {
  it('uses each original envelope gate and log once while an unrelated physical peer remains writable', async () => {
    /** One physical send remains busy so the real configured data capacity is observable. */
    const released = deferred<void>()
    /** Native invocation is a positive control before attempting the second data envelope. */
    const started = deferred<void>()
    /** B has one occupied data lane; C has an independent original gate. */
    const b = connection('b', () => {
      started.resolve()
      return released.promise
    })
    /** A separate peer must settle while B is still blocked. */
    const writeC = vi.fn()
    /** No shadow copy of B's capacity is used for C. */
    const c = connection('c', writeC)
    /** The logical transport retains only the existing physical receipts and subscriptions. */
    const mux = createHostMultiplexTransport({ name: 'a', instanceId: 'a' }, vi.fn())
    mux.attach(b.channel)
    mux.attach(c.channel)
    /** The same private gate port is consumed by the real core sender. */
    const gate = readOutboundGate(mux.channel.transport)
    try {
      expect(gate).toBeDefined()
      /** One admitted envelope covers all physical preparation and writing. */
      const first = envelope('busy')
      /** The sender's already selected target remains out of band at the physical boundary. */
      const pending = gate!.run(first, () => mux.channel.transport.send(first, { targetId: 'b' }))
      await started.promise
      await expect(gate!.run(envelope('full'), vi.fn())).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      /** A distinct target does not wait on B's accepted physical send. */
      const base = envelope('independent')
      /** Target selection is immutable when handed to the original gate. */
      const other = normalizeRpcEnvelope({
        ...base,
        data: { ...base.data, route: { ...base.data.route, targetId: 'c' } }
      })
      await gate!.run(other, () => mux.channel.transport.send(other, { targetId: 'c' }))
      expect(writeC).toHaveBeenCalledTimes(1)
      expect(
        b.records.mock.calls.filter(([record]) => record.name === 'ipc.backlog.rejected')
      ).toHaveLength(1)
      released.resolve()
      await pending
      expect(
        b.records.mock.calls.filter(([record]) => record.name === 'ipc.backlog.high')
      ).toHaveLength(1)
      await mux.close()
      /** Native cleanup belongs to the actual receipts and is not claimed by logical detach. */
      await b.ipc.close()
      await c.ipc.close()
    } finally {
      released.resolve()
      await mux.close()
      await b.ipc.close()
      await c.ipc.close()
    }
  })
})
