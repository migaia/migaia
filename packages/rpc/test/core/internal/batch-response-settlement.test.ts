import { expect, it, vi } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { createMemoryTransportPair } from '../../../src/core/adapters/memory.js'
import { createFullOneWayEndpoint } from '../../../src/core/index.js'
import { connect } from '../../../src/core/middleware/connect.js'
import { codec } from '../../../src/core/middleware/codec.js'
import { registerBatchAgreement } from '../../../src/core/internal/batch-frame.js'
import { getEndpointDebugSnapshotReader } from '../../../src/core/internal/test-observer.js'
import { RpcCapability, RpcBatchPhysical } from '../../../src/contract/wire-constants.js'
import type { IRpcEnvelope } from '../../../src/contract/index.js'

for (const customCodec of [false, true]) {
  it(`[R8-A1] one physical response batch settles two pending core requests (customCodec=${customCodec})`, async () => {
    /** Independent endpoint identities share the existing memory carrier and negotiated batch owner. */
    const [left, right] = createMemoryTransportPair()
    registerBatchAgreement(left, [RpcCapability.batch])
    registerBatchAgreement(right, [RpcCapability.batch])
    /** These are actual provider-produced response envelopes, never invented correlation IDs. */
    const replies: IRpcEnvelope[] = []
    /** Count the one physical batch that the caller must unpack. */
    const batches: unknown[] = []
    /** Preserve the provider carrier's original physical writer and ownership. */
    const send = right.send
    /** Group only actual provider replies at the existing public transport boundary. */
    right.send = (frame, options) => {
      /** Decoded physical grouping is distinct from each semantic response. */
      const physical = frame as { kind?: string; envelopes?: IRpcEnvelope[] }
      /** Preserve every provider-produced correlation ID and value. */
      const members =
        physical.kind === RpcBatchPhysical.kind ? physical.envelopes! : [frame as IRpcEnvelope]
      if (members.every((member) => member.kind === 'response')) {
        replies.push(...members)
        if (replies.length === 2) {
          /** One physical frame carries both independent replies to the caller. */
          const batch = { kind: RpcBatchPhysical.kind, envelopes: [...replies] }
          batches.push(batch)
          return send(batch, options)
        }
        return
      }
      return send(frame, options)
    }
    /** An ordinary codec wrapper preserves semantics but has no private fast-component identity. */
    const selectedCodec = {
      ...identityCodecV1,
      encode: (value: unknown) => value,
      decode: (value: unknown) => value
    }
    /** Diagnostics expose rejected batch parsing without changing receiver behavior. */
    const failures: unknown[] = []
    /** Caller construction retains ordinary source and request ownership. */
    const caller = await createFullOneWayEndpoint({
      id: 'caller',
      transport: left,
      middlewares: [connect({ transport: left }), ...(customCodec ? [codec(selectedCodec)] : [])]
    })
    /** The actual provider generates responses through the unchanged canonical sender. */
    const provider = await createFullOneWayEndpoint({
      id: 'provider',
      transport: right,
      provider: { echo: (context) => context.success(context.data) },
      middlewares: [connect({ transport: right })]
    })
    /** Remove the original diagnostic subscription before closing this fixture. */
    const remove = caller.hooks.on((event) => {
      if (event.name === 'failure') failures.push(event.error)
    })
    /** Keep pending rejections observed during RED cleanup without making them successful results. */
    const values = new Map<string, unknown>()
    /** Cleanup observes rejected requests while preserving failed results as failures. */
    const errors: unknown[] = []
    try {
      /** Each continuation remains attached to its own original request identity. */
      const calls = ['first', 'second'].map((payload) =>
        caller.send('provider', 'echo', payload).then(
          (value) => {
            values.set(payload, value)
          },
          (error: unknown) => {
            errors.push(error)
          }
        )
      )
      await vi.waitFor(() => expect(batches).toHaveLength(1))
      expect(replies).toHaveLength(2)
      expect(new Set(replies.map((reply) => reply.id)).size).toBe(2)
      // Observation alone waits for the receiver; no request is retried and no RPC deadline is changed.
      await vi.waitFor(() =>
        expect(Object.fromEntries(values), '[R8-A1] both batched response IDs must settle').toEqual(
          { first: 'first', second: 'second' }
        )
      )
      await Promise.all(calls)
      expect(getEndpointDebugSnapshotReader(caller)!().pending).toBe(0)
      expect(errors).toEqual([])
      expect(failures).toEqual([])
    } finally {
      remove()
      right.send = send
      await Promise.all([caller.dispose(), provider.dispose()])
      left.close()
      right.close()
    }
  })
}
