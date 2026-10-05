import assert from 'node:assert/strict'
import { it } from 'vitest'
import {
  createRpcIdempotencyStore,
  type IRpcIdempotencyClaim,
  type IRpcIdempotencyOutcome
} from '../../src/core/idempotency-store.js'

/**
 * The planned read-only extension can be asserted on the actual existing store before
 * implementation.
 */
type IStore = {
  claim(scope: string, key: string, now: number, fingerprint?: string): IRpcIdempotencyClaim
  lookup(
    scope: string,
    key: string,
    now: number
  ):
    | { state: 'pending' | 'unknown' }
    | { state: 'done'; outcome: IRpcIdempotencyOutcome | 'unavailable' }
}

it('[A68][A69] lookup observes the original claim/seal owner without claiming, refreshing or consuming capacity', () => {
  const store = createRpcIdempotencyStore({ maxEntries: 1, retentionMs: 10 }) as IStore
  assert.equal(
    typeof Reflect.get(store, 'lookup'),
    'function',
    '[A68] the original store provides read-only lookup'
  )
  for (let index = 0; index < 3; index++)
    assert.deepEqual(store.lookup('peer', 'absent', index), { state: 'unknown' })
  const claim = store.claim('peer', 'key', 3, 'fingerprint:first')
  assert.equal(claim.status, 'claimed', '[A68] unknown queries did not consume the sole entry')
  if (claim.status !== 'claimed') return
  assert.deepEqual(store.lookup('peer', 'key', 4), { state: 'pending' })
  assert.deepEqual(store.lookup('other-peer', 'key', 4), { state: 'unknown' })
  claim.settle({ ok: true, data: 42 }, 5)
  assert.deepEqual(store.lookup('peer', 'key', 6), {
    state: 'done',
    outcome: { ok: true, data: 42 }
  })
  assert.deepEqual(store.lookup('peer', 'key', 14), {
    state: 'done',
    outcome: { ok: true, data: 42 }
  })
  assert.deepEqual(
    store.lookup('peer', 'key', 15),
    { state: 'unknown' },
    '[A68] lookup does not extend settlement TTL'
  )
  assert.equal(store.claim('peer', 'next', 15, 'fingerprint:next').status, 'claimed')
})

it('[A68][A69] a key cannot acquire a different operation fingerprint or replace its sealed result', () => {
  const store = createRpcIdempotencyStore() as IStore
  const claim = store.claim('peer', 'key', 0, 'fingerprint:first')
  assert.equal(claim.status, 'claimed')
  assert.throws(
    () => store.claim('peer', 'key', 1, 'fingerprint:other'),
    { code: 'CONTRACT_INVALID' },
    '[A68] a cross-method/payload collision must be rejected'
  )
  if (claim.status !== 'claimed') return
  claim.settle({ ok: true, data: 'original' }, 2)
  assert.throws(() => store.claim('peer', 'key', 3, 'fingerprint:other'), {
    code: 'CONTRACT_INVALID'
  })
  assert.deepEqual(store.lookup('peer', 'key', 3), {
    state: 'done',
    outcome: { ok: true, data: 'original' }
  })
  assert.equal(
    store.claim('other-peer', 'key', 3, 'fingerprint:other').status,
    'claimed',
    '[A68] authenticated caller scopes remain isolated'
  )
})
