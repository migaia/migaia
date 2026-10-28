import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { defaultJsonCodec } from '../src/storage/codec.ts'

describe('defaultJsonCodec Map/Set 往返', () => {
  it('同 realm 嵌套 Map/Set 还原为真实实例', async () => {
    const value = { map: new Map([['a', 1]]), set: new Set([1, 2, 3]) }
    const decoded = (await defaultJsonCodec.decode(
      await defaultJsonCodec.encode(value)
    )) as typeof value
    expect(decoded.map).toBeInstanceOf(Map)
    expect([...decoded.map.entries()]).toEqual([['a', 1]])
    expect(decoded.set).toBeInstanceOf(Set)
    expect([...decoded.set.values()]).toEqual([1, 2, 3])
  })

  it('跨 realm Map 不丢内容（instanceof 会拒跨 realm 值，内部 slot 分类能识别）', async () => {
    const crossRealmMap = vm.runInNewContext('new Map([["a", 1]])') as Map<string, number>
    expect(crossRealmMap instanceof Map).toBe(false)
    expect(Reflect.apply(Object.prototype.toString, crossRealmMap, [])).toBe('[object Map]')
    const decoded = (await defaultJsonCodec.decode(
      await defaultJsonCodec.encode({ map: crossRealmMap })
    )) as { map: Map<string, number> }
    expect(decoded.map).toBeInstanceOf(Map)
    expect([...decoded.map.entries()]).toEqual([['a', 1]])
  })

  it('跨 realm Set 不丢内容', async () => {
    const crossRealmSet = vm.runInNewContext('new Set([1, 2, 3])') as Set<number>
    expect(crossRealmSet instanceof Set).toBe(false)
    expect(Reflect.apply(Object.prototype.toString, crossRealmSet, [])).toBe('[object Set]')
    const decoded = (await defaultJsonCodec.decode(
      await defaultJsonCodec.encode({ set: crossRealmSet })
    )) as { set: Set<number> }
    expect(decoded.set).toBeInstanceOf(Set)
    expect([...decoded.set.values()]).toEqual([1, 2, 3])
  })

  it('伪造 Map/Set constructor 不执行 hostile 成员', async () => {
    let executed = false
    const fakeMap = Object.create({ constructor: { name: 'Map' } })
    Object.defineProperty(fakeMap, 'entries', {
      get() {
        executed = true
        throw new Error('hostile entries')
      }
    })
    const fakeSet = Object.create({ constructor: { name: 'Set' } })
    Object.defineProperty(fakeSet, 'values', {
      get() {
        executed = true
        throw new Error('hostile values')
      }
    })
    await expect(defaultJsonCodec.encode({ fakeMap, fakeSet })).resolves.toBeTypeOf('string')
    expect(executed).toBe(false)
  })

  it('writes reserved records and reads old markers and tuples as ordinary data', async () => {
    const encoded = await defaultJsonCodec.encode({ map: new Map([['a', 1]]) })
    expect(encoded).toBe('{"map":{"$rpc":"map","entries":[["a",1]]}}')
    for (const value of [
      { __migaia_persist_map__: [['a', 1]] },
      { __migaia_persist_set__: ['a'] },
      ['migaia-collections-json-v1', 'map', [['a', 1]]],
      ['migaia-collections-json-v1', 'set', ['a']]
    ]) {
      await expect(defaultJsonCodec.decode(JSON.stringify(value))).resolves.toEqual(value)
    }
  })

  it('preserves each owning error in invalid writes and malformed JSON', async () => {
    for (const value of [NaN, Infinity, undefined]) {
      await expect(defaultJsonCodec.encode(value)).rejects.toMatchObject({
        source: 'store.persist',
        code: 'ENCODE_FAILED',
        cause: {
          source: 'storage.contract',
          code: 'INVALID_ARGUMENT',
          cause: { source: 'serialization', code: 'ENCODE_FAILED' }
        }
      })
    }
    await expect(defaultJsonCodec.decode('{bad')).rejects.toMatchObject({
      source: 'store.persist',
      code: 'ENVELOPE_INVALID',
      cause: {
        source: 'storage.contract',
        code: 'INVALID_ARGUMENT',
        cause: {
          source: 'serialization',
          code: 'DECODE_FAILED',
          cause: expect.any(SyntaxError)
        }
      }
    })
    await expect(defaultJsonCodec.decode(1)).rejects.toBeInstanceOf(TypeError)
  })
})
