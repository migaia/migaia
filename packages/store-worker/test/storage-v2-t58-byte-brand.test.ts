import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { decodeWorkerValue, encodeWorkerValue } from '../src/serialize/worker.js'
import { transferablesOf } from '../src/serialize/transferables.js'
import { SerializeChunkKind } from '@migaia/serialize'
import { WorkerByteOwnership } from '../src/worker-constants.js'

describe('SWV2-T58 store-worker byte boundaries', () => {
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

  it('exercises worker encode/decode byte classification and preserves payload identity', () => {
    const foreignBytes = runInNewContext('new Uint8Array([11, 12])') as Uint8Array
    const foreignSubclass = runInNewContext(
      'class ByteSubclass extends Uint8Array {}; new ByteSubclass([13, 14])'
    ) as Uint8Array
    expect(encodeWorkerValue(foreignBytes)).toEqual([SerializeChunkKind.bytes, foreignBytes])
    expect(encodeWorkerValue(foreignBytes)[1]).toBe(foreignBytes)
    expect(decodeWorkerValue(foreignSubclass)).toEqual([SerializeChunkKind.bytes, foreignSubclass])
    expect(decodeWorkerValue(new Int8Array(1))).toEqual([
      SerializeChunkKind.value,
      expect.any(Int8Array)
    ])
    expect(decodeWorkerValue(new Proxy(new Uint8Array(1), {}))[0]).toBe(SerializeChunkKind.value)
  })

  it('proves explicit transfer ownership detaches only the returned exclusive buffer', () => {
    const bytes = new Uint8Array([21, 22])
    const transfer = transferablesOf(['bytes', bytes], WorkerByteOwnership.transfer)
    expect(transfer).toEqual([bytes.buffer])
    structuredClone(bytes, { transfer })
    expect(bytes.byteLength).toBe(0)
  })
})
