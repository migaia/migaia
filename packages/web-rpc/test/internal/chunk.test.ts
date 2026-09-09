import { describe, expect, it } from 'vitest'
import { createStringFramer } from '@migaia/rpc-contract/framing'

/** Retains WebRPC coverage at the D13 physical framing boundary. */
describe('canonical D13 framing', () => {
  it('roundtrips ordered fragments', () => {
    const f = createStringFramer({ chunkBytes: 1, maxMessageBytes: 8 })
    const c = { source: 'a', messageId: 'm' }
    const x = f.frame('ab', c)
    expect(f.accept(x[0], c)).toEqual({ status: 'pending' })
    expect(f.accept(x[1], c)).toEqual({ status: 'complete', value: 'ab' })
  })
  it('isolates opaque sources', () => {
    const f = createStringFramer({ chunkBytes: 1, maxMessageBytes: 8 })
    const a = { source: 'a', messageId: 'm' },
      b = { source: 'b', messageId: 'm' }
    const x = f.frame('ab', a),
      y = f.frame('xy', b)
    expect(f.accept(x[0], a).status).toBe('pending')
    expect(f.accept(y[0], b).status).toBe('pending')
    expect(f.accept(x[1], a)).toEqual({ status: 'complete', value: 'ab' })
    expect(f.accept(y[1], b)).toEqual({ status: 'complete', value: 'xy' })
  })
  it('rejects malformed metadata before allocation', () => {
    /** Counts timer allocation so malformed input cannot retain canonical state. */
    let schedules = 0
    const f = createStringFramer({
      chunkBytes: 1,
      maxMessageBytes: 8,
      schedule: () => {
        schedules += 1
        return {}
      }
    })
    const c = { source: 'a', messageId: 'm' }
    const x = f.frame('ab', c)[0] as Record<string, unknown>
    expect(f.accept({ ...x, index: Number.NaN }, c).status).toBe('rejected')
    expect(schedules).toBe(0)
  })
  it('rejects duplicate and out-of-order fragments', () => {
    const f = createStringFramer({ chunkBytes: 1, maxMessageBytes: 8 })
    const c = { source: 'a', messageId: 'm' }
    const x = f.frame('ab', c)
    expect(f.accept(x[1], c).status).toBe('rejected')
    expect(f.accept(x[0], c).status).toBe('pending')
    expect(f.accept(x[0], c).status).toBe('rejected')
  })
  it('rejects bounded capacity before scheduling', () => {
    let schedules = 0
    const f = createStringFramer({
      chunkBytes: 1,
      maxMessageBytes: 8,
      maxConcurrentMessages: 1,
      schedule: () => {
        schedules += 1
        return {}
      }
    })
    const a = { source: 'a', messageId: 'a' },
      b = { source: 'b', messageId: 'b' }
    expect(f.accept(f.frame('ab', a)[0], a).status).toBe('pending')
    expect(f.accept(f.frame('xy', b)[0], b).status).toBe('rejected')
    expect(schedules).toBe(1)
    expect(f.accept(f.frame('ab', a)[1], a)).toEqual({ status: 'complete', value: 'ab' })
  })
  it('rejects byte and message limits', () => {
    const f = createStringFramer({ chunkBytes: 1, maxMessageBytes: 2, maxChunks: 2 })
    expect(() => f.frame('abc', { source: 'a', messageId: 'm' })).toThrow()
  })
  it('rejects hostile accepted-frame count, chunk, length, and buffered-byte limits', () => {
    const f = createStringFramer({
      chunkBytes: 2,
      maxMessageBytes: 4,
      maxChunks: 2,
      maxBufferedBytes: 4
    })
    const a = { source: 'a', messageId: 'a' },
      b = { source: 'b', messageId: 'b' }
    const x = f.frame('abcd', a)[0] as Record<string, unknown>
    expect(f.accept({ ...x, count: 3 }, a).status).toBe('rejected')
    expect(f.accept({ ...x, data: 'abc' }, a).status).toBe('rejected')
    expect(f.accept({ ...x, length: 5 }, a).status).toBe('rejected')
    expect(f.accept(x, a).status).toBe('pending')
    const buffered = f.frame('wxyz', b)
    expect(f.accept(buffered[0], b).status).toBe('pending')
    expect(f.accept(buffered[1], b).status).toBe('rejected')
    f.close()
  })
  it('cancels partial assembly on close', () => {
    let cancelled = 0
    const f = createStringFramer({
      chunkBytes: 1,
      maxMessageBytes: 8,
      schedule: () => ({}),
      cancel: () => {
        cancelled += 1
      }
    })
    const c = { source: 'a', messageId: 'm' }
    f.accept(f.frame('ab', c)[0], c)
    f.close()
    expect(cancelled).toBe(1)
  })
  it('rejects frames after close', () => {
    const f = createStringFramer({ chunkBytes: 1, maxMessageBytes: 8 })
    const c = { source: 'a', messageId: 'm' }
    f.close()
    expect(f.accept(f.frame('a', c)[0], c).status).toBe('rejected')
  })
})
