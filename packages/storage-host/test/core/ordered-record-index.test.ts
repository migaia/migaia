import { describe, expect, it } from 'vitest'
import { compareStorageKeys, encodeOrderedStorageKey } from '../../src/authoring/key.js'
import { type IStorageKey } from '@migaia/storage-contract'
import { createOrderedRecordIndex } from '../../src/core/ordered-record-index.js'

/** Every fixture uses the actual canonical writer rather than a second test encoding. */
const encode = (key: IStorageKey): Uint8Array => encodeOrderedStorageKey(key, 'memory')

describe('the shared compressed ordered record index', () => {
  it('retains canonical order, constant adjacent leaves and exact open bounds through mutation', () => {
    const index = createOrderedRecordIndex<IStorageKey>()
    const keys: IStorageKey[] = [
      ['z', 1],
      'same-prefix-z',
      3,
      new Date(2),
      '',
      'same-prefix-a',
      new Uint8Array([2]).buffer,
      -0,
      ['a', 1],
      -3
    ]
    const expected = keys.slice().sort(compareStorageKeys)
    for (const key of keys) index.set(encode(key), key)
    expect([...index.range()].map((leaf) => leaf.value)).toEqual(expected)
    expect(index.size).toBe(keys.length)
    expect(index.first!.value).toBe(-3)
    expect(index.last!.value).toEqual(['z', 1])
    expect(index.first!.next!.previous).toBe(index.first)
    expect(index.last!.previous!.next).toBe(index.last)
    const same = index.get(encode(3))!
    expect(index.set(encode(3), 9)).toBe(same)
    expect(index.size).toBe(keys.length)
    expect(index.get(encode(3))!.value).toBe(9)
    expect(
      [
        ...index.range({
          lower: encode(-0),
          upper: encode('same-prefix-z'),
          lowerOpen: true,
          upperOpen: true
        })
      ].map((leaf) => leaf.value)
    ).toEqual([9, new Date(2), '', 'same-prefix-a'])
    expect(index.lowerBound(encode('same-prefix-a'), false)!.value).toBe('same-prefix-z')
    expect(index.lowerBound(encode(['zz']))).toBeUndefined()
    const first = index.first!
    expect(index.delete(first.key)).toBe(true)
    expect(first.next).toBeUndefined()
    expect(first.previous).toBeUndefined()
    expect(index.first!.value).toBe(-0)
    const last = index.last!
    expect(index.delete(last.key)).toBe(true)
    expect(index.last!.value).toEqual(['a', 1])
    expect(last.previous).toBeUndefined()
    expect(index.delete(encode('missing'))).toBe(false)
    index.clear()
    expect(index.size).toBe(0)
    expect(index.first).toBeUndefined()
    expect(index.last).toBeUndefined()
    expect(same.next).toBeUndefined()
    expect(same.previous).toBeUndefined()
  })

  it('repairs every deleted long-key representative without retaining its edge reads', () => {
    const index = createOrderedRecordIndex<string>()
    const prefix = 'shared-prefix-'.repeat(100)
    const removed = encode(prefix + 'a')
    let live = true
    const rejectedRead = new Error('deleted representative read')
    const guarded = new Proxy(removed, {
      get(target, name) {
        if (!live && typeof name === 'string' && /^\d+$/.test(name)) throw rejectedRead
        return Reflect.get(target, name, target)
      }
    })
    const leaf = index.set(guarded, 'a')
    index.set(encode(prefix + 'c'), 'c')
    index.set(encode(prefix + 'b'), 'b')
    expect(index.delete(guarded)).toBe(true)
    live = false
    index.set(encode(prefix + 'd'), 'd')
    for (const name of ['b', 'c', 'd']) expect(index.get(encode(prefix + name))!.value).toBe(name)
    expect([...index.range()].map((row) => row.value)).toEqual(['b', 'c', 'd'])
    expect(index.first!.next!.next).toBe(index.last)
    expect(leaf.next).toBeUndefined()
    expect(leaf.previous).toBeUndefined()
    expect(index.delete(encode(prefix + 'b'))).toBe(true)
    expect(index.delete(encode(prefix + 'c'))).toBe(true)
    expect(index.first).toBe(index.last)
    expect(index.first!.value).toBe('d')
  })

  it('localizes a narrow range without reading the unrelated encoded leaf set', () => {
    const index = createOrderedRecordIndex<number>()
    let reads = 0
    for (let key = 0; key < 2000; key++) {
      const bytes = encode(key)
      const guarded = new Proxy(bytes, {
        get(target, name) {
          if (typeof name === 'string' && /^\d+$/.test(name)) reads++
          return Reflect.get(target, name, target)
        }
      })
      index.set(guarded, key)
    }
    reads = 0
    expect(
      [...index.range({ lower: encode(997), upper: encode(999) })].map((leaf) => leaf.value)
    ).toEqual([997, 998, 999])
    expect(reads).toBeLessThan(160)
    expect(index.size).toBe(2000)
  })
})
