import { describe, expect, it, vi } from 'vitest'
import {
  SerializeCodecError,
  collectStream,
  encodeStream,
  type ISerializeChunk
} from '../src/index.js'
import { validateSerializeChunk } from '../src/types.js'

type IRejectionHost = {
  on(event: 'unhandledRejection', listener: () => void): void
  off(event: 'unhandledRejection', listener: () => void): void
}

const rejectionHost = (globalThis as { process?: IRejectionHost }).process

const scheduler = {
  now: () => 0,
  schedule: (callback: () => void) => {
    callback()
    return { cancel() {} }
  }
}

const immediateYield = async (): Promise<void> => {}

describe('Round26 serialize boundaries', () => {
  it('SER-T26-01 returns an immutable tuple snapshot and preserves bytes identity', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    let phase = 0
    const target = ['bytes', bytes] as [unknown, unknown]
    const tuple = new Proxy(target, {
      get(source, property, receiver) {
        if (property === '0') return phase === 0 ? 'bytes' : 'text'
        if (property === '1') return phase === 0 ? bytes : 'changed'
        return Reflect.get(source, property, receiver)
      }
    })

    const snapshot = validateSerializeChunk(tuple, {
      type: 'round26',
      phase: 'decode',
      context: 'snapshot',
      chunkIndex: 4,
      bytesConsumed: 7
    })
    phase = 1

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(snapshot[0]).toBe('bytes')
    expect(snapshot[1]).toBe(bytes)

    phase = 0
    const collected = await collectStream(
      (async function* (): AsyncGenerator<ISerializeChunk> {
        yield tuple as ISerializeChunk
        phase = 1
      })(),
      new TextEncoder()
    )
    expect(collected).toEqual(['bytes', bytes])
  })

  it('SER-T26-02 preserves index/cause on getter failure without coercing hostile tags', async () => {
    const toString = vi.fn(() => 'coerced')
    const hostileTag = { toString }
    const unknownTagError = await Promise.resolve().then(() => {
      try {
        validateSerializeChunk([hostileTag, 'payload'] as never, {
          type: 'round26',
          phase: 'decode',
          context: 'tag',
          chunkIndex: 0,
          bytesConsumed: 0
        })
        return undefined
      } catch (error) {
        return error
      }
    })
    expect(unknownTagError).toMatchObject({ code: 'INVALID_CHUNK' })
    expect(toString).not.toHaveBeenCalled()

    let lengthReads = 0
    const wrongLength = new Proxy(['text', 'payload'], {
      get(_source, property, _receiver) {
        if (property === 'length') {
          lengthReads += 1
          return 3
        }
        throw new Error('tuple index must not be read after wrong length')
      }
    })
    expect(() =>
      validateSerializeChunk(wrongLength, {
        type: 'round26',
        phase: 'encode',
        context: 'length',
        chunkIndex: 0,
        bytesConsumed: 0
      })
    ).toThrow(/must be a \[type, data\] pair/)
    expect(lengthReads).toBe(1)

    const cause = new Error('payload getter failed')
    const getterFailure = new Proxy(['text', 'payload'], {
      get(source, property, receiver) {
        if (property === '1') throw cause
        return Reflect.get(source, property, receiver)
      }
    })
    const error = await collectStream(
      (async function* (): AsyncGenerator<unknown> {
        yield ['bytes', new Uint8Array([9, 8])]
        yield getterFailure
      })() as never
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SerializeCodecError)
    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_CHUNK',
      chunkIndex: 1,
      bytesConsumed: 2,
      cause
    })
  })

  it('SER-T26-03 normalizes sync encode throws with FIFO index and no unhandled rejection', async () => {
    let resolveFirst!: (chunk: ISerializeChunk) => void
    const syncFailure = new Error('sync encode failed')
    const first = new Promise<ISerializeChunk>((_resolve) => {
      resolveFirst = _resolve
    })
    let calls = 0
    const registry = {
      primaryType: 'round26',
      encode: () => {
        calls += 1
        if (calls === 1) return first
        throw syncFailure
      }
    }
    const unhandled = vi.fn()
    rejectionHost?.on('unhandledRejection', unhandled)

    const stream = encodeStream(registry as never, [{ id: 1 }, { id: 2 }], {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      maxInFlight: 2,
      yieldTo: immediateYield,
      scheduler
    })
    const firstResult = stream.next()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(2)

    resolveFirst(['text', 'first'])
    await expect(firstResult).resolves.toEqual({
      done: false,
      value: ['text', 'first']
    })

    const error = await stream.next().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SerializeCodecError)
    expect(error).toMatchObject({
      source: '@migaia/serialize',
      code: 'ENCODE_FAILED',
      chunkIndex: 1,
      cause: syncFailure
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    rejectionHost?.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('SER-T26-04 assimilates a registry thenable before applying backpressure', async () => {
    const registry = {
      primaryType: 'round26',
      encode: () => ({
        // oxlint-disable-next-line unicorn/no-thenable -- hostile registry compatibility fixture.
        then(resolve: (chunk: ISerializeChunk) => void) {
          resolve(['text', 'thenable'])
        }
      })
    }
    const output: ISerializeChunk[] = []
    for await (const chunk of encodeStream(registry as never, [{ id: 1 }], {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      maxInFlight: 1,
      yieldTo: immediateYield,
      scheduler
    })) {
      output.push(chunk)
    }

    expect(output).toEqual([['text', 'thenable']])
  })
})
