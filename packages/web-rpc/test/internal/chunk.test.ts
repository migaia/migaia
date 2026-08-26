import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChunkAssembler, splitUtf8, utf8ByteLength } from '../../src/internal/chunk'

afterEach(() => vi.useRealTimers())

describe('chunk assembler limits', () => {
  it('measures every UTF-8 width and preserves code points while splitting', () => {
    expect(utf8ByteLength('A¢中😀')).toBe(10)
    expect(splitUtf8('', 4)).toEqual([])
    expect(splitUtf8('A¢中😀', 4)).toEqual(['A¢', '中', '😀'])
  })

  it('assembles out-of-order frames and isolates peer/message tuples', () => {
    const assembler = new ChunkAssembler()
    expect(
      assembler.accept({ messageId: 'same', index: 1, total: 2, data: 'B' }, 'peer-a')
    ).toBeUndefined()
    expect(
      assembler.accept({ messageId: 'same', index: 0, total: 2, data: 'X' }, 'peer-b')
    ).toBeUndefined()
    expect(assembler.accept({ messageId: 'same', index: 0, total: 2, data: 'A' }, 'peer-a')).toBe(
      'AB'
    )
    expect(assembler.accept({ messageId: 'same', index: 1, total: 2, data: 'Y' }, 'peer-b')).toBe(
      'XY'
    )
  })

  it('rejects malformed frame metadata without allocating assemblies', () => {
    const events: string[] = []
    const assembler = new ChunkAssembler()
    assembler.observe((event) => events.push(event))
    const malformed = [
      { messageId: 'm', index: Number.NaN, total: 1, data: 'x' },
      { messageId: 'm', index: 0, total: 0, data: 'x' },
      { messageId: 'm', index: -1, total: 1, data: 'x' },
      { messageId: 'm', index: 0, total: 1, data: 1 as unknown as string }
    ]
    for (const frame of malformed) expect(assembler.accept(frame)).toBeUndefined()
    expect(events).toHaveLength(malformed.length)
  })

  it('rejects chunk, total, message, and global byte budget violations', () => {
    const events: string[] = []
    const assembler = new ChunkAssembler({
      chunkSize: 2,
      maxChunkBytes: 2,
      maxChunksPerMessage: 2,
      maxMessageBytes: 3,
      maxBufferedBytes: 3
    })
    assembler.observe((event) => events.push(event))
    expect(
      assembler.accept({ messageId: 'too-many', index: 0, total: 3, data: 'a' })
    ).toBeUndefined()
    expect(
      assembler.accept({ messageId: 'too-wide', index: 0, total: 1, data: '中' })
    ).toBeUndefined()
    expect(
      assembler.accept({ messageId: 'message', index: 0, total: 2, data: 'ab' })
    ).toBeUndefined()
    expect(
      assembler.accept({ messageId: 'message', index: 1, total: 2, data: 'cd' })
    ).toBeUndefined()
    expect(assembler.accept({ messageId: 'buffer-a', index: 0, total: 2, data: 'ab' })).toBe(
      undefined
    )
    expect(assembler.accept({ messageId: 'buffer-b', index: 0, total: 2, data: 'cd' })).toBe(
      undefined
    )
    expect(events).toHaveLength(4)
  })

  it('enforces global and per-peer assembly admission without eviction', () => {
    const assembler = new ChunkAssembler({
      maxConcurrentMessages: 2,
      maxConcurrentMessagesPerPeer: 1
    })
    expect(assembler.accept({ messageId: 'a', index: 0, total: 2, data: 'a' }, 'peer-a')).toBe(
      undefined
    )
    expect(assembler.accept({ messageId: 'b', index: 0, total: 2, data: 'b' }, 'peer-a')).toBe(
      undefined
    )
    expect(assembler.accept({ messageId: 'c', index: 0, total: 2, data: 'c' }, 'peer-b')).toBe(
      undefined
    )
    expect(assembler.accept({ messageId: 'd', index: 0, total: 2, data: 'd' }, 'peer-c')).toBe(
      undefined
    )
    expect(assembler.accept({ messageId: 'a', index: 1, total: 2, data: 'A' }, 'peer-a')).toBe('aA')
    expect(assembler.accept({ messageId: 'c', index: 1, total: 2, data: 'C' }, 'peer-b')).toBe('cC')
  })

  it('does not allocate a timer for a frame rejected at assembly capacity', () => {
    const timerSpy = vi.spyOn(globalThis, 'setTimeout')
    const assembler = new ChunkAssembler({ maxConcurrentMessages: 1 })
    expect(assembler.accept({ messageId: 'first', index: 0, total: 2, data: 'a' })).toBe(undefined)
    expect(timerSpy).toHaveBeenCalledTimes(1)
    expect(assembler.accept({ messageId: 'rejected', index: 0, total: 2, data: 'b' })).toBe(
      undefined
    )
    expect(timerSpy).toHaveBeenCalledTimes(1)
    expect(assembler.size).toBe(1)
    assembler.clear()
    timerSpy.mockRestore()
  })

  it('drops duplicate and inconsistent assemblies, then admits a fresh message', () => {
    const assembler = new ChunkAssembler()
    expect(assembler.accept({ messageId: 'duplicate', index: 0, total: 2, data: 'a' })).toBe(
      undefined
    )
    expect(assembler.accept({ messageId: 'duplicate', index: 0, total: 2, data: 'a' })).toBe(
      undefined
    )
    expect(assembler.accept({ messageId: 'duplicate', index: 0, total: 1, data: 'fresh' })).toBe(
      'fresh'
    )
    expect(assembler.accept({ messageId: 'mismatch', index: 0, total: 2, data: 'a' })).toBe(
      undefined
    )
    expect(assembler.accept({ messageId: 'mismatch', index: 1, total: 3, data: 'b' })).toBe(
      undefined
    )
  })

  it('expires partial assemblies and clear cancels remaining timers', () => {
    vi.useFakeTimers()
    const events: string[] = []
    const assembler = new ChunkAssembler({ assemblyTimeoutMs: 10 })
    assembler.observe((event) => events.push(event))
    assembler.accept({ messageId: 'expires', index: 0, total: 2, data: 'a' })
    vi.advanceTimersByTime(10)
    expect(events).toEqual(['chunk.expired'])
    assembler.accept({ messageId: 'cleared', index: 0, total: 2, data: 'a' })
    assembler.clear()
    vi.advanceTimersByTime(10)
    expect(events).toEqual(['chunk.expired'])
  })
})
