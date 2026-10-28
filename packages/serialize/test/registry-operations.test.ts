import { describe, expect, it } from 'vitest'
import {
  SerializeCodecError,
  chunkToBytes,
  chunkToText,
  createSerializeRegistry,
  type ISerializeChunk
} from '../src/index.ts'

import { plugin } from './fixtures/registry.ts'

describe('encode/decode：类型解析与往返', () => {
  it('未指定 type 时使用 primaryType', async () => {
    const registry = createSerializeRegistry([plugin('a'), plugin('b')])
    const chunk = await registry.encode('hi')
    expect(chunk).toEqual(['text', 'hi'])
  })

  it('未注册的 type 抛 SerializeCodecError，携带 phase/type', async () => {
    const registry = createSerializeRegistry([plugin('a')])
    await expect(registry.encode('x', { type: 'missing' })).rejects.toMatchObject({
      type: 'missing',
      phase: 'encode'
    })
    await expect(registry.decode(['text', 'x'], { type: 'missing' })).rejects.toMatchObject({
      type: 'missing',
      phase: 'decode'
    })
  })

  it('encode/decode 往返', async () => {
    const registry = createSerializeRegistry([plugin('a')])
    const chunk = await registry.encode({ id: 1 }, { type: 'a' })
    const value = await registry.decode(chunk, { type: 'a' })
    expect(value).toBe('[object Object]')
  })
})

describe('decode：输入形状校验（assertChunk）', () => {
  const registry = createSerializeRegistry([plugin('a')])

  it('拒绝非数组', async () => {
    await expect(registry.decode('nope' as unknown as ISerializeChunk)).rejects.toThrow(
      /must be a \[type, data\] pair/
    )
  })

  it('拒绝长度不为 2 的数组', async () => {
    await expect(registry.decode(['text'] as unknown as ISerializeChunk)).rejects.toThrow(
      /must be a \[type, data\] pair/
    )
  })

  it('text chunk 的 data 必须是 string', async () => {
    await expect(registry.decode(['text', 123] as unknown as ISerializeChunk)).rejects.toThrow(
      /text chunk data must be a string/
    )
  })

  it('bytes chunk 的 data 必须是 Uint8Array', async () => {
    await expect(
      registry.decode(['bytes', 'not-bytes'] as unknown as ISerializeChunk)
    ).rejects.toThrow(/bytes chunk data must be a Uint8Array/)
  })

  it('拒绝未知的 chunk kind', async () => {
    await expect(registry.decode(['weird', 1] as unknown as ISerializeChunk)).rejects.toThrow(
      /unknown serialize chunk type/
    )
  })
})

describe('collectChunks：多段/异步产出的收敛规则', () => {
  it('单个同步 chunk 直接收敛', async () => {
    const registry = createSerializeRegistry([
      plugin('a', { name: 'a', encode: (): ISerializeChunk => ['text', 'sync'], decode: (c) => c })
    ])
    expect(await registry.encode(null)).toEqual(['text', 'sync'])
  })

  it('parser 返回 Promise<chunk> 时正确收敛', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: async (): Promise<ISerializeChunk> => ['text', 'async'],
        decode: (c) => c
      })
    ])
    expect(await registry.encode(null)).toEqual(['text', 'async'])
  })

  it('全 text 的多段流直接拼字符串', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // eslint-disable-next-line @typescript-eslint/require-await
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'foo']
          yield ['text', 'bar']
        },
        decode: (c) => c
      })
    ])
    expect(await registry.encode(null)).toEqual(['text', 'foobar'])
  })

  it('混合 text + bytes 的多段流统一拼成字节', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // eslint-disable-next-line @typescript-eslint/require-await
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'ab']
          yield ['bytes', new Uint8Array([1, 2, 3])]
        },
        decode: (c) => c
      })
    ])
    const chunk = await registry.encode(null)
    expect(chunk[0]).toBe('bytes')
    expect(chunkToBytes(chunk, new TextEncoder())).toEqual(
      new Uint8Array([...new TextEncoder().encode('ab'), 1, 2, 3])
    )
  })

  it('value chunk 必须独占一次输出，前面已有其他段时拒绝', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // eslint-disable-next-line @typescript-eslint/require-await
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'a']
          yield ['value', { boom: true }]
        },
        decode: (c) => c
      })
    ])
    await expect(registry.encode(null)).rejects.toThrow(
      /value chunk cannot be combined with other chunks/
    )
  })

  it('没有产出任何 chunk 时拒绝', async () => {
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // eslint-disable-next-line @typescript-eslint/require-await, require-yield
        encode: async function* (): AsyncGenerator<ISerializeChunk> {},
        decode: (c) => c
      })
    ])
    await expect(registry.encode(null)).rejects.toThrow(/serialize produced no chunks/)
  })

  it('流式产出中途已经 aborted 时立即拒绝', async () => {
    const controller = new AbortController()
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'a']
          controller.abort()
          yield ['text', 'b']
        },
        decode: (c) => c
      })
    ])
    await expect(registry.encode(null, { signal: controller.signal })).rejects.toThrow(
      /serialize aborted/
    )
  })

  it('abort 带 reason 时 ABORTED 错误经 cause 保持 `=== reason` 可达', async () => {
    const controller = new AbortController()
    const reason = new Error('user cancelled')
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: async function* (): AsyncGenerator<ISerializeChunk> {
          yield ['text', 'a']
          controller.abort(reason)
          yield ['text', 'b']
        },
        decode: (c) => c
      })
    ])
    await expect(registry.encode(null, { signal: controller.signal })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toMatchObject({ code: 'ABORTED' })
        expect((error as { cause?: unknown }).cause).toBe(reason)
        return true
      }
    )
  })

  it('caller abort 及时结算一个永不 settle 的 parser（双 Promise）', async () => {
    const controller = new AbortController()
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        // 永不 settle：旧实现（无 abort race）会永久挂起。
        encode: () => new Promise<ISerializeChunk>(() => {}),
        decode: (c) => c
      })
    ])
    const pending = registry.encode('x', { type: 'a', signal: controller.signal })
    controller.abort('cancelled by caller')
    await expect(pending).rejects.toMatchObject({
      code: 'ABORTED',
      cause: 'cancelled by caller'
    })
  })
})

