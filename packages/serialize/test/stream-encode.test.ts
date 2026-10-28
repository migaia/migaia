import { describe, expect, it, vi } from 'vitest'
import {
  SerializeCodecError,
  chunkToText,
  createSerializeRegistry,
  encodeStream,
  jsonPlugin,
  type ISerializeChunk,
  type ISerializePlugin
} from '../src/index.ts'

import {
  rows,
  immediateYield,
  scheduler,
  rejectionHost,
  type ITestAbortSignal
} from './fixtures/stream.ts'

describe('encodeStream：不拼装地吐流', () => {
  it('surfaces an abort-listener failure from the public return path', async () => {
    const listenerFailure = new Error('public abort listener failed')
    const registry = {
      primaryType: 'test',
      types: ['test'] as const,
      has: () => true,
      encode: async (_value: unknown, options?: { signal?: ITestAbortSignal }) => {
        options?.signal?.addEventListener('abort', () => {
          throw listenerFailure
        })
        return ['text', 'chunk'] as const
      },
      decode: async () => undefined,
      close: () => undefined,
      dispose: async () => undefined
    }
    const stream = encodeStream(registry as never, rows(1), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      scheduler: scheduler()
    })

    await expect(stream.next()).resolves.toMatchObject({ done: false, value: ['text', 'chunk'] })
    await expect(stream.return(undefined)).rejects.toBe(listenerFailure)
  })

  it('keeps a consumer throw primary while exposing public abort cleanup as secondary', async () => {
    const listenerFailure = new Error('public abort listener failed')
    const primary = new Error('consumer failed')
    const registry = {
      primaryType: 'test',
      types: ['test'] as const,
      has: () => true,
      encode: async (_value: unknown, options?: { signal?: ITestAbortSignal }) => {
        options?.signal?.addEventListener('abort', () => {
          throw listenerFailure
        })
        return ['text', 'chunk'] as const
      },
      decode: async () => undefined,
      close: () => undefined,
      dispose: async () => undefined
    }
    const stream = encodeStream(registry as never, rows(1), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      scheduler: scheduler()
    })

    await expect(stream.next()).resolves.toMatchObject({ done: false, value: ['text', 'chunk'] })
    await expect(stream.throw(primary)).rejects.toBe(primary)
    expect((primary as { errors?: readonly unknown[] }).errors).toEqual([listenerFailure])
  })

  it('keeps a normal public return successful when abort cleanup reports no error', async () => {
    const registry = {
      primaryType: 'test',
      types: ['test'] as const,
      has: () => true,
      encode: async () => ['text', 'chunk'] as const,
      decode: async () => undefined,
      close: () => undefined,
      dispose: async () => undefined
    }
    const stream = encodeStream(registry as never, rows(1), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      scheduler: scheduler()
    })

    await expect(stream.next()).resolves.toMatchObject({ done: false, value: ['text', 'chunk'] })
    await expect(stream.return(undefined)).resolves.toMatchObject({ done: true })
  })

  it('emits one chunk per slice instead of one blob', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    const chunks: ISerializeChunk[] = []
    for await (const chunk of encodeStream(registry, rows(1_000), {
      initialItems: 250,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })) {
      chunks.push(chunk)
    }

    // 分了多片就该有多段，而不是被合并成一整块
    expect(chunks.length).toBeGreaterThan(1)
    const decoded = chunks.flatMap(
      (chunk) => JSON.parse(chunkToText(chunk, new TextDecoder())) as { id: number }[]
    )
    expect(decoded).toHaveLength(1_000)
    expect(decoded[0].id).toBe(0)
    expect(decoded[999].id).toBe(999)
    await registry.dispose()
  })

  it('keeps only maxInFlight requests outstanding', async () => {
    let live = 0
    let peak = 0
    const slow: ISerializePlugin = {
      type: 'slow',
      parser: {
        name: 'slow',
        encode: async (value) => {
          live++
          peak = Math.max(peak, live)
          await Promise.resolve()
          live--
          return ['text', JSON.stringify(value)] as ISerializeChunk
        },
        decode: (chunk) => JSON.parse(String(chunk[1]))
      }
    }
    const registry = createSerializeRegistry([slow])

    for await (const _chunk of encodeStream(registry, rows(2_000), {
      initialItems: 200,
      maxInFlight: 2,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })) {
      void _chunk
    }
    // 背压生效：在途永远不超过配置上限
    expect(peak).toBeLessThanOrEqual(2)
    await registry.dispose()
  })

  it('rejects an invalid in-flight limit', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    for (const bad of [0, -1, Number.NaN, 1.5]) {
      await expect(
        encodeStream(registry, rows(1), { maxInFlight: bad, scheduler: scheduler() }).next()
      ).rejects.toThrow('maxInFlight must be a positive integer')
    }
    await registry.dispose()
  })

  it('reports which slice failed', async () => {
    let calls = 0
    const flaky: ISerializePlugin = {
      type: 'flaky',
      parser: {
        name: 'flaky',
        encode: (value) => {
          if (++calls === 3) throw new Error('disk full')
          return ['text', JSON.stringify(value)] as ISerializeChunk
        },
        decode: (chunk) => JSON.parse(String(chunk[1]))
      }
    }
    const registry = createSerializeRegistry([flaky])

    const run = async () => {
      for await (const _chunk of encodeStream(registry, rows(1_000), {
        initialItems: 100,
        maxItems: 100,
        yieldTo: immediateYield,
        scheduler: scheduler()
      })) {
        void _chunk
      }
    }
    const error = await run().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SerializeCodecError)
    expect(String(error)).toContain('disk full')
    await registry.dispose()
  })

  it('does not leave an unhandled rejection when the consumer bails early', async () => {
    const failing: ISerializePlugin = {
      type: 'failing',
      parser: {
        name: 'failing',
        encode: async () => {
          await Promise.resolve()
          throw new Error('later failure')
        },
        decode: () => undefined
      }
    }
    const registry = createSerializeRegistry([failing])
    const unhandled = vi.fn()
    rejectionHost?.on('unhandledRejection', unhandled)

    const stream = encodeStream(registry, rows(1_000), {
      initialItems: 100,
      maxInFlight: 4,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })
    // 只取一次就走人，剩下的在途请求必须被静默接住
    await stream.next().catch(() => undefined)
    await stream.return(undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))

    rejectionHost?.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    await registry.dispose()
  })

  it('observes a rejecting queued encode immediately while draining in order', async () => {
    let resolveFirst!: (chunk: ISerializeChunk) => void
    const first = new Promise<ISerializeChunk>((resolve) => {
      resolveFirst = resolve
    })
    const secondFailure = new Error('second encode failed')
    let encodeCalls = 0
    const registry = {
      primaryType: 'test',
      encode: () => (++encodeCalls === 1 ? first : Promise.reject(secondFailure)),
      decode: async () => undefined,
      close: () => undefined,
      dispose: async () => undefined,
      types: ['test'] as const,
      has: () => true
    }
    const unhandled = vi.fn()
    rejectionHost?.on('unhandledRejection', unhandled)
    const stream = encodeStream(registry as never, rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      maxInFlight: 2,
      yieldTo: immediateYield,
      scheduler: scheduler()
    })

    const firstRead = stream.next()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(unhandled).not.toHaveBeenCalled()

    resolveFirst(['text', 'first'])
    await expect(firstRead).resolves.toMatchObject({
      value: ['text', 'first'],
      done: false
    })
    const secondError = await stream.next().catch((error: unknown) => error)
    expect(secondError).toBeInstanceOf(SerializeCodecError)
    expect(secondError).toMatchObject({
      source: 'serialization',
      code: 'ENCODE_FAILED',
      cause: secondFailure
    })
    await stream.return(undefined)
    rejectionHost?.off('unhandledRejection', unhandled)
  })
})
