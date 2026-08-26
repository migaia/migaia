import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { writeEnvelope } from '../src/storage/codec.js'
import { PersistCodecOutput } from '../src/state-constants.js'

describe('SWV2-T58 store-persist byte boundary', () => {
  it('passes a foreign intrinsic byte payload to binary storage unchanged', async () => {
    const foreignBytes = runInNewContext('new Uint8Array([4, 5, 6])') as Uint8Array
    const foreignSubclass = runInNewContext(
      'class ByteSubclass extends Uint8Array {}; new ByteSubclass([7, 8])'
    ) as Uint8Array
    let written: Uint8Array | undefined
    const storage = {
      capabilities: { binary: true },
      getBytes: async () => undefined,
      setBytes: async (_key: string, value: Uint8Array) => {
        written = value
      }
    }
    const codec = {
      name: 'foreign-bytes',
      output: PersistCodecOutput.binary,
      encode: async () => foreignBytes
    }

    await writeEnvelope(storage as never, 'key', codec as never, undefined, {})
    expect(written).toBe(foreignBytes)
    await writeEnvelope(
      storage as never,
      'subclass',
      { ...codec, encode: async () => foreignSubclass } as never,
      undefined,
      {}
    )
    expect(written).toBe(foreignSubclass)
  })

  it('keeps a forged byte payload on the canonical mismatch error path', async () => {
    const storage = {
      capabilities: { binary: true },
      getBytes: async () => undefined,
      setBytes: async () => undefined
    }
    const codec = {
      name: 'forged-bytes',
      output: PersistCodecOutput.binary,
      encode: async () => new Proxy(new Uint8Array(1), {})
    }

    await expect(
      writeEnvelope(storage as never, 'key', codec as never, undefined, {})
    ).rejects.toMatchObject({ source: '@migaia/store-persist', code: 'CODEC_OUTPUT_MISMATCH' })
  })
})
