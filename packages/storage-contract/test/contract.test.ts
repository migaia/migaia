import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  STORAGE_CONTRACT_SOURCE,
  StorageContractError,
  StorageContractErrorCode,
  assertStorageKey,
  isStorageContractError,
  isStorageCapabilities,
  asSecondaryIndexRecordStore,
  isSecondaryIndexRecordStore,
  asChangeFeedStore,
  isChangeFeedStore
} from '../src/index.js'

describe('StorageContractError 家族', () => {
  it('公开码表 + source 恒为 @migaia/storage-contract', () => {
    expect(Object.keys(StorageContractErrorCode).sort()).toEqual([
      'aborted',
      'changeCursorExpired',
      'concurrencyPolicyFailed',
      'disposed',
      'envelopeInvalid',
      'invalidArgument',
      'invalidKey',
      'lockLost',
      'lockRejected',
      'lockTimeout',
      'migrationFailed',
      'migrationGap',
      'queryEmptyResult',
      'queryNotPushable',
      'rerankFailed',
      'rerankResultInvalid',
      'unsupported',
      'versionUnsupported',
      'writeConflict'
    ])
    const error = new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('bad')
    })
    expect(error.source).toBe(STORAGE_CONTRACT_SOURCE)
    expect(error.source).toBe('@migaia/storage-contract')
    expect(error.code).toBe('INVALID_ARGUMENT')
    expect(error.name).toBe('StorageContractError')
    expect(error.cause).toBeInstanceOf(TypeError)
    expect(isStorageContractError(error)).toBe(true)
  })

  it('码以 Object.freeze 冻结、stack 非空', () => {
    const error = new StorageContractError(StorageContractErrorCode.aborted)
    expect(error.stack).toBeTruthy()
    expect(Object.isFrozen(error)).toBe(true)
    expect(() => {
      ;(error as { code: string }).code = 'changed'
    }).toThrow(TypeError)
  })

  it('领域错误在构造时完成 identity ownership，冻结后不需要 utils attachment', () => {
    const error = new StorageContractError(StorageContractErrorCode.disposed)
    expect(Object.getOwnPropertyDescriptor(error, 'source')).toMatchObject({
      value: STORAGE_CONTRACT_SOURCE,
      enumerable: true,
      writable: false,
      configurable: false
    })
    expect(Object.getOwnPropertyDescriptor(error, 'code')).toMatchObject({
      value: StorageContractErrorCode.disposed,
      enumerable: true,
      writable: false,
      configurable: false
    })
    expect(error).toBeInstanceOf(StorageContractError)
  })
})

describe('assertStorageKey 伪造品牌防护（实现期安全回归）', () => {
  it('拒绝非 key 元素与稀疏数组', () => {
    const overridden = [() => undefined]
    expect(() => assertStorageKey(overridden as never, 'memory', 'key')).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidKey })
    )

    const sparse = Array(1)
    expect(() => assertStorageKey(sparse as never, 'memory', 'key')).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidKey })
    )
  })

  it('拒绝伪造 ArrayBuffer 品牌（constructor.name 伪造）', () => {
    const forged = Object.create({
      constructor: { name: 'ArrayBuffer' },
      slice: () => new ArrayBuffer(2)
    })
    expect(() => assertStorageKey(forged, 'memory', 'key')).toThrow(StorageContractError)
    try {
      assertStorageKey(forged, 'memory', 'key')
      throw new Error('unreachable')
    } catch (error) {
      expect((error as StorageContractError).code).toBe(StorageContractErrorCode.invalidKey)
    }
  })

  it('拒绝伪造 Date 品牌', () => {
    const forged = Object.create({
      constructor: { name: 'Date' },
      getTime: () => 0
    })
    expect(() => assertStorageKey(forged, 'memory', 'key')).toThrow(StorageContractError)
  })

  it('无 structuredClone 时仍拒绝伪造 Date 品牌', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone')
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined })
    try {
      const forged = Object.create({
        constructor: { name: 'Date' },
        getTime: () => 0
      })
      expect(() => assertStorageKey(forged, 'memory', 'key')).toThrow(StorageContractError)
    } finally {
      if (original) Object.defineProperty(globalThis, 'structuredClone', original)
      else Reflect.deleteProperty(globalThis, 'structuredClone')
    }
  })

  it('接受真实 ArrayBuffer / Date key', () => {
    expect(() => assertStorageKey(new ArrayBuffer(8), 'memory', 'key')).not.toThrow()
    expect(() => assertStorageKey(new Date(), 'memory', 'key')).not.toThrow()
    expect(() => assertStorageKey('plain', 'memory', 'key')).not.toThrow()
    expect(() => assertStorageKey(42, 'memory', 'key')).not.toThrow()
  })
})

