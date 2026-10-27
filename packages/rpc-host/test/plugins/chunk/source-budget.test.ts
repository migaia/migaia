import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createStringChunkAssembler } from '../../../dist/features/chunk/assembly.js'

for (const quota of ['messages', 'bytes'] as const) {
  it(`A44 isolates ${quota} source quota while another source completes`, () => {
    /** The canonical assembler retains global capacity beyond this sender's explicit subquota. */
    const assembler = createStringChunkAssembler({
      chunkBytes: 2,
      maxMessageBytes: 8,
      maxBufferedBytes: 16,
      maxConcurrentMessages: 8,
      maxConcurrentMessagesPerSource: quota === 'messages' ? 1 : 4,
      maxBufferedBytesPerSource: quota === 'bytes' ? 4 : 8
    })
    try {
      /** Sender A holds exactly one first fragment without consuming the global budget. */
      const first = { source: 'source-a', messageId: 'first' }
      const firstFrames = assembler.frame('abcd', first)
      assert.equal(assembler.accept(firstFrames[0], first).status, 'pending')
      /** Only a new message from A is rejected when its source allowance is exhausted. */
      const second = { source: 'source-a', messageId: 'second' }
      const secondFrames = assembler.frame('efgh', second)
      const rejected = assembler.accept(secondFrames[0], second)
      assert.equal(rejected.status, 'rejected')
      if (rejected.status === 'rejected')
        assert.equal(Reflect.get(rejected.error, 'code'), 'FRAME_LIMIT_EXCEEDED')
      /** Independent sender B still uses the remaining global capacity and completes. */
      const other = { source: 'source-b', messageId: 'other' }
      const otherFrames = assembler.frame('ijkl', other)
      for (let index = 0; index < otherFrames.length; index++) {
        const result = assembler.accept(otherFrames[index], other)
        assert.equal(result.status, index + 1 === otherFrames.length ? 'complete' : 'pending')
      }
      /** Physical source retirement releases both source indexes, permitting fresh admission. */
      assembler.closeSource(first.source)
      assert.equal(assembler.accept(secondFrames[0], second).status, 'pending')
    } finally {
      assembler.close()
    }
  })
}
