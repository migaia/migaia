import { describe, expect, it } from 'vitest'
import { RequestReplayLedger } from '../../../src/core/internal/request-replay-ledger.js'
import { countReplayEntryVisits } from './replay-iteration-observer.js'

describe('RequestReplayLedger', () => {
  it('C4 visits one accepted tombstone per access with 1101 entries and releases each once at TTL', () => {
    /** Original binding release order remains visible across bulk expiration and later access. */
    const released: string[] = []
    /** Explicit fixture per-peer budget fits A10's 1101 entries; default global and TTL remain. */
    const ledger = new RequestReplayLedger(4096, 1101, 310000, {
      retain: () => true,
      release: (peer) => released.push(peer)
    })
    for (let index = 0; index < 1101; index++)
      expect(ledger.admit(`inbound-retained:${index}`, 'peer', 0)).toBe(true)
    /** Per-peer fullness does not justify scanning every retained request. */
    const liveVisits = countReplayEntryVisits('inbound-retained:', () => {
      expect(ledger.has('inbound-retained:1100', 309999)).toBe(true)
      expect(ledger.canAdmit('candidate', 'peer', 309999)).toBe(false)
    })
    expect(liveVisits).toBe(2)
    expect(released).toEqual([])
    /** Exact 310-second expiration restores per-peer leases without evicting fresh suffixes. */
    const expiredVisits = countReplayEntryVisits('inbound-retained:', () => {
      expect(ledger.canAdmit('candidate', 'peer', 310000)).toBe(true)
      expect(ledger.size).toBe(0)
      ledger.purge(310000)
    })
    expect(expiredVisits).toBe(1101)
    expect(released).toHaveLength(1101)
  })

  it('C4 expires only the accepted prefix at the default TTL and retains later peer leases', () => {
    /** Binding releases identify exactly which prefix entries expired, in original order. */
    const released: string[] = []
    /** Independently labelled peer leases prove no live suffix is prematurely released. */
    const ledger = new RequestReplayLedger(3, 1, 310000, {
      retain: () => true,
      release: (peer) => released.push(peer)
    })
    expect(ledger.admit('first', 'peer-first', 0)).toBe(true)
    expect(ledger.admit('second', 'peer-second', 1)).toBe(true)
    expect(ledger.admit('third', 'peer-third', 2)).toBe(true)
    ledger.purge(309999)
    expect(released).toEqual([])
    ledger.purge(310000)
    expect(released).toEqual(['peer-first'])
    expect(ledger.has('second', 310000)).toBe(true)
    expect(ledger.has('third', 310000)).toBe(true)
    ledger.purge(310001)
    expect(released).toEqual(['peer-first', 'peer-second'])
    expect(ledger.has('third', 310001)).toBe(true)
    ledger.clear()
    expect(released).toEqual(['peer-first', 'peer-second', 'peer-third'])
  })

  it('C4 visits one live rejection with 1101 rejected keys and purges each once at fixed expiry', () => {
    /** One peer's retained accepted request fills only its own per-peer budget. */
    const ledger = new RequestReplayLedger(4096, 1, 310000)
    expect(ledger.admit('accepted', 'full-peer', 0)).toBe(true)
    for (let index = 0; index < 1101; index++)
      expect(ledger.admit(`inbound-rejected:${index}`, 'full-peer', 0)).toBe(false)
    /** A fresh global peer still cannot bypass a live rejected-key tombstone. */
    const liveVisits = countReplayEntryVisits('inbound-rejected:', () => {
      expect(ledger.canAdmit('inbound-rejected:0', 'fresh-peer', 999)).toBe(false)
    })
    expect(liveVisits).toBe(1)
    /** The fixed short retention restores rejected keys exactly at 1000ms, not earlier. */
    const expiredVisits = countReplayEntryVisits('inbound-rejected:', () => {
      expect(ledger.admit('inbound-rejected:0', 'fresh-peer', 1000)).toBe(true)
    })
    expect(expiredVisits).toBe(1101)
    expect(ledger.has('accepted', 1000)).toBe(true)
  })

  it('C4 duplicate rejection does not refresh expiry or reorder the live suffix', () => {
    /** Distinct rejected timestamps expose any accidental refresh without private inspection. */
    const ledger = new RequestReplayLedger(4, 1, 310000)
    expect(ledger.admit('accepted', 'full-peer', 0)).toBe(true)
    expect(ledger.admit('rejected-first', 'full-peer', 0)).toBe(false)
    expect(ledger.admit('rejected-second', 'full-peer', 1)).toBe(false)
    expect(ledger.admit('rejected-first', 'full-peer', 500)).toBe(false)
    expect(ledger.admit('rejected-first', 'first-peer', 1000)).toBe(true)
    expect(ledger.admit('rejected-second', 'second-peer', 1000)).toBe(false)
    expect(ledger.admit('rejected-second', 'second-peer', 1001)).toBe(true)
    expect(ledger.has('accepted', 1001)).toBe(true)
  })

  it('rejects non-positive limits with a coded TypeError (bare-throw gate)', () => {
    expect(() => new RequestReplayLedger(0, 2, 100)).toThrow(
      expect.objectContaining({
        source: '@migaia/rpc/core',
        code: 'INVALID_CONFIG',
        message: 'request replay limits must be positive safe integers'
      })
    )
    expect(() => new RequestReplayLedger(2, 2, 0)).toThrow(TypeError)
  })

  it('rejects fresh entries instead of evicting them at capacity', () => {
    const ledger = new RequestReplayLedger(2, 2, 100)
    expect(ledger.admit('a', 'peer', 0)).toBe(true)
    expect(ledger.admit('b', 'peer', 1)).toBe(true)
    expect(ledger.admit('c', 'peer', 2)).toBe(false)
    expect(ledger.has('a', 3)).toBe(true)
    expect(ledger.has('b', 3)).toBe(true)
  })

  it('releases expired capacity at the boundary', () => {
    const ledger = new RequestReplayLedger(1, 1, 100)
    expect(ledger.admit('a', 'peer', 0)).toBe(true)
    expect(ledger.admit('b', 'peer', 99)).toBe(false)
    expect(ledger.admit('b', 'peer', 1_000)).toBe(true)
  })

  it('does not evict fresh rejection tombstones at capacity', () => {
    const ledger = new RequestReplayLedger(1, 1, 1_000)
    expect(ledger.admit('a', 'peer', 0)).toBe(true)
    expect(ledger.admit('rejected-a', 'peer', 1)).toBe(false)
    expect(ledger.admit('rejected-b', 'peer', 2)).toBe(false)
    expect(ledger.admit('a', 'peer', 3)).toBe(false)
    expect(ledger.has('a', 3)).toBe(true)
    expect(ledger.admit('rejected-a', 'peer', 1_000)).toBe(false)
    expect(ledger.admit('fresh', 'peer', 1_000)).toBe(true)
  })

  it('tracks per-peer capacity independently (M-T27 per-key count)', () => {
    const ledger = new RequestReplayLedger(4, 2, 100)
    expect(ledger.admit('a1', 'peer-a', 0)).toBe(true)
    expect(ledger.admit('a2', 'peer-a', 1)).toBe(true)
    expect(ledger.admit('a3', 'peer-a', 2)).toBe(false)
    // peer-b has its own independent budget; peer-a's saturation must not leak into it.
    expect(ledger.admit('b1', 'peer-b', 3)).toBe(true)
    expect(ledger.admit('b2', 'peer-b', 4)).toBe(true)
    expect(ledger.admit('b3', 'peer-b', 5)).toBe(false)
    // Expiring peer-a's tombstones releases only peer-a's per-key count; a fresh peer-a key is
    // admissible while peer-b still holds its two fresh tombstones and stays saturated.
    expect(ledger.admit('a4', 'peer-a', 101)).toBe(true)
    expect(ledger.admit('b3', 'peer-b', 102)).toBe(false)
  })

  it('retains and releases the peer lease with the tombstone lifetime', () => {
    const retained: string[] = []
    const released: string[] = []
    const ledger = new RequestReplayLedger(2, 2, 10, {
      retain: (peer) => {
        retained.push(peer)
        return true
      },
      release: (peer) => released.push(peer)
    })
    expect(ledger.admit('a', 'peer', 0)).toBe(true)
    expect(retained).toEqual(['peer'])
    expect(ledger.has('other', 10)).toBe(false)
    expect(released).toEqual(['peer'])
  })

  it('does not commit or consume peer capacity when external retain rejects', () => {
    let available = false
    const retained: string[] = []
    const released: string[] = []
    const ledger = new RequestReplayLedger(1, 1, 100, {
      retain: (peer) => {
        if (!available) return false
        retained.push(peer)
        return true
      },
      release: (peer) => released.push(peer)
    })

    expect(ledger.admit('rejected', 'peer', 0)).toBe(false)
    expect(ledger.has('rejected', 0)).toBe(false)
    available = true
    expect(ledger.admit('rejected', 'peer', 1)).toBe(true)
    expect(retained).toEqual(['peer'])
    ledger.clear()
    expect(released).toEqual(['peer'])
  })

  it('does not consume internal peer capacity when external retain throws', () => {
    const retained: string[] = []
    const released: string[] = []
    let fail = true
    const ledger = new RequestReplayLedger(1, 1, 100, {
      retain: (peer) => {
        retained.push(peer)
        if (fail) throw new Error('retain failed')
        return true
      },
      release: (peer) => released.push(peer)
    })

    expect(() => ledger.admit('first', 'peer', 0)).toThrow('retain failed')
    expect(ledger.has('first', 0)).toBe(false)
    fail = false
    expect(ledger.admit('second', 'peer', 1)).toBe(true)
    expect(retained).toEqual(['peer', 'peer'])
    ledger.clear()
    expect(released).toEqual(['peer'])
  })
})
