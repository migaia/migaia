import { describe, expect, it, vi } from 'vitest'
import {
  resolveStorageNamespace,
  safeJsonPayloadByteLength,
  createStorageToken,
  isStorageKeyInRange
} from '../src/authoring/backend.ts'

/** The canonical zero UUID remains the default physical-target identity. */
const defaultOrg = '00000000-0000-0000-0000-000000000000'
/** Distinct canonical organizations retain every configured instance prefix. */
const otherOrg = '10000000-0000-0000-0000-000000000000'

describe('finite backend authoring functions', () => {
  it('preserves the native UUID receiver and cause when entropy fails', () => {
    /** Native UUID failure must retain its identity behind the existing capability boundary. */
    const original = new Error('native UUID failed')
    /** The original supported native crypto function is the only replaced test dependency. */
    const native = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockImplementation(function (this: typeof globalThis.crypto) {
        expect(this).toBe(globalThis.crypto)
        throw original
      })
    try {
      expect(() => createStorageToken()).toThrowError(
        expect.objectContaining({
          source: 'storage.contract',
          code: 'UNSUPPORTED_CAPABILITY',
          cause: original
        })
      )
      expect(native).toHaveBeenCalledTimes(1)
    } finally {
      native.mockRestore()
    }
  })
  it('retains configured namespace targets and rejects only a slash UUID suffix', () => {
    expect(resolveStorageNamespace('prefs')).toBe('prefs')
    expect(resolveStorageNamespace(otherOrg)).toBe(otherOrg)
    expect(() => resolveStorageNamespace(`prefs/${otherOrg}`)).toThrowError(
      expect.objectContaining({ source: 'storage.contract', code: 'INVALID_ARGUMENT' })
    )
    expect(resolveStorageNamespace('prefs', defaultOrg, defaultOrg)).toBe('prefs')
    expect(resolveStorageNamespace('prefs', otherOrg, defaultOrg)).toBe(`prefs/${otherOrg}`)
    expect(resolveStorageNamespace('cache', otherOrg, defaultOrg)).toBe(`cache/${otherOrg}`)
    expect(resolveStorageNamespace(otherOrg, defaultOrg, defaultOrg)).toBe(otherOrg)
    expect(resolveStorageNamespace('prefs/not-a-uuid', defaultOrg, defaultOrg)).toBe(
      'prefs/not-a-uuid'
    )
    expect(resolveStorageNamespace('prefs', otherOrg, otherOrg)).toBe('prefs')
    expect(() => resolveStorageNamespace(`prefs/${otherOrg}`, defaultOrg, defaultOrg)).toThrowError(
      expect.objectContaining({ source: 'storage.contract', code: 'INVALID_ARGUMENT' })
    )
    expect(() => resolveStorageNamespace('prefs', 'INVALID', defaultOrg)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('preserves original range, JSON byte budget and opaque-token behavior', () => {
    expect(isStorageKeyInRange('b', { lower: 'a', upper: 'b', upperOpen: true })).toBe(false)
    expect(isStorageKeyInRange(['tenant', 2], { lower: ['tenant', 1], upper: ['tenant', 3] })).toBe(
      true
    )
    expect(safeJsonPayloadByteLength({ text: '中文' })).toBe(17)
    expect(safeJsonPayloadByteLength({ map: new Map() })).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeJsonPayloadByteLength({ nested: undefined })).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeJsonPayloadByteLength(undefined)).toBe(0)
    expect(createStorageToken()).not.toBe(createStorageToken())
  })
})
