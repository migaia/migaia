/** Original native ID invariants execute the sole current allocator without a legacy factory. */
import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCallIdAllocator } from '../../dist/call/id.js'

// RPC-TEST-96C1E6C992FE-C003: keep the original million allocations and all four exact predicates.
it('allocates one million unique 36-character IDs without a completed-ID cache', () => {
  /** The genuine CallTable and StreamChannel share this same nonce/counter implementation. */
  const allocator = new RpcCallIdAllocator()
  /** Only the original test oracle retains completed IDs; the allocator has no completed cache. */
  const identifiers = new Set<string>()
  for (let index = 0; index < 1_000_000; index++) identifiers.add(allocator.allocate())
  assert.equal(identifiers.size, 1_000_000)
  /** The original first ID fixes nonce spelling, width and first sequence independently. */
  const first = identifiers.values().next().value!
  assert.match(first, /^[A-Za-z0-9_-]{22}_[0-9a-z]{13}$/u)
  assert.equal(first.length, 36)
  assert.equal(first.slice(23), '0000000000001')
})

// RPC-TEST-96C1E6C992FE-C006: fail the same native entropy operation before any allocation.
it('preserves the original throwing secure entropy cause as INVALID_CONFIG', () => {
  /** This original native family and identity must survive current constructor classification. */
  const cause = new RangeError('fixture entropy failure')
  vi.stubGlobal('crypto', {
    getRandomValues: () => {
      throw cause
    }
  })
  try {
    assert.throws(
      () => new RpcCallIdAllocator(),
      (error: unknown) => {
        assert.equal((error as { cause: unknown }).cause, cause)
        assert.equal((error as { code: string }).code, 'INVALID_CONFIG')
        return true
      }
    )
  } finally {
    vi.unstubAllGlobals()
  }
})