describe('V2 capability contracts', () => {
  it('exports runtime-neutral capability protocols', () => {
    expect(typeof isStorageCapabilities).toBe('function')
    expect(typeof isSecondaryIndexRecordStore).toBe('function')
    expect(typeof isChangeFeedStore).toBe('function')
  })

  it('capability modules have no host-layer imports', () => {
    const sourceRoot = resolve(process.cwd(), 'src')
    for (const moduleName of ['secondary-index.ts', 'change-feed.ts']) {
      const source = readFileSync(resolve(sourceRoot, moduleName), 'utf8')
      expect(source).not.toMatch(
        /from ['"](?:@migaia\/(?:storage-web|reactive|store)|node:|(?:idb|dom))/i
      )
      expect(source).not.toMatch(/\b(?:IDBDatabase|IDBIndex|AbortSignal|BroadcastChannel|NodeJS)\b/)
    }
  })

  it('legacy capability descriptors remain valid without new flags', () => {
    const capabilities = {
      syncRead: true,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    }
    expect(isStorageCapabilities(capabilities)).toBe(true)
  })

  it('secondary-index and change-feed guards fail closed on partial shapes', () => {
    const partial = { ensureRecordIndexes: () => Promise.resolve() }
    expect(isSecondaryIndexRecordStore(partial)).toBe(false)
    expect(isChangeFeedStore({ subscribeChanges: 1 })).toBe(false)
    expect(() => asSecondaryIndexRecordStore({ backend: 'memory' } as never)).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.unsupported })
    )
    expect(() => asChangeFeedStore({ subscribeChanges: 1 } as never)).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.unsupported })
    )
  })

  it('requires the declared secondary-index capability before added methods', () => {
    const capabilities = {
      syncRead: false,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      maxValueBytes: undefined,
      opaqueEntries: false,
      secondaryIndexes: false,
      changeFeed: false
    }
    const store = {
      backend: 'memory' as const,
      capabilities,
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: async () => false,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined,
      getMany: async () => [],
      setMany: async () => undefined,
      removeMany: async () => 0,
      removeByPrefix: async () => 0,
      dispose: async () => undefined,
      [Symbol.asyncDispose]: async () => undefined,
      getBytes: async () => null,
      setBytes: async () => undefined,
      removeBytes: async () => undefined,
      clearBytes: async () => undefined,
      getRecord: async () => undefined,
      putRecord: async () => 'key',
      deleteRecord: async () => undefined,
      clearRecords: async () => undefined,
      iterateRecords: function* () {},
      transaction: async () => undefined,
      ensureRecordIndexes: async () => undefined,
      getRecordIndexReadiness: async () => undefined,
      putIndexedRecord: async () => 'key',
      iterateRecordIndex: function* () {},
      transactionIndexed: async () => undefined
    } as Record<string, unknown>
    expect(isSecondaryIndexRecordStore(store)).toBe(false)
  })

  it('positively narrows complete secondary-index and change-feed stores', () => {
    const capabilities = {
      syncRead: false,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      maxValueBytes: undefined,
      opaqueEntries: false,
      secondaryIndexes: true,
      changeFeed: true
    }
    const store = {
      backend: 'memory' as const,
      capabilities,
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: async () => false,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined,
      getMany: async () => [],
      setMany: async () => undefined,
      removeMany: async () => 0,
      removeByPrefix: async () => 0,
      dispose: async () => undefined,
      [Symbol.asyncDispose]: async () => undefined,
      getBytes: async () => null,
      setBytes: async () => undefined,
      removeBytes: async () => undefined,
      clearBytes: async () => undefined,
      getRecord: async () => undefined,
      putRecord: async () => 'key',
      deleteRecord: async () => undefined,
      clearRecords: async () => undefined,
      iterateRecords: function* () {},
      transaction: async () => undefined,
      ensureRecordIndexes: async () => undefined,
      getRecordIndexReadiness: async () => undefined,
      putIndexedRecord: async () => 'key',
      iterateRecordIndex: function* () {},
      transactionIndexed: async () => undefined,
      subscribeChanges: () => () => undefined,
      watch: () => {
        throw new Error('watch must not run during admission')
      }
    }
    expect(isSecondaryIndexRecordStore(store)).toBe(true)
    expect(isChangeFeedStore(store)).toBe(true)
    expect(asChangeFeedStore(store)).toBe(store)
    /** A native feed needs both real functions; a capability flag or one method is insufficient. */
    expect(isChangeFeedStore({ ...store, watch: undefined })).toBe(false)
    expect(isChangeFeedStore({ ...store, watch: 1 })).toBe(false)
    expect(isChangeFeedStore({ ...store, subscribeChanges: undefined })).toBe(false)
    expect(isChangeFeedStore({ ...store, subscribeChanges: 1 })).toBe(false)
  })
})