describe('chunkToText / chunkToBytes', () => {
  it('value chunk 没有文本/字节形态，两者都拒绝', () => {
    const chunk: ISerializeChunk = ['value', { x: 1 }]
    expect(() => chunkToText(chunk, new TextDecoder())).toThrow(TypeError)
    expect(() => chunkToBytes(chunk, new TextEncoder())).toThrow(TypeError)
  })
})

describe('iterable admission failure containment', () => {
  it('accepts callable objects with a sync iterator and preserves the callable receiver', async () => {
    let receiverMatched = false
    const output = (() => undefined) as unknown as Record<PropertyKey, unknown>
    output[Symbol.iterator] = function (this: object): Iterator<ISerializeChunk> {
      receiverMatched = this === output
      return [['text', 'callable-sync'] as ISerializeChunk][Symbol.iterator]()
    }
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: () => output as never,
        decode: (chunk) => chunk
      })
    ])

    await expect(registry.encode('x')).resolves.toEqual(['text', 'callable-sync'])
    expect(receiverMatched).toBe(true)
  })

  it('accepts callable objects with async precedence over sync iteration', async () => {
    let asyncReceiverMatched = false
    let syncReads = 0
    const output = (() => undefined) as unknown as Record<PropertyKey, unknown>
    output[Symbol.asyncIterator] = function (this: object): AsyncIterator<ISerializeChunk> {
      asyncReceiverMatched = this === output
      let done = false
      return {
        next: async () => {
          if (done) return { done: true, value: undefined }
          done = true
          return { done: false, value: ['text', 'callable-async'] }
        }
      }
    }
    output[Symbol.iterator] = () => {
      syncReads += 1
      throw new Error('sync iterator must not be read')
    }
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: () => output as never,
        decode: (chunk) => chunk
      })
    ])

    await expect(registry.encode('x')).resolves.toEqual(['text', 'callable-async'])
    expect(asyncReceiverMatched).toBe(true)
    expect(syncReads).toBe(0)
  })

  it('direct protocol reads ignore a false has trap and preserve sync iterator receiver', async () => {
    let receiverMatched = false
    const output = new Proxy(
      {
        [Symbol.iterator](this: object): Iterator<ISerializeChunk> {
          receiverMatched = this === output
          return [['text', 'ok'] as ISerializeChunk][Symbol.iterator]()
        }
      },
      { has: () => false }
    )
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: () => output as never,
        decode: (chunk) => chunk
      })
    ])

    await expect(registry.encode('x')).resolves.toEqual(['text', 'ok'])
    expect(receiverMatched).toBe(true)
  })

  it('reads async iterator once, gives it precedence, and never probes sync iterator', async () => {
    let asyncReads = 0
    let syncReads = 0
    let receiverMatched = false
    const output = new Proxy(
      {},
      {
        has: () => false,
        get: (_target, property) => {
          if (property === Symbol.asyncIterator) {
            asyncReads += 1
            return function (this: object): AsyncIterator<ISerializeChunk> {
              receiverMatched = this === output
              let done = false
              return {
                next: async () => {
                  if (done) return { done: true, value: undefined }
                  done = true
                  return { done: false, value: ['text', 'async'] }
                }
              }
            }
          }
          if (property === Symbol.iterator) {
            syncReads += 1
            throw new Error('sync iterator must not be read')
          }
          return undefined
        }
      }
    )
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: () => output as never,
        decode: (chunk) => chunk
      })
    ])

    await expect(registry.encode('x')).resolves.toEqual(['text', 'async'])
    expect(asyncReads).toBe(1)
    expect(syncReads).toBe(0)
    expect(receiverMatched).toBe(true)
  })

  it('async iterator getter 失败时进入 SerializeCodecError，并保留 cause', async () => {
    const cause = new Error('async iterator getter failed')
    const output = {} as Record<PropertyKey, unknown>
    Object.defineProperty(output, Symbol.asyncIterator, {
      configurable: true,
      get: () => {
        throw cause
      }
    })
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: () => output as never,
        decode: (chunk) => chunk
      })
    ])

    await expect(registry.encode('x')).rejects.toMatchObject({
      source: 'serialization',
      code: 'ENCODE_FAILED',
      cause
    })
  })

  it.each(['length', 'index'] as const)(
    'hostile chunk Proxy %s getter stays inside the ENCODE_FAILED codec boundary',
    async (access) => {
      const cause = new Error(`chunk ${access} getter failed`)
      const target = ['text', 'proxy'] as unknown as ISerializeChunk
      const output = new Proxy(target, {
        get(value, property) {
          if (
            (access === 'length' && property === 'length') ||
            (access === 'index' && property === '0')
          ) {
            throw cause
          }
          return (value as unknown as Record<PropertyKey, unknown>)[property]
        }
      })
      const registry = createSerializeRegistry([
        plugin('a', {
          name: 'a',
          encode: () => output,
          decode: (chunk) => chunk
        })
      ])

      await expect(registry.encode('x')).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(SerializeCodecError)
        expect(error).toMatchObject({
          source: 'serialization',
          code: 'ENCODE_FAILED',
          cause
        })
        return true
      })
      await registry.dispose()
    }
  )
})
