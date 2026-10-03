import { expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile } from '../../../src/contract/index.js'
import { RpcCapability } from '../../../src/contract/wire-constants.js'
import { createMemoryTransportPair } from '../../../src/core/adapters/memory.js'
import { createFullOneWayEndpoint } from '../../../src/core/index.js'
import { connect } from '../../../src/core/middleware/connect.js'
import { registerBatchAgreement } from '../../../src/core/internal/batch-frame.js'

it('[A28] reports each rejected batch member independently when replay refusal cannot be written', async () => {
  /** The fixture grants the same static factory agreement consumed by the physical receiver. */
  const [peer, transport] = createMemoryTransportPair()
  registerBatchAgreement(transport, [RpcCapability.batch])
  /** Capture actual physical response attempts before a controlled host failure. */
  const send = transport.send
  /** Preserves exact native failure identity across both member reports. */
  const cause = new Error('fixture refusal write failure')
  /** Records the seed response and each refused member's physical write attempt. */
  const writes: unknown[] = []
  /** Switches the physical fixture from seed success to refusal-write rejection. */
  let fail = false
  transport.send = (value, options) => {
    writes.push(value)
    if (fail) return Promise.reject(cause)
    return send(value, options)
  }
  /** One accepted request fills the unchanged per-peer replay ledger. */
  let calls = 0
  /** Owns the real receiver with one per-peer replay slot. */
  const endpoint = await createFullOneWayEndpoint({
    id: 'b',
    transport,
    providerLimits: { maxReplayEntriesPerPeer: 1 },
    provider: {
      echo: (context) => {
        calls += 1
        return context.success(context.data)
      }
    },
    middlewares: [connect({ transport })]
  })
  /** Original failures remain observable through the actual receiver hook channel. */
  const failures: unknown[] = []
  /** Releases only this test's diagnostic subscription. */
  const remove = endpoint.hooks.on((event) => {
    if (event.name === 'failure') failures.push(event.error)
  })
  /** Canonical semantic IDs are separate even when both share a physical frame. */
  const request = (id: string) =>
    normalizeRpcEnvelope({
      kind: 'request',
      id,
      method: 'echo',
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'request',
          applicationVersion: '1',
          senderId: 'a',
          targetId: 'b',
          receiverId: 'b',
          sentAt: 0
        },
        payload: id
      }
    })
  try {
    await peer.send(request('seed'))
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(calls).toBe(1)
    fail = true
    await peer.send({ kind: 'batch', envelopes: [request('one'), request('two')] })
    await vi.waitFor(() =>
      expect(
        failures.filter((error) => (error as { code?: string }).code === 'TRANSPORT')
      ).toHaveLength(2)
    )
    expect(calls).toBe(1)
    expect(writes).toHaveLength(3)
    expect(writes.slice(1)).toEqual([
      expect.objectContaining({ id: 'one', ok: false, code: 'OVERLOADED' }),
      expect.objectContaining({ id: 'two', ok: false, code: 'OVERLOADED' })
    ])
    expect(failures).toHaveLength(3)
    expect(
      failures.filter((error) => (error as { code?: string }).code === 'OVERLOADED')
    ).toHaveLength(1)
    for (const error of failures.filter(
      (error) => (error as { code?: string }).code === 'TRANSPORT'
    ))
      expect(error).toMatchObject({ code: 'TRANSPORT', cause })
  } finally {
    remove()
    transport.send = send
    await endpoint.dispose()
    peer.close()
  }
})
