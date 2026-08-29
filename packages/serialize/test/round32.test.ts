import { describe, expect, it } from 'vitest'
import { encodeStream, type ISerializeChunk } from '../src/index.js'

describe('Round32 serialize bounded finalization', () => {
  it('SER-T32-01 returns without awaiting noncooperative residual work', async () => {
    let encodeCalls = 0
    let releaseLate!: (error?: unknown) => void
    let residualSignal: { readonly aborted: boolean } | undefined
    const late = new Error('late noncooperative failure')
    const registry = {
      primaryType: 'test',
      encode: (_items: readonly unknown[], context: { signal: typeof residualSignal }) => {
        encodeCalls += 1
        if (encodeCalls === 1) return Promise.resolve(['text', 'first'] as ISerializeChunk)
        residualSignal = context.signal
        return new Promise<ISerializeChunk>((_resolve, reject) => {
          releaseLate = reject
        })
      }
    }
    const stream = encodeStream(registry as never, [1, 2], {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      maxInFlight: 2,
      yieldTo: async () => {},
      scheduler: {
        now: () => 0,
        schedule: (callback: () => void) => {
          callback()
          return { cancel: () => {} }
        }
      }
    })

    await expect(stream.next()).resolves.toMatchObject({ value: ['text', 'first'], done: false })
    const returned = stream.return(undefined)
    await expect(
      Promise.race([
        returned,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('bounded return timeout')), 50)
        )
      ])
    ).resolves.toEqual({ value: undefined, done: true })
    expect(encodeCalls).toBe(2)
    expect(residualSignal?.aborted).toBe(true)
    releaseLate(late)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('SER-T32-02 keeps queue movement free of Array.shift operations', async () => {
    const originalShift = Array.prototype.shift
    let shiftCalls = 0
    Array.prototype.shift = (() => {
      shiftCalls += 1
      throw new Error('queue shift must not run')
    }) as typeof Array.prototype.shift
    try {
      const registry = {
        primaryType: 'test',
        encode: async (): Promise<ISerializeChunk> => ['text', 'ok'],
        decode: async () => undefined
      }
      const chunks: ISerializeChunk[] = []
      for await (const chunk of encodeStream(registry as never, Array.from({ length: 128 }), {
        initialItems: 1,
        minItems: 1,
        maxItems: 1,
        maxInFlight: 8,
        yieldTo: async () => {},
        scheduler: {
          now: () => 0,
          schedule: (callback: () => void) => {
            callback()
            return { cancel: () => {} }
          }
        }
      })) {
        chunks.push(chunk)
      }
      expect(chunks).toHaveLength(128)
    } finally {
      Array.prototype.shift = originalShift
    }
    expect(shiftCalls).toBe(0)
  })
})
