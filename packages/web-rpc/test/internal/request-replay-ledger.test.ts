import { describe, expect, it } from 'vitest'
import { RequestReplayLedger } from '../../src/internal/request-replay-ledger'

describe('RequestReplayLedger', () => {
  it('rejects non-positive limits with a coded TypeError (bare-throw gate)', () => {
    expect(() => new RequestReplayLedger(0, 2, 100)).toThrow(
      expect.objectContaining({
        source: '@migaia/web-rpc',
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
