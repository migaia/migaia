import assert from 'node:assert/strict'
import { it } from 'vitest'

import { RequestReplayLedger } from '../../dist/core/internal/request-replay-ledger.js'

it('default replay owner keeps global 4096 capacity and isolated endpoint ownership', () => {
  /** Zero-argument construction decides the real default owner, not explicit fixture capacities. */
  const ledger = new RequestReplayLedger()
  /** A second canonical owner must not share capacity or disposal with the first. */
  const other = new RequestReplayLedger()
  try {
    for (let peer = 0; peer < 4; peer++)
      for (let index = 0; index < 1024; index++)
        assert.equal(ledger.admit(`${peer}-${index}`, String(peer), 0), true)
    assert.equal(ledger.size, 4096)
    assert.equal(ledger.admit('overflow', 'other-peer', 0), false)
    assert.equal(other.admit('independent', '0', 0), true)
    ledger.clear()
    assert.equal(other.size, 1)
  } finally {
    ledger.clear()
    other.clear()
  }
})
