import { describe, expect, it } from 'vitest'
import { createRpcIdempotencyStore } from '../../src/core/index.js'

describe('idempotency store (A7)', () => {
  it('counts nested portable bytes before retaining a result', () => {
    const store = createRpcIdempotencyStore({ maxOutcomeBytes: 19 })
    const retained = store.claim('peer', 'count:bytes', 0)
    if (retained.status !== 'claimed') throw new Error('claim fixture failed')
    const outcome = {
      ok: true as const,
      data: [{ $rpc: 'bytes' as const, base64url: 'AQID' }, null, true]
    }
    retained.settle(outcome, 1)
    expect(store.claim('peer', 'count:bytes', 2)).toEqual({ status: 'done', outcome })
    const oversized = store.claim('peer', 'count:text', 2)
    if (oversized.status !== 'claimed') throw new Error('claim fixture failed')
    oversized.settle({ ok: true, data: 'x'.repeat(20) }, 3)
    expect(store.claim('peer', 'count:text', 4)).toEqual({
      status: 'done',
      outcome: 'unavailable'
    })
  })

  it('bounds each scope and rejects invalid store capacity', () => {
    expect(() => createRpcIdempotencyStore({ maxEntries: 0 })).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    const store = createRpcIdempotencyStore({ maxEntries: 2, maxEntriesPerScope: 1 })
    const first = store.claim('one', 'count:a', 0)
    expect(first.status).toBe('claimed')
    expect(store.claim('one', 'count:b', 0).status).toBe('full')
    expect(store.claim('two', 'count:b', 0).status).toBe('claimed')
    if (first.status !== 'claimed') return
    first.release()
    expect(store.claim('one', 'count:b', 1).status).toBe('claimed')
    first.settle({ ok: true, data: 1 }, 2)
    expect(store.claim('one', 'count:a', 2).status).toBe('full')
  })

  it('waits for one owner and retains from settlement time', async () => {
    const store = createRpcIdempotencyStore({ retentionMs: 300_000 })
    const original = store.claim('one', 'count:k', 0)
    expect(original.status).toBe('claimed')
    if (original.status !== 'claimed') return
    const duplicate = store.claim('one', 'count:k', 200)
    expect(duplicate.status).toBe('pending')
    original.settle({ ok: true, data: 1 }, 200)
    if (duplicate.status === 'pending')
      expect(await duplicate.outcome).toEqual({ ok: true, data: 1 })
    expect(store.claim('one', 'count:k', 300_100)).toMatchObject({ status: 'done' })
    expect(store.claim('one', 'count:k', 300_201)).toMatchObject({ status: 'claimed' })
    expect(store.claim('two', 'count:k', 300_201)).toMatchObject({ status: 'claimed' })
  })

  it('releases a cancelled owner and lets only the first waiter reclaim', async () => {
    const store = createRpcIdempotencyStore()
    const original = store.claim('one', 'count:k', 0)
    const wait1 = store.claim('one', 'count:k', 1)
    const wait2 = store.claim('one', 'count:k', 1)
    if (original.status !== 'claimed' || wait1.status !== 'pending' || wait2.status !== 'pending')
      throw new Error('claim fixture failed')
    original.release()
    expect(await wait1.outcome).toBeUndefined()
    expect(await wait2.outcome).toBeUndefined()
    expect(store.claim('one', 'count:k', 2).status).toBe('claimed')
    expect(store.claim('one', 'count:k', 2).status).toBe('pending')
  })

  it('retains tombstones for oversize results and evicts older bytes first', () => {
    const store = createRpcIdempotencyStore({ maxOutcomeBytes: 21, maxBytes: 30 })
    const first = store.claim('one', 'count:a', 0)
    const second = store.claim('one', 'count:b', 0)
    if (first.status !== 'claimed' || second.status !== 'claimed')
      throw new Error('claim fixture failed')
    first.settle({ ok: true, data: 'a'.repeat(20) }, 1)
    second.settle({ ok: true, data: 'b'.repeat(20) }, 2)
    expect(store.claim('one', 'count:a', 3)).toEqual({ status: 'done', outcome: 'unavailable' })
    expect(store.claim('one', 'count:b', 3)).toMatchObject({
      status: 'done',
      outcome: { ok: true }
    })
    const oversize = store.claim('one', 'count:c', 3)
    if (oversize.status !== 'claimed') throw new Error('claim fixture failed')
    oversize.settle({ ok: true, data: 'c'.repeat(22) }, 4)
    expect(store.claim('one', 'count:c', 5)).toEqual({ status: 'done', outcome: 'unavailable' })
  })
})
