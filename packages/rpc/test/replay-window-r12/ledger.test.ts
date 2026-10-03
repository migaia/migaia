import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { RequestReplayLedger } from '../../src/core/internal/request-replay-ledger.js'
import { ReplayWindow } from '../../src/core/internal/replay.js'

/** Allows the baseline to receive the new private retention callback without an import failure. */
type IActiveLedgerConstructor = new (
  global: number,
  peer: number,
  ttl: number,
  lease: { retain(peer: string): boolean; release(peer: string): void } | undefined,
  active: () => boolean | undefined
) => RequestReplayLedger & { releaseActive?: (key: string, now?: number) => void }

describe('replay-window r12 ledger ownership', () => {
  it('[A2/A11] preserves the actual 4096 global and 1024 peer boundaries with isolated owners', () => {
    /** Product defaults are asserted directly rather than extrapolated from a small fixture. */
    const ledger = new RequestReplayLedger(4096, 1024, 310_000, undefined, () => true)
    const another = new RequestReplayLedger(4096, 1024, 310_000, undefined, () => true)
    try {
      for (let peer = 0; peer < 4; peer++) {
        for (let index = 0; index < 1024; index++)
          assert.equal(ledger.admit(`${peer}-${index}`, `${peer}`, 0), true)
        assert.equal(
          ledger.admit(`${peer}-1024`, `${peer}`, 0),
          false,
          '[A11] the 1025th active entry for one peer remains rejected'
        )
      }
      assert.equal(ledger.size, 4096)
      assert.equal(ledger.admit('fifth-peer', '4', 0), false, '[A11] global capacity remains 4096')
      assert.equal(another.admit('isolated', '0', 0), true)
      ledger.releaseActive('0-0', 1)
      assert.equal(ledger.admit('fifth-peer', '4', 1), true)
      ledger.clear()
      assert.equal(ledger.size, 0)
      assert.equal(another.size, 1, '[A2] clearing one endpoint cannot clear another ledger')
    } finally {
      ledger.clear()
      another.clear()
    }
  })
  it('[A2] removes settled L entries and restores the unchanged per-peer capacity', () => {
    /** Mode is private owner state, not a public RPC replay option. */
    const Ledger = RequestReplayLedger as IActiveLedgerConstructor
    /** Small explicit limits prove the same exact boundary without a large fixture. */
    const ledger = new Ledger(3, 2, 310_000, undefined, () => true)
    assert.equal(ledger.admit('a', 'peer', 0), true)
    assert.equal(ledger.admit('b', 'peer', 0), true)
    assert.equal(ledger.admit('c', 'peer', 0), false)
    assert.equal(typeof ledger.releaseActive, 'function', '[A2] L needs owner settlement release')
    ledger.releaseActive!('a', 1)
    assert.equal(ledger.size, 1, '[A2] settled L entries leave no tombstone')
    assert.equal(ledger.admit('c', 'peer', 1), true, '[A2] only in-flight entries consume budget')
  })

  it('[A21/A23] downgrade keeps in-flight duplicates blocked and settles to a legacy tombstone', () => {
    /** This callback only reads mode; loss-of-exclusivity is observed by the resource owner. */
    let qualified = true
    /** New private callback remains source-compatible with baseline construction for valid RED. */
    const Ledger = RequestReplayLedger as IActiveLedgerConstructor
    /** An actual legacy TTL expiry distinguishes premature release from settlement retention. */
    const ledger = new Ledger(3, 2, 310_000, undefined, () => qualified)
    assert.equal(ledger.admit('a', 'peer', 0), true)
    qualified = false
    assert.equal(ledger.has('a', 310_001), true, '[A21] downgrade never expires in-flight work')
    assert.equal(
      typeof ledger.releaseActive,
      'function',
      '[A23] settlement owns downgrade retention'
    )
    ledger.releaseActive!('a', 310_001)
    assert.equal(
      ledger.admit('a', 'peer', 310_002),
      false,
      '[A23] settlement starts the legacy TTL'
    )
    assert.equal(ledger.admit('a', 'peer', 620_002), true)
  })

  it('[A22] reentrant physical retirement during admission cannot repopulate the cleared ledger', () => {
    /** Terminal mode is distinct from a live legacy downgrade. */
    let mode: boolean | undefined = true
    /** The retain callback models the real identity owner retiring synchronously during admission. */
    const Ledger = RequestReplayLedger as IActiveLedgerConstructor
    /** Closure initialization finishes before the first identity retain operation. */
    const ledger = new Ledger(
      3,
      2,
      310_000,
      {
        retain: () => {
          mode = undefined
          ledger.clear()
          return true
        },
        release: () => undefined
      },
      () => mode
    )
    assert.equal(ledger.admit('a', 'peer', 0), false, '[A22] retired admission must fail')
    assert.equal(ledger.size, 0, '[A22] retired ledger remains empty')
  })

  it('[A4] a proven default allocator releases outbound IDs without completion tombstones', () => {
    /** Internal constructor callback grants exemption only after canonical allocator construction. */
    const Window = ReplayWindow as new (
      now: () => number,
      maximum: number,
      ttl: number,
      activeOnly: () => boolean
    ) => ReplayWindow
    /** Capacity stays bounded by outstanding operations even with non-reusing identifiers. */
    const window = new Window(
      () => 0,
      2,
      310_000,
      () => true
    )
    assert.equal(window.reserveId('a'), true)
    window.releaseId('a')
    assert.equal(window.size, 0, '[A4] default non-reusing IDs need no completion tombstone')
  })
})
