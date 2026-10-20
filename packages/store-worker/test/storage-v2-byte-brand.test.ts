import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { workerParser } from '../src/serialize/worker.js'
import { MessageChannel } from 'node:worker_threads'
import { transferablesOf } from '../src/serialize/transferables.js'
import { WorkerByteOwnership } from '../src/worker-constants.js'

describe('store-worker byte boundaries', () => {
  it('accepts a foreign exclusive ArrayBuffer for explicit transfer ownership', () => {
    const foreignBytes = runInNewContext('new Uint8Array([7, 8])') as Uint8Array
    const foreignSubclass = runInNewContext(
      'class ByteSubclass extends Uint8Array {}; new ByteSubclass([9, 10])'
    ) as Uint8Array
    expect(transferablesOf(['bytes', foreignBytes], WorkerByteOwnership.transfer)).toEqual([
      foreignBytes.buffer
    ])
    expect(transferablesOf(['bytes', foreignSubclass], WorkerByteOwnership.transfer)).toEqual([
      foreignSubclass.buffer
    ])
    expect(
      transferablesOf(
        ['bytes', new Uint8Array(new ArrayBuffer(4), 1, 2)],
        WorkerByteOwnership.transfer
      )
    ).toEqual([])
    expect(
      transferablesOf(['bytes', new Int8Array(1) as never], WorkerByteOwnership.transfer)
    ).toEqual([])
    if (typeof SharedArrayBuffer !== 'undefined') {
      const shared = new Uint8Array(new SharedArrayBuffer(2))
      expect(transferablesOf(['bytes', shared], WorkerByteOwnership.transfer)).toEqual([])
    }
  })

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
          source: '@migaia/store-worker',
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

  it('proves explicit transfer ownership detaches only the returned exclusive buffer', () => {
    const bytes = new Uint8Array([21, 22])
    const transfer = transferablesOf(['bytes', bytes], WorkerByteOwnership.transfer)
    expect(transfer).toEqual([bytes.buffer])
    structuredClone(bytes, { transfer: transfer as Transferable[] })
    expect(bytes.byteLength).toBe(0)
  })
})
