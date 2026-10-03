import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { createNativeDefaultAllocator } from '../../src/core/internal/native-default-id.js'
import { NativeDefaultIdText } from '../../src/core/internal/native-default-id-text.js'
import { NativeReplayReceipt } from '../../src/core/internal/native-replay.js'
import { allocateRpcId } from '../../src/core/internal/id.js'

describe('r12 native default allocation and pure receipt state', () => {
  it('[A20] rejects exhaustion with the default reporter without allocating another ID', () => {
    /** An internal boundary seed reaches exhaustion without changing endpoint defaults. */
    const generate = createNativeDefaultAllocator({}, 0xffffffffffffffffn)!
    assert.throws(generate, (error: unknown) => {
      assert.equal((error as { code: string }).code, 'INVALID_CONFIG')
      assert.equal((error as Error).message, NativeDefaultIdText.counterExhausted)
      return true
    })
  })
  it('[A4/A20] preserves genuine exhaustion through the canonical RPC ID allocation owner', () => {
    /** Native code alone owns this generator and its genuine exhaustion error identity. */
    const reported: unknown[] = []
    const generate = createNativeDefaultAllocator({}, 0xfffffffffffffffen, (error) =>
      reported.push(error)
    )!
    assert.ok(
      allocateRpcId({ generate }, 'task', 'native', 'peer', () => false).endsWith(
        0xffffffffffffffffn.toString(36).padStart(13, '0')
      )
    )
    assert.throws(
      () => allocateRpcId({ generate }, 'task', 'native', 'peer', () => false),
      (error: unknown) => {
        assert.equal(
          error,
          reported[0],
          '[A20] genuine exhaustion must not be rebuilt by ID allocation'
        )
        assert.equal((error as Error).message, NativeDefaultIdText.counterExhausted)
        return true
      }
    )
    assert.equal(reported.length, 1)
  })
  it('[A2/A4] allocates one million unique 36-character IDs without a completed-ID cache', () => {
    const generate = createNativeDefaultAllocator({})!
    const identifiers = new Set<string>()
    for (let index = 0; index < 1_000_000; index++) identifiers.add(generate())
    assert.equal(identifiers.size, 1_000_000)
    const first = identifiers.values().next().value!
    assert.match(first, /^[A-Za-z0-9_-]{22}_[0-9a-z]{13}$/u)
    assert.equal(first.length, 36)
    assert.equal(first.slice(23), '0000000000001')
  })

  it('[A4/A20] returns uint64 max then reports and throws the same exhaustion object', () => {
    const reported: unknown[] = []
    const generate = createNativeDefaultAllocator({}, 0xfffffffffffffffen, (error) =>
      reported.push(error)
    )!
    assert.equal(generate().slice(23), 0xffffffffffffffffn.toString(36).padStart(13, '0'))
    let failure: unknown
    try {
      generate()
    } catch (error) {
      failure = error
    }
    assert.equal(reported.length, 1)
    assert.equal(failure, reported[0])
    assert.equal((failure as Error).message, NativeDefaultIdText.counterExhausted)
    assert.equal((failure as { code: string }).code, 'INVALID_CONFIG')
  })

  it('[A6] custom generators and absent secure entropy retain the legacy selection', () => {
    const generate = vi.fn(() => 'custom')
    assert.equal(createNativeDefaultAllocator({ generate }), undefined)
    assert.equal(generate.mock.calls.length, 0, '[A6] qualification never calls user generation')
    vi.stubGlobal('crypto', { randomUUID: () => 'weak-fallback-forbidden' })
    try {
      assert.equal(createNativeDefaultAllocator({}), undefined)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('[A6] throwing secure entropy preserves original cause as INVALID_CONFIG', () => {
    const cause = new RangeError('fixture entropy failure')
    vi.stubGlobal('crypto', {
      getRandomValues: () => {
        throw cause
      }
    })
    try {
      assert.throws(
        () => createNativeDefaultAllocator({}),
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

  it('[A21/A22] state getters stay pure and explicit owner checkpoints permanently downgrade or retire', () => {
    let alive = true
    let exclusive = true
    let reads = 0
    let retired = 0
    const receipt = new NativeReplayReceipt({
      alive: () => {
        reads += 1
        return alive
      },
      exclusive: () => {
        reads += 1
        return exclusive
      }
    })
    assert.equal(receipt.claim(), true)
    receipt.onRetire(() => {
      retired += 1
    })
    const claimedReads = reads
    exclusive = false
    assert.equal(receipt.qualified, true)
    assert.equal(receipt.active, true)
    assert.equal(reads, claimedReads, '[A22] getters never execute platform observation or cleanup')
    receipt.observeOwner()
    assert.equal(receipt.qualified, false)
    assert.equal(receipt.active, true)
    assert.equal(retired, 0, '[A21] live loss of exclusivity does not close active work')
    exclusive = true
    receipt.observeOwner()
    assert.equal(receipt.qualified, false, '[A21] exclusivity restoration cannot revive L')
    alive = false
    receipt.observeOwner()
    assert.equal(receipt.active, false)
    assert.equal(retired, 1)
    alive = true
    receipt.observeOwner()
    assert.equal(receipt.active, false, '[A7] spent physical resource never revives')
    assert.equal(retired, 1)
  })
})
