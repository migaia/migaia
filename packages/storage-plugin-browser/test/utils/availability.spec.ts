import { describe, expect, it, vi } from 'vitest'
import { probeWebStorage } from '../../src/utils/availability.ts'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.ts'
import type { IWebStorageLike } from '../../src/types/storage.ts'

describe('probeWebStorage', () => {
  it('storage 为 undefined 时返回 false', () => {
    expect(probeWebStorage(undefined)).toBe(false)
  })

  it('可写入可删除的 storage 返回 true', () => {
    expect(probeWebStorage(fakeWebStorage())).toBe(true)
  })

  it('探测不污染原有数据', () => {
    const storage = fakeWebStorage()
    storage.setItem('existing', 'value')
    probeWebStorage(storage)
    expect(storage.getItem('existing')).toBe('value')
    expect(storage.length).toBe(1)
  })

  it('探测键已有值时恢复原值', () => {
    const storage = fakeWebStorage()
    storage.setItem('__storage_web_probe__', 'caller-value')
    expect(probeWebStorage(storage)).toBe(true)
    expect(storage.getItem('__storage_web_probe__')).toBe('caller-value')
  })

  it('探测键已有值且该键不可覆盖时改用临时键，不误报 storage 不可用', () => {
    const storage = fakeWebStorage()
    storage.setItem('__storage_web_probe__', 'caller-value')
    const originalSetItem = storage.setItem
    storage.setItem = (key, value) => {
      if (key === '__storage_web_probe__') throw new Error('existing key is protected')
      originalSetItem(key, value)
    }
    expect(probeWebStorage(storage)).toBe(true)
    expect(storage.getItem('__storage_web_probe__')).toBe('caller-value')
    expect(storage.length).toBe(1)
  })

  it('生成的临时键与调用方数据冲突时换用下一个键，不覆盖也不删除调用方数据', () => {
    const storage = fakeWebStorage()
    vi.spyOn(Date, 'now').mockReturnValue(0)
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.5)
    try {
      /** First generated fallback key, prefilled so it collides with caller data. */
      const collidingKey = `__storage_web_probe__:0:${(0.25).toString(36).slice(2)}`
      storage.setItem('__storage_web_probe__', 'caller-base')
      storage.setItem(collidingKey, 'caller-fallback')
      expect(probeWebStorage(storage)).toBe(true)
      expect(storage.getItem('__storage_web_probe__')).toBe('caller-base')
      expect(storage.getItem(collidingKey)).toBe('caller-fallback')
      expect(storage.length).toBe(2)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('所有候选键都被调用方占用时返回 false，且调用方数据不变', () => {
    const storage = fakeWebStorage()
    vi.spyOn(Date, 'now').mockReturnValue(0)
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    try {
      /** The only fallback key the stubbed generator can produce, prefilled by the caller. */
      const collidingKey = `__storage_web_probe__:0:${(0.25).toString(36).slice(2)}`
      storage.setItem('__storage_web_probe__', 'caller-base')
      storage.setItem(collidingKey, 'caller-fallback')
      expect(probeWebStorage(storage)).toBe(false)
      expect(storage.getItem('__storage_web_probe__')).toBe('caller-base')
      expect(storage.getItem(collidingKey)).toBe('caller-fallback')
      expect(storage.length).toBe(2)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('setItem 抛错（隐私模式）时返回 false', () => {
    const storage: Storage = {
      get length() {
        return 0
      },
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      }
    }
    expect(probeWebStorage(storage)).toBe(false)
  })

  it('getItem/removeItem 抛错时返回 false，不泄漏原始异常', () => {
    const throwing = (mode: 'get' | 'remove'): IWebStorageLike => ({
      length: 0,
      getItem: () => {
        if (mode === 'get') throw new Error('get')
        return null
      },
      setItem: () => {},
      removeItem: () => {
        if (mode === 'remove') throw new Error('remove')
      },
      key: () => null,
      clear: () => {}
    })
    expect(probeWebStorage(throwing('get'))).toBe(false)
    expect(probeWebStorage(throwing('remove'))).toBe(false)
  })
})
