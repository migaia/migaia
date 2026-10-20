import { describe, expect, it } from 'vitest'
import * as contract from '../src/index.js'

/** Complete callable record port; tests replace only the accessor under admission. */
const makeStore = (): contract.IRecordStore => ({
  backend: 'memory',
  capabilities: {
    syncRead: false,
    binary: true,
    records: true,
    transactions: true,
    iteration: true,
    secondaryIndexes: true,
    changeFeed: true,
    maxValueBytes: undefined,
    opaqueEntries: false
  },
  async get() {
    return null
  },
  async set() {},
  async remove() {},
  async has() {
    return false
  },
  async keys() {
    return []
  },
  async clearValues() {},
  async clearAll() {},
  async dispose() {},
  async getBytes() {
    return null
  },
  async setBytes() {},
  async clearBytes() {},
  async getRecord() {
    return undefined
  },
  async putRecord(_value, key = 'generated') {
    return key
  },
  async deleteRecord() {},
  async clearRecords() {},
  async *iterateRecords() {},
  async transaction(run) {
    return run({
      async get() {
        return undefined
      },
      async put(_value, key = 'generated') {
        return key
      },
      async delete() {}
    })
  }
})

describe('storage-contract audit boundary regressions', () => {
  it('keeps revoked proxies within nonthrowing admission results', () => {
    /** Revocation makes Array.isArray throw before any property getter runs. */
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(contract.isStorageCapabilities(revoked.proxy)).toBe(false)
    expect(contract.snapshotStorageCapabilities(revoked.proxy)).toBeUndefined()
    expect(contract.isKeyValueStore(revoked.proxy)).toBe(false)
    expect(contract.snapshotKeyValueStore(revoked.proxy)).toBeUndefined()
    expect(contract.snapshotRecordStore(revoked.proxy)).toBeUndefined()
    expect(contract.isSecondaryIndexRecordStore(revoked.proxy)).toBe(false)
    expect(contract.isChangeFeedStore(revoked.proxy)).toBe(false)
    expect(contract.snapshotKeyValueStoreDetailed(revoked.proxy)).toEqual({
      valid: false,
      cause: expect.any(TypeError)
    })
  })

  it.each([
    'snapshotCodec',
    'assertCodec',
    'snapshotSyncWriteOptions',
    'assertSyncWriteOptions'
  ] as const)('%s wraps revoked-proxy reflection with the registered identity', (name) => {
    /** Each boundary gets its own revoked input and native reflection failure. */
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    expect(() => contract[name](revoked.proxy)).toThrowError(
      expect.objectContaining({
        source: contract.STORAGE_CONTRACT_SOURCE,
        code: contract.StorageContractErrorCode.invalidArgument,
        cause: expect.any(TypeError)
      })
    )
  })

  it.each(['asRecordStore', 'asSecondaryIndexRecordStore', 'asChangeFeedStore'] as const)(
    '%s preserves a failing capability accessor as the exact cause',
    (name) => {
      /** The original error remains reachable without replacing its object or stack. */
      const original = new Error('capability accessor failed')
      /** This valid port fails only while its capability descriptor is read. */
      const store = makeStore()
      Object.defineProperty(store, 'capabilities', {
        get: () => {
          throw original
        }
      })
      expect(() => contract[name](store)).toThrowError(
        expect.objectContaining({
          source: contract.STORAGE_CONTRACT_SOURCE,
          code: contract.StorageContractErrorCode.unsupported,
          cause: original
        })
      )
    }
  )

  it.each([
    ['asSecondaryIndexRecordStore', 'ensureRecordIndexes'],
    ['asChangeFeedStore', 'subscribeChanges']
  ] as const)('%s preserves its extension-method getter failure', (name, method) => {
    /** Extension inspection must retain failures after successful base admission. */
    const original = new Error('extension accessor failed')
    /** Base admission succeeds without invoking any operation. */
    const store = makeStore()
    Object.defineProperty(store, method, {
      get: () => {
        throw original
      }
    })
    expect(() => contract[name](store)).toThrowError(
      expect.objectContaining({
        code: contract.StorageContractErrorCode.unsupported,
        cause: original
      })
    )
  })
})
