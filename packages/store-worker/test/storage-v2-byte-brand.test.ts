import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { workerParser } from '../src/serialize/worker.ts'
import { MessageChannel } from 'node:worker_threads'

describe('store-worker byte boundaries', () => {
  it('classifies foreign bytes through the public pre-abort codec diagnostic', async () => {
    /** Use the actual public native port, not an export kept only for test access. */
    const channel = new MessageChannel()
    /** Pre-abort stops before wire conversion, preserving a direct byte-brand observation. */
    const parser = workerParser({ worker: channel.port1 })
    /** The diagnostic reports bytesConsumed from the classified local input chunk. */
    const controller = new AbortController()
    controller.abort()
    /** These actual foreign values cover byte subclasses and non-byte/proxy exclusions. */
    const inputs = [
      [runInNewContext('new Uint8Array([11, 12])'), 2],
      [runInNewContext('class ByteSubclass extends Uint8Array {}; new ByteSubclass([13, 14])'), 2],
      [new Int8Array(1), 0],
      [new Proxy(new Uint8Array(1), {}), 0]
    ] as const
    try {
      for (const [value, bytesConsumed] of inputs) {
        await expect(
          parser.encode(value, { signal: controller.signal, context: 'byte-brand' })
        ).rejects.toMatchObject({
          source: 'store.worker',
          code: 'REQUEST_ABORTED',
          bytesConsumed
        })
      }
    } finally {
      await parser.dispose?.()
      channel.port1.close()
      channel.port2.close()
    }
  })
})
