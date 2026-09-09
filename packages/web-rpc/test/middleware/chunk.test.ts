import { describe, expect, it } from 'vitest'
import { createStringFramer } from '@migaia/rpc-contract/framing'

describe('canonical framing contract', () => {
  it('frames and reassembles unicode without a WebRPC middleware splitter', () => {
    const framer = createStringFramer({ chunkBytes: 4 })
    const value = '😀中文测试'
    const frames = framer.frame(value, {
      source: 'chunk-test',
      messageId: 'chunk-test'
    })
    expect(frames.length).toBeGreaterThan(1)
    const accepted = frames.map((frame) =>
      framer.accept(frame, { source: 'chunk-test', messageId: 'chunk-test' })
    )
    expect(accepted.at(-1)).toMatchObject({ status: 'complete', value })
  })

  it('does not retain the former root chunk middleware export', async () => {
    const root = await import('../../src/index.js')
    expect('chunk' in root).toBe(false)
  })
})
