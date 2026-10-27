/** Original native ID invariants execute the sole current allocator without a legacy factory. */
import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCallIdAllocator } from '../../dist/call/id.js'
import { NativeDefaultIdText } from '../../dist/call/id-text.js'

// Keep the original million allocations and all four exact predicates.
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

// Fail the same native entropy operation before any allocation.
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

// Migrate only the original internal starting-counter input.
it('rejects exhaustion with the default reporter without allocating another ID', () => {
  /** The same canonical owner receives the original internal exhausted-state constructor input. */
  const allocator = new RpcCallIdAllocator(undefined, 0xffffffffffffffffn)
  assert.throws(
    () => allocator.allocate(),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'INVALID_CONFIG')
      assert.equal((error as Error).message, NativeDefaultIdText.counterExhausted)
      return true
    }
  )
})

// The sole current allocator preserves its own reported failure.
it('preserves genuine exhaustion through the canonical RPC ID allocation owner', () => {
  /** Keep original diagnostic identities without replacing the allocator or its report callback. */
  const reported: unknown[] = []
  /** Existing internal starting state reaches the last allocation without a completed-ID cache. */
  const allocator = new RpcCallIdAllocator((error) => reported.push(error), 0xfffffffffffffffen)
  assert.ok(allocator.allocate().endsWith(0xffffffffffffffffn.toString(36).padStart(13, '0')))
  assert.throws(
    () => allocator.allocate(),
    (error: unknown) => {
      assert.equal(error, reported[0], 'genuine exhaustion must not be rebuilt by ID allocation')
      assert.equal((error as Error).message, NativeDefaultIdText.counterExhausted)
      return true
    }
  )
  assert.equal(reported.length, 1)
})

// Keep all five original final-value/report/type-code predicates.
it('returns uint64 max then reports and throws the same exhaustion object', () => {
  /** The original report sink retains the same object later thrown by this canonical owner. */
  const reported: unknown[] = []
  /** Only constructor state changes; native entropy, allocation and failure minting remain real. */
  const allocator = new RpcCallIdAllocator((error) => reported.push(error), 0xfffffffffffffffen)
  assert.equal(allocator.allocate().slice(23), 0xffffffffffffffffn.toString(36).padStart(13, '0'))
  /** Catch the original synchronous allocation failure without classifying or replacing it. */
  let failure: unknown
  try {
    allocator.allocate()
  } catch (error) {
    failure = error
  }
  assert.equal(reported.length, 1)
  assert.equal(failure, reported[0])
  assert.equal((failure as Error).message, NativeDefaultIdText.counterExhausted)
  assert.equal((failure as { code: string }).code, 'INVALID_CONFIG')
})
