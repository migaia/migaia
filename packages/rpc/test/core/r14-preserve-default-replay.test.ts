import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { connect } from '../../src/core/middleware/connect.js'
import { RequestReplayLedger } from '../../src/core/internal/request-replay-ledger.js'
import type { IRpcProviderRejection } from '../../src/core/provider-admission.js'

it('[R14-A9] public default per-peer replay capacity admits 1024 and rejects the next without business effects', async () => {
  /** No physical native proof is forged; reference memory follows its preserved strict legacy path. */
  const [left, right] = createMemoryTransportPair()
  /**
   * Existing rejection reason disambiguates replay fullness from provider concurrency or binding
   * expiry.
   */
  const notices: IRpcProviderRejection[] = []
  /** The actual provider invocation count decides whether the refused request reached business. */
  let effects = 0
  /** Only the existing observer is supplied; neither capacity default is configured by this fixture. */
  const server = await createProviderEndpoint({
    id: 'r14-default-server',
    transport: right,
    middlewares: [connect({ transport: right })],
    providerLimits: {
      onRejected: (notice) => {
        notices.push(notice)
      }
    },
    provider: {
      echo: (context) => {
        effects++
        return context.success(context.data)
      }
    }
  })
  /** The public caller uses original UUID, pending, routing and replay owners. */
  const client = await createClientEndpoint({
    id: 'r14-default-client',
    transport: left,
    targetIds: ['r14-default-server'],
    middlewares: [connect({ transport: left })]
  })
  try {
    for (let index = 0; index < 1024; index++)
      assert.equal(await client.send('r14-default-server', 'echo', index), index)
    assert.equal(effects, 1024)
    await assert.rejects(
      () => client.send('r14-default-server', 'echo', 'next'),
      { code: 'OVERLOADED' },
      '[R14-A9] public default per-peer replay limit stays 1024'
    )
    assert.equal(effects, 1024, '[R14-A9] overflow executes no business')
    assert.equal(notices.length, 1)
    assert.equal(notices[0]!.reason, 'replayLedgerFull')
  } finally {
    await Promise.all([client.dispose(), server.dispose()])
    left.close()
    right.close()
  }
})

it('[R14-A9] default replay owner keeps global 4096 capacity and isolated endpoint ownership', () => {
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
