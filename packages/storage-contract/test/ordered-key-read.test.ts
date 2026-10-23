import { describe, it, expect } from 'vitest'
import {
  encodeOrderedStorageKey,
  decodeOrderedStorageKey,
  prefixStorageOrgKey,
  unprefixStorageOrgKey
} from '../src/index.js'

describe('ordered physical key reader', () => {
  it('reads the original complete scalar and nested tuple domains without changing UTF-16 units', () => {
    for (const key of [
      '',
      '\u0000\ud800\udfff\uffff',
      -12.5,
      0,
      12.5,
      Number.MAX_VALUE,
      new Date(123),
      new ArrayBuffer(0),
      new Uint8Array([0, 1, 255]).buffer,
      ['nested', [1, new Date(2), new Uint8Array([3]).buffer]]
    ])
      expect(decodeOrderedStorageKey(encodeOrderedStorageKey(key, 'object'), 'object')).toEqual(key)
  })

  it('allows the original organization owner to validate and remove exactly its own segment', () => {
    const org = '00000000-0000-0000-0000-000000000001'
    const physical = prefixStorageOrgKey(org, 'file/\ud800')
    expect(
      unprefixStorageOrgKey(
        org,
        decodeOrderedStorageKey(encodeOrderedStorageKey(physical, 'object'), 'object')
      )
    ).toBe('file/\ud800')
  })

  it('rejects incomplete, unknown, trailing and noncanonical encodings with INVALID_KEY', () => {
    for (const bytes of [
      [],
      [99],
      [3, 1],
      [3, 2, 0],
      [5, 0],
      [3, 0, 0],
      [1, 127, 255, 255, 255, 255, 255, 255, 255],
      [1, 255, 240, 0, 0, 0, 0, 0, 0]
    ])
      expect(() => decodeOrderedStorageKey(new Uint8Array(bytes), 'object')).toThrowError(
        expect.objectContaining({ code: 'INVALID_KEY', backend: 'object' })
      )
    const deep = new Uint8Array([...Array(34).fill(5), 3, 0, ...Array(34).fill(0)])
    expect(() => decodeOrderedStorageKey(deep, 'object')).toThrowError(
      expect.objectContaining({ code: 'INVALID_KEY' })
    )
  })
})
