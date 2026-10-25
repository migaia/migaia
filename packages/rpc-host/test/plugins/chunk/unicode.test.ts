import { describe, expect, it } from 'vitest'
import { createStringChunkAssembler } from '../../../dist/features/chunk/assembly.js'

describe('canonical framing contract', () => {
  it('frames and reassembles unicode without a WebRPC middleware splitter', () => {
    const framer = createStringChunkAssembler({ chunkBytes: 4 })
    /** Original Unicode payload crosses the moved chunk plugin's unchanged string assembler. */
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
    framer.close()
  })

  it('does not retain the former root chunk middleware export', async () => {
    const root = await import('@migaia/rpc-host')
    expect('chunk' in root).toBe(false)
  })
})
