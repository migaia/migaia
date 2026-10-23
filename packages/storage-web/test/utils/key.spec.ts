import { describe, expect, it } from 'vitest'
import { decodeFlatStorageKey, encodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'
import {
  lengthPrefixedNamespaceCodec,
  namespacedKey,
  namespacedStorageKey,
  snapshotNamespaceCodec,
  stripNamespace,
  stripStorageNamespace
} from '../../src/utils/key.js'

describe('namespacedKey / stripNamespace', () => {
  it('默认 namespace codec runtime descriptor 不可变', () => {
    expect(() => {
      ;(lengthPrefixedNamespaceCodec as unknown as { encode: () => string }).encode = () =>
        'changed'
    }).toThrow(TypeError)
    expect(namespacedKey('app', 'k')).toBe('sw1:3:app:k')
  })

  it('拼接命名空间前缀', () => {
    expect(namespacedKey('app', 'k')).toBe('sw1:3:app:k')
  })
  it('剥离匹配的命名空间前缀', () => {
    expect(stripNamespace('app', 'sw1:3:app:k')).toBe('k')
  })
  it('不匹配的前缀返回 undefined', () => {
    expect(stripNamespace('app', 'other:k')).toBeUndefined()
  })
  it('key 本身含冒号时仍能正确剥离（只匹配一次前缀）', () => {
    expect(stripNamespace('app', 'sw1:3:app:a:b:c')).toBe('a:b:c')
  })

  it('keeps typed keys disjoint from every original string key and namespace', () => {
    /** The typed wire is a physical version, not an escapable suffix of an old string key. */
    const physical = namespacedStorageKey(
      '应用:cache',
      ['items', 1],
      lengthPrefixedNamespaceCodec,
      'local-storage'
    )
    expect(physical.startsWith('sw2:')).toBe(true)
    expect(namespacedKey('应用:cache', physical)).not.toBe(physical)
    expect(stripNamespace('应用:cache', physical)).toBeUndefined()
    expect(
      stripStorageNamespace('应用:cache', physical, lengthPrefixedNamespaceCodec, 'local-storage')
    ).toEqual(['items', 1])
    expect(
      stripStorageNamespace('other', physical, lengthPrefixedNamespaceCodec, 'local-storage')
    ).toBeUndefined()
    expect(namespacedStorageKey('app', 'k', lengthPrefixedNamespaceCodec, 'local-storage')).toBe(
      'sw1:3:app:k'
    )
  })

  it('captures optional typed codec functions once while retaining the original snapshot receiver', () => {
    /** Existing encode/decode reads remain first; the new pair follows under the same boundary. */
    const reads: string[] = []
    /** Receiver observation proves that no bound function or alternate codec object is introduced. */
    const receivers: unknown[] = []
    const captured = snapshotNamespaceCodec(
      {
        get encode() {
          reads.push('encode')
          return () => 'old'
        },
        get decode() {
          reads.push('decode')
          return () => undefined
        },
        get encodeStorageKey() {
          reads.push('encodeStorageKey')
          return function (this: unknown) {
            receivers.push(this)
            return 'typed'
          }
        },
        get decodeStorageKey() {
          reads.push('decodeStorageKey')
          return () => 1
        }
      },
      'local-storage'
    )
    expect(reads).toEqual(['encode', 'decode', 'encodeStorageKey', 'decodeStorageKey'])
    expect(namespacedStorageKey('app', 1, captured, 'local-storage')).toBe('typed')
    expect(receivers[0]).toBe(captured)
    expect(stripStorageNamespace('app', 'typed', captured, 'local-storage')).toBe(1)
    expect(reads).toHaveLength(4)
    /** Original invalid string codecs reject before any newly optional typed getter runs. */
    let typedRead = false
    expect(() =>
      snapshotNamespaceCodec({
        encode: 1,
        decode: () => undefined,
        get encodeStorageKey() {
          typedRead = true
          return () => 'unread'
        }
      })
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_CONFIG',
        cause: expect.objectContaining({
          message: 'namespace codec must provide callable encode and decode methods'
        })
      })
    )
    expect(typedRead).toBe(false)
    expect(() =>
      namespacedStorageKey(
        'app',
        1,
        snapshotNamespaceCodec({ encode: () => 'old', decode: () => undefined }),
        'local-storage'
      )
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' }))
  })

  it('rejects incomplete typed codec pairs and preserves typed getter failures', () => {
    for (const decodeStorageKey of [undefined, 1])
      expect(() =>
        snapshotNamespaceCodec({
          encode: () => 'old',
          decode: () => undefined,
          encodeStorageKey: () => 'typed',
          decodeStorageKey
        })
      ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }))
    /** Extension getter failures retain the original instance on the existing config boundary. */
    const original = new Error('typed-getter')
    expect(() =>
      snapshotNamespaceCodec({
        encode: () => 'old',
        decode: () => undefined,
        get encodeStorageKey() {
          throw original
        }
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG', cause: original }))
  })

  it('codes typed extension failures and rejects invalid decoded keys', () => {
    /** Custom encode and decode failures preserve the original cause in both directions. */
    const original = new Error('typed-extension')
    /** The captured pair invokes the caller's real throwing functions in both directions. */
    const failed = snapshotNamespaceCodec({
      encode: () => 'old',
      decode: () => undefined,
      encodeStorageKey: () => {
        throw original
      },
      decodeStorageKey: () => {
        throw original
      }
    })
    expect(() => namespacedStorageKey('app', 1, failed, 'local-storage')).toThrow(
      expect.objectContaining({ code: 'EXTENSION_FAILED', cause: original })
    )
    expect(() => stripStorageNamespace('app', 'typed', failed, 'local-storage')).toThrow(
      expect.objectContaining({ code: 'EXTENSION_FAILED', cause: original })
    )
    /** A custom codec cannot admit an invalid native key or a non-string physical identity. */
    const invalid = snapshotNamespaceCodec({
      encode: () => 'old',
      decode: () => undefined,
      encodeStorageKey: () => 1,
      decodeStorageKey: () => []
    })
    expect(() => namespacedStorageKey('app', 1, invalid, 'local-storage')).toThrow(
      expect.objectContaining({ code: 'EXTENSION_FAILED' })
    )
    expect(() => stripStorageNamespace('app', 'typed', invalid, 'local-storage')).toThrow(
      expect.objectContaining({
        code: 'EXTENSION_FAILED',
        cause: expect.objectContaining({ code: 'INVALID_KEY' })
      })
    )
    expect(
      stripStorageNamespace(
        'app',
        `sw2:3:app:${encodeFlatStorageKey('unowned')}`,
        lengthPrefixedNamespaceCodec,
        'local-storage'
      )
    ).toBeUndefined()
  })
})

describe('flat storage key codec', () => {
  it('flat 编码可逆保留全部主键类型', () => {
    const values = [
      'a:b',
      3,
      new Date('2030-01-01T00:00:00.000Z'),
      new Uint8Array([1, 2]).buffer,
      [['x'], 2]
    ] as const
    for (const value of values)
      expect(decodeFlatStorageKey(encodeFlatStorageKey(value))).toEqual(value)
  })
})
