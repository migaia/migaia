import { describe, expect, it } from 'vitest'
import {
  createSerializeRegistry,
  jsonParser,
  jsonPlugin,
  type ISerializeChunk,
  type ISerializeContext
} from '../src/index'

describe('jsonParser：encode', () => {
  it('把值编成 text chunk', () => {
    const parser = jsonParser()
    expect(parser.encode({ a: 1 }, dummyContext())).toEqual(['text', '{"a":1}'])
  })

  it('顶层 undefined（JSON.stringify 返回 undefined）时抛 TypeError', () => {
    const parser = jsonParser()
    expect(() => parser.encode(undefined, dummyContext())).toThrow(TypeError)
    expect(() => parser.encode((() => 1) as unknown, dummyContext())).toThrow(TypeError)
  })

  it('replacer 按 JSON.stringify 语义生效', () => {
    const parser = jsonParser({ replacer: (key, value) => (key === 'secret' ? undefined : value) })
    const chunk = parser.encode({ id: 1, secret: 'x' }, dummyContext())
    expect(chunk).toEqual(['text', '{"id":1}'])
  })

  it('space 控制缩进（仅调试用）', () => {
    const parser = jsonParser({ space: 2 })
    // `encode()` is typed as `ISerializeOutput` (a union covering async/streaming outputs too);
    // `jsonParser` is known to always return a synchronous chunk tuple directly.
    const chunk = parser.encode({ a: 1 }, dummyContext()) as ISerializeChunk
    expect(chunk[1]).toContain('\n')
  })
})

describe('jsonParser：decode', () => {
  it('text chunk 直接 JSON.parse', () => {
    const parser = jsonParser()
    expect(parser.decode(['text', '{"a":1}'], dummyContext())).toEqual({ a: 1 })
  })

  it('bytes chunk 先 UTF-8 解码再 JSON.parse', () => {
    const parser = jsonParser()
    const bytes = new TextEncoder().encode('{"a":1}')
    expect(parser.decode(['bytes', bytes], dummyContext())).toEqual({ a: 1 })
  })

  it('value chunk 直接透传，不做任何解析', () => {
    const parser = jsonParser()
    const value = { already: 'parsed' }
    expect(parser.decode(['value', value], dummyContext())).toBe(value)
  })

  it('reviver 按 JSON.parse 语义生效', () => {
    const parser = jsonParser({
      reviver: (key, value) => (key === 'at' ? new Date(value as string) : value)
    })
    const result = parser.decode(['text', '{"at":"2020-01-01T00:00:00.000Z"}'], dummyContext()) as {
      at: Date
    }
    expect(result.at).toBeInstanceOf(Date)
  })

  it('非法 JSON 文本按 JSON.parse 语义抛错', () => {
    const parser = jsonParser()
    expect(() => parser.decode(['text', '{not json'], dummyContext())).toThrow(SyntaxError)
  })
})

describe('jsonPlugin', () => {
  it('type 固定为 json，parser 与 jsonParser 行为一致', () => {
    const plugin = jsonPlugin()
    expect(plugin.type).toBe('json')
    expect(plugin.parser.encode({ a: 1 }, dummyContext())).toEqual(['text', '{"a":1}'])
  })

  it('可以直接接进 registry，走完整 encode/decode 往返', async () => {
    const registry = createSerializeRegistry([jsonPlugin()])
    const chunk = await registry.encode({ hello: 'world' })
    const value = await registry.decode(chunk)
    expect(value).toEqual({ hello: 'world' })
  })
})

function dummyContext(): ISerializeContext {
  return {
    signal: {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    },
    context: 'test'
  }
}
