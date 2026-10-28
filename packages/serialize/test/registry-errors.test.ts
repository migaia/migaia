import { describe, expect, it } from 'vitest'
import {
  SerializeCodecError,
  createSerializeRegistry,
  type ISerializeChunk,
  type ISerializeOutput
} from '../src/index.ts'

import { plugin } from './fixtures/registry.ts'

describe('encode() 里同步抛错的 parser 必须走 SerializeCodecError 包装，不能是裸错误', () => {
  it('parser.encode 同步抛错时，registry.encode 拒绝的是 SerializeCodecError（而不是原始错误类型）', async () => {
    // 复现：encode() 里 `parser.encode(value, context)` 是作为 collectChunks 的实参被求值的——
    // 同步抛错发生在这次求值上，早于 collectChunks 内部任何 try/catch，此前会把裸错误原样
    // 抛给调用方，和其余所有失败路径（parser 返回 rejected Promise、chunk 形状非法等）都会
    // 被包装成 SerializeCodecError 的既定行为不一致。
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (): ISerializeChunk => {
          throw new TypeError('Do not know how to serialize a BigInt')
        },
        decode: (c) => c
      })
    ])
    const rejection = registry.encode(1n as unknown as number, { type: 'a' })
    await expect(rejection).rejects.toBeInstanceOf(SerializeCodecError)
    await expect(rejection).rejects.toMatchObject({ type: 'a', phase: 'encode' })
    // 原始错误必须仍可追溯，不能在包装时丢掉根因
    await expect(rejection).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Do not know how to serialize a BigInt' })
    })
  })

  it('hostile Error.message getter cannot replace encode primary or cause identity', async () => {
    const primary = new Error('hidden')
    Object.defineProperty(primary, 'message', {
      configurable: true,
      get: () => {
        throw new Error('message getter escaped')
      }
    })
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (): ISerializeChunk => {
          throw primary
        },
        decode: (chunk) => chunk
      })
    ])

    await expect(registry.encode('x')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SerializeCodecError)
      expect(error).toMatchObject({
        code: 'ENCODE_FAILED',
        message: 'serialize step failed: serialize failure reason unavailable',
        cause: primary
      })
      expect((error as { cause?: unknown }).cause).toBe(primary)
      return true
    })
  })

  it('primitive and hostile object coercion remain causes while wrapper text stays deterministic', async () => {
    const hostileObject = Object.create(null) as object
    const cases: readonly [string, unknown][] = [
      ['primitive failure', 'primitive failure'],
      ['hostile object failure', hostileObject]
    ]
    for (const [label, primary] of cases) {
      if (label === 'hostile object failure') {
        Object.defineProperty(primary as object, 'toString', {
          configurable: true,
          value: () => {
            throw new Error('toString escaped')
          }
        })
      }
      const registry = createSerializeRegistry([
        plugin('a', {
          name: 'a',
          encode: (): ISerializeChunk => {
            throw primary
          },
          decode: (chunk) => chunk
        })
      ])

      await expect(registry.encode(label)).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(SerializeCodecError)
        expect(error).toMatchObject({ code: 'ENCODE_FAILED', cause: primary })
        expect((error as { cause?: unknown }).cause).toBe(primary)
        expect((error as Error).message).toBe(
          `serialize step failed: ${label === 'primitive failure' ? label : 'serialize failure reason unavailable'}`
        )
        return true
      })
    }
  })

  it('decode and iterator failures preserve hostile primary identity through the wrapper', async () => {
    const decodePrimary = Object.create(null) as object
    Object.defineProperty(decodePrimary, 'toString', {
      configurable: true,
      value: () => {
        throw new Error('decode coercion escaped')
      }
    })
    const iteratorPrimary = new Error('iterator hidden')
    Object.defineProperty(iteratorPrimary, 'message', {
      configurable: true,
      get: () => {
        throw new Error('iterator message escaped')
      }
    })
    const output = {
      [Symbol.iterator](): Iterator<ISerializeChunk> {
        return {
          next(): IteratorResult<ISerializeChunk> {
            throw iteratorPrimary
          }
        }
      }
    }
    const registry = createSerializeRegistry([
      plugin('a', {
        name: 'a',
        encode: (): ISerializeOutput => output,
        decode: () => {
          throw decodePrimary
        }
      })
    ])

    await expect(registry.decode(['text', 'x'])).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SerializeCodecError)
      expect(error).toMatchObject({
        code: 'DECODE_FAILED',
        message: 'deserialize failed: serialize failure reason unavailable',
        cause: decodePrimary
      })
      return true
    })
    await expect(registry.encode('x')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(SerializeCodecError)
      expect(error).toMatchObject({
        code: 'ENCODE_FAILED',
        message: 'serialize stream failed at chunk 0: serialize failure reason unavailable',
        cause: iteratorPrimary
      })
      return true
    })
  })
})
