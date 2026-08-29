import { describe, expect, it } from 'vitest'
import { collectStream, encodeStream, type ISerializeChunk } from '../src/index.js'

describe('Round31 serialize admission and streaming boundaries', () => {
  it('SER-T31-01 treats truthy iterator done as completion without reading value', async () => {
    let nextCalls = 0
    let valueReads = 0
    const source = {
      [Symbol.iterator]() {
        return {
          next() {
            nextCalls += 1
            return {
              done: 1,
              get value() {
                valueReads += 1
                throw new Error('completed value must not be read')
              }
            }
          }
        }
      }
    }

    await expect(collectStream(source as never)).resolves.toEqual(['text', ''])
    expect(nextCalls).toBe(1)
    expect(valueReads).toBe(0)
  })

  it('SER-T31-02 snapshots iterator factory, next, and return exactly once', async () => {
    let factoryReads = 0
    let nextReads = 0
    let returnReads = 0
    let nextCalls = 0
    const cause = new Error('invalid chunk')
    const iterator = {
      get next() {
        nextReads += 1
        return () => {
          nextCalls += 1
          return nextCalls === 1 ? { done: false, value: ['invalid', cause] } : { done: true }
        }
      },
      get return() {
        returnReads += 1
        return () => ({ done: true })
      }
    }
    const source = {}
    Object.defineProperty(source, Symbol.iterator, {
      get() {
        factoryReads += 1
        return () => iterator
      }
    })

    await expect(collectStream(source as never)).rejects.toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_CHUNK'
    })
    expect(factoryReads).toBe(1)
    expect(nextReads).toBe(1)
    expect(returnReads).toBe(1)
  })

  it('SER-T31-03 rejects encoder getter before acquiring a text-only source', async () => {
    const cause = new Error('encoder getter failed')
    let sourceReads = 0
    const source = {
      [Symbol.iterator]() {
        sourceReads += 1
        return {
          next: () => ({ done: true })
        }
      }
    }
    const encoder = {}
    Object.defineProperty(encoder, 'encode', {
      get: () => {
        throw cause
      }
    })

    await expect(collectStream(source as never, encoder as never)).rejects.toMatchObject({
      source: '@migaia/serialize',
      code: 'INVALID_OPTION',
      cause
    })
    expect(sourceReads).toBe(0)
  })

  it('SER-T31-04 aborts in-flight work when the consumer returns early', async () => {
    let signal:
      | {
          readonly aborted: boolean
          readonly reason?: unknown
          addEventListener(type: 'abort', listener: () => void): void
        }
      | undefined
    let encodeCalls = 0
    const registry = {
      primaryType: 'test',
      encode: (_items: readonly unknown[], context: { signal: typeof signal }) => {
        signal = context.signal
        encodeCalls += 1
        if (encodeCalls === 1) return Promise.resolve(['text', 'first'] as ISerializeChunk)
        return new Promise<ISerializeChunk>((_resolve, reject) => {
          context.signal?.addEventListener('abort', () => reject(context.signal?.reason))
        })
      }
    }
    const caller = {
      aborted: false,
      reason: undefined,
      addEventListener: (_type: 'abort', _listener: () => void) => {},
      removeEventListener: () => {}
    }
    const stream = encodeStream(registry as never, [1, 2], {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      maxInFlight: 2,
      signal: caller,
      yieldTo: async () => {},
      scheduler: {
        now: () => 0,
        schedule: (callback: () => void) => {
          callback()
          return { cancel: () => {} }
        }
      }
    })

    const first = await stream.next()
    expect(first.value).toEqual(['text', 'first'])
    await stream.return(undefined)
    expect(signal?.aborted).toBe(true)
  })

  it('SER-T31-05 returns one validated bytes chunk without copying its payload', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const result = await collectStream([['bytes', bytes]])
    expect(result).toEqual(['bytes', bytes])
    expect(result[1]).toBe(bytes)
  })
})
