import { describe, expect, it, vi } from 'vitest'
import { ReplayWindow } from '../../../src/core/internal/replay.js'
import { countReplayEntryVisits } from './replay-iteration-observer.js'

describe('ReplayWindow', () => {
  it('C4 visits one live tombstone per access with 1101 retained ids and each expired id once', () => {
    /** Supported monotonic clock crosses the exact default 310-second boundary without sleeping. */
    let now = 0
    /** The user A10 workload retains 1101 request ids; the product TTL remains its default. */
    const window = new ReplayWindow(() => now, 1101)
    for (let index = 0; index < 1101; index++) {
      window.reserveId(`outbound-retained:${index}`)
      window.releaseId(`outbound-retained:${index}`)
    }
    /** Two live accesses must not traverse 1101 entries each. */
    const liveVisits = countReplayEntryVisits('outbound-retained:', () => {
      expect(window.hasReservedId('outbound-retained:1100')).toBe(true)
      expect(window.reserveId('candidate')).toBe(false)
    })
    expect(liveVisits).toBe(2)
    now = 310000
    /** Expiring the full prefix accounts for work once instead of hiding a linear clear. */
    const expiredVisits = countReplayEntryVisits('outbound-retained:', () => {
      expect(window.reserveId('candidate')).toBe(true)
      expect(window.hasReservedId('candidate')).toBe(true)
    })
    expect(expiredVisits).toBe(1101)
  })

  it('C4 expires only the ordered prefix at 310 seconds and preserves later live and active ids', () => {
    /** Release times stay monotonic while different entries reach their individual TTL. */
    let now = 0
    /** Active reservation remains independent from the ordered released prefix. */
    const window = new ReplayWindow(() => now, 4)
    window.reserveId('active')
    for (let index = 0; index < 3; index++) {
      now = index
      window.reserveId(`boundary:${index}`)
      window.releaseId(`boundary:${index}`)
    }
    now = 309999
    expect(window.hasReservedId('boundary:0')).toBe(true)
    expect(window.reserveId('candidate')).toBe(false)
    now = 310000
    expect(window.hasReservedId('boundary:0')).toBe(false)
    expect(window.hasReservedId('boundary:1')).toBe(true)
    expect(window.hasReservedId('boundary:2')).toBe(true)
    expect(window.hasReservedId('active')).toBe(true)
    now = 310001
    expect(window.hasReservedId('boundary:1')).toBe(false)
    expect(window.hasReservedId('boundary:2')).toBe(true)
    now = 310002
    expect(window.hasReservedId('boundary:2')).toBe(false)
    expect(window.hasReservedId('active')).toBe(true)
    expect(window.reserveId('candidate')).toBe(true)
  })

  it('rejects non-positive or unsafe replay limits', () => {
    expect(() => new ReplayWindow(() => Date.now(), 0, 1)).toThrow()
    expect(() => new ReplayWindow(() => Date.now(), 1, Number.POSITIVE_INFINITY)).toThrow()
  })

  it('rejects fresh entries independently at each capacity boundary', () => {
    const window = new ReplayWindow(() => Date.now(), 2, 10_000)
    expect(window.reserveId('a')).toBe(true)
    expect(window.reserveId('b')).toBe(true)
    expect(window.reserveId('c')).toBe(false)
    const second = new ReplayWindow(() => Date.now(), 2, 10_000)
    second.reserveId('id')
    expect(second.hasReservedId('id')).toBe(true)
  })

  it('clears both replay namespaces', () => {
    const window = new ReplayWindow(() => Date.now())
    window.reserveId('id')
    window.clear()
    expect(window.hasReservedId('id')).toBe(false)
  })

  it('exposes immutable capacity for independent replay namespaces', () => {
    const window = new ReplayWindow(() => Date.now(), 2, 10_000)
    expect(window.maxEntries).toBe(2)
  })
  it('keeps an active identifier reserved past the retention window', () => {
    vi.useFakeTimers()
    try {
      const window = new ReplayWindow(() => Date.now(), 1, 100)
      expect(window.reserveId('id')).toBe(true)
      vi.advanceTimersByTime(100)
      expect(window.hasReservedId('id')).toBe(true)
      expect(window.reserveId('id')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves a released identifier to a tombstone until the replay window expires', () => {
    vi.useFakeTimers()
    try {
      const window = new ReplayWindow(() => Date.now(), 1, 100)
      expect(window.reserveId('id')).toBe(true)
      window.releaseId('id')
      window.releaseId('id')
      expect(window.hasReservedId('id')).toBe(true)
      expect(window.reserveId('id')).toBe(false)
      vi.advanceTimersByTime(100)
      expect(window.hasReservedId('id')).toBe(false)
      expect(window.reserveId('id')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires an active identifier without creating a second tombstone', () => {
    const window = new ReplayWindow(() => Date.now(), 1, 10_000)
    expect(window.reserveId('id')).toBe(true)
    window.expireId('id')
    expect(window.hasReservedId('id')).toBe(false)
    expect(window.reserveId('replacement')).toBe(true)
  })

  it('does not let released tombstones evade the bounded namespace', () => {
    const window = new ReplayWindow(() => Date.now(), 1, 10_000)
    expect(window.reserveId('id')).toBe(true)
    window.releaseId('id')
    expect(window.reserveId('other')).toBe(false)
  })

  it('expires released tombstones but never active ids after the replay window', () => {
    vi.useFakeTimers()
    try {
      const window = new ReplayWindow(() => Date.now(), 2, 100)
      window.reserveId('id')
      expect(window.hasReservedId('id')).toBe(true)

      vi.advanceTimersByTime(100)
      expect(window.hasReservedId('id')).toBe(true)
      window.releaseId('id')
      expect(window.hasReservedId('id')).toBe(true)
      vi.advanceTimersByTime(100)
      expect(window.hasReservedId('id')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
