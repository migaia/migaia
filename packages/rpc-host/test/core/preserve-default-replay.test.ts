import assert from 'node:assert/strict'
import { it } from 'vitest'

import { RequestReplayLedger } from '../../dist/features/auth/request-replay.js'

it('numeric replay retention keeps global 4096 capacity and isolated endpoint ownership', () => {
  /** Default constructor capacities still constrain explicitly retained numeric-mode entries. */
  const ledger = new RequestReplayLedger()
  /** A second canonical owner must not share capacity or disposal with the first. */
  const other = new RequestReplayLedger()
  /** Native authentication sources retain the exact cleanup keys accepted by each owner. */
  const sources = Array.from({ length: 4 }, () => ({ replayKeys: new Set<string>() }))
  /** A rejected new source does not contaminate accepted-source membership counts. */
  const rejected = { replayKeys: new Set<string>() }
  /** Independent owner cleanup retains its own exact original source identity. */
  const independent = { replayKeys: new Set<string>() }
  try {
    for (let peer = 0; peer < 4; peer++)
      for (let index = 0; index < 1024; index++)
        assert.notEqual(
          ledger.admit(sources[peer]!, String(peer), `${peer}-${index}`, 0, 310_000),
          undefined
        )
    assert.equal(
      sources.reduce((total, source) => total + source.replayKeys.size, 0),
      4096
    )
    assert.equal(ledger.admit(rejected, 'other-peer', 'overflow', 0, 310_000), undefined)
    assert.notEqual(other.admit(independent, '0', 'independent', 0, 310_000), undefined)
    for (const source of sources) ledger.retire(source)
    ledger.retire(rejected)
    assert.equal(independent.replayKeys.size, 1)
  } finally {
    for (const source of sources) ledger.retire(source)
    ledger.retire(rejected)
    other.retire(independent)
  }
})
