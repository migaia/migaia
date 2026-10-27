import { describe, expect, it } from 'vitest'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { asRecordStore, isKeyValueStore, isRecordStore } from '../../src/types/storage'
import { createMemoryTestStore } from '../helpers/installed-backends.js'
import { createLocalTestStore } from '../helpers/installed-backends.js'
import type { IStorageCapabilities } from '../../src/types/capabilities'
import type { IKeyValueStore } from '../../src/types/storage'

const fakeStore = (capabilities: Partial<IStorageCapabilities>) => ({
  backend: 'local' as const,
  capabilities: {
    syncRead: true,
    binary: false,
    records: false,
    transactions: false,
    iteration: false,
    secondaryIndexes: false,
    changeFeed: false,
    maxValueBytes: undefined,
    opaqueEntries: false,
    ...capabilities
  },
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  has: async () => false,
  keys: async () => [],
  clearValues: async () => {},
  clearAll: async () => {},
  dispose: async () => {},
  [asyncDisposeKey]: async () => {},
  getBytes: async () => null,
  setBytes: async () => {},
  removeBytes: async () => {},
  clearBytes: async () => {},
  getRecord: async () => undefined,
  putRecord: async () => 'key',
  deleteRecord: async () => {},
  clearRecords: async () => {},
  iterateRecords: () => ({}),
  transaction: async () => undefined
})

describe('asRecordStore / isRecordStore', () => {
  it('isKeyValueStore 拒绝缺少 L0 方法或畸形 capability descriptor', () => {
    const missingMethod = fakeStore({})
    delete (missingMethod as Partial<Record<string, unknown>>).get
    expect(isKeyValueStore(missingMethod)).toBe(false)
    expect(isRecordStore(missingMethod as IKeyValueStore)).toBe(false)
    const invalidCapabilities = fakeStore({})
    ;(invalidCapabilities.capabilities as { opaqueEntries: unknown }).opaqueEntries = 'no'
    expect(isKeyValueStore(invalidCapabilities)).toBe(false)
  })
  it('运行时收到 null 或缺少 capabilities 时返回 false/稳定抛 UNSUPPORTED_CAPABILITY', () => {
    expect(isRecordStore(null as unknown as IKeyValueStore)).toBe(false)
    expect(() => asRecordStore(null as unknown as IKeyValueStore)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    expect(isRecordStore({} as IKeyValueStore)).toBe(false)
    expect(() => asRecordStore({} as IKeyValueStore)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
  })

  it('records 能力为 true 时收窄成功', () => {
    const store = fakeStore({ records: true, binary: true, transactions: true, iteration: true })
    expect(() => asRecordStore(store)).not.toThrow()
    expect(isRecordStore(store)).toBe(true)
  })
  it('records 能力为 true 但缺少 record 方法时拒绝收窄', () => {
    const store = fakeStore({ records: true, binary: true, transactions: true, iteration: true })
    delete (store as Partial<Record<string, unknown>>).transaction
    expect(isRecordStore(store)).toBe(false)
    expect(() => asRecordStore(store)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
  })
  it('records 能力与 L1 capability flags 矛盾时拒绝收窄', () => {
    const store = fakeStore({ records: true, binary: false, transactions: true, iteration: true })
    expect(isRecordStore(store)).toBe(false)
    expect(() => asRecordStore(store)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
  })
  it('records 能力为 false 时抛 UNSUPPORTED_CAPABILITY', () => {
    const store = fakeStore({ records: false })
    expect(() => asRecordStore(store)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    expect(isRecordStore(store)).toBe(false)
  })
  it('memoryStorageHost 支持 records，可被收窄', async () => {
    expect(isRecordStore(await createMemoryTestStore())).toBe(true)
  })
  it('localStorageHost 不支持 records，收窄抛错', async () => {
    const values = new Map<string, string>()
    const store = await createLocalTestStore({
      namespace: 'test',
      storage: {
        get length() {
          return values.size
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => void values.delete(key),
        setItem: (key, value) => void values.set(key, value)
      }
    })
    expect(isRecordStore(store)).toBe(false)
    expect(() => asRecordStore(store)).toThrow()
  })
})
