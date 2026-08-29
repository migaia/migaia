import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  STORAGE_CONTRACT_SOURCE,
  StorageContractError,
  StorageContractErrorCode,
  assertStorageKey,
  snapshotOperationContext,
  isStorageContractError,
  isStorageCapabilities,
  snapshotStorageCapabilities,
  asSecondaryIndexRecordStore,
  isSecondaryIndexRecordStore,
  asChangeFeedStore,
  isChangeFeedStore,
  COLLECTIONS_JSON_CODEC_NAME,
  collectionsJsonCodec
} from '../src/index.js'

describe('StorageContractError 家族', () => {
  it('5 码 + source 恒为 @migaia/storage-contract', () => {
    expect(Object.keys(StorageContractErrorCode).sort()).toEqual([
      'aborted',
      'disposed',
      'invalidArgument',
      'invalidKey',
      'unsupported'
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

describe('versioned collection codec', () => {
  it('owns the versioned identity and round-trips nested Map/Set values', async () => {
    expect(COLLECTIONS_JSON_CODEC_NAME).toBe('migaia-collections-json-v1')
    const value = { map: new Map([['key', new Set([1, 2])]]) }
    const encoded = await collectionsJsonCodec.encode(value)
    expect(encoded).toContain(COLLECTIONS_JSON_CODEC_NAME)
    const decoded = (await collectionsJsonCodec.decode(encoded)) as typeof value
    expect(decoded.map).toBeInstanceOf(Map)
    expect(decoded.map.get('key')).toEqual(new Set([1, 2]))
  })

  it('uses intrinsic collection brands without per-node structuredClone work', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone')
    let cloneCalls = 0
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      value: () => {
        cloneCalls += 1
        throw new Error('structuredClone must not classify codec nodes')
      }
    })
    try {
      let value: unknown = { leaf: 'ok' }
      for (let index = 0; index < 128; index += 1) value = { next: value }
      await expect(collectionsJsonCodec.encode(value)).resolves.toContain('"leaf":"ok"')
      expect(cloneCalls).toBe(0)
    } finally {
      if (original) Object.defineProperty(globalThis, 'structuredClone', original)
      else Reflect.deleteProperty(globalThis, 'structuredClone')
    }
  })

  it('keeps forbidden receiver invocation helpers out of the codec delta', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/collections-codec.ts'), 'utf8')
    const forbiddenWords = ['b'.concat('ind'), 'ap'.concat('ply'), 'c'.concat('all')]
    for (const word of forbiddenWords) expect(source).not.toContain(word)
    expect(source).not.toContain(['Reflect', forbiddenWords[1]].join('.'))
  })
})

describe('assertStorageKey 伪造品牌防护（实现期安全回归）', () => {
  it('拒绝覆盖 every 的数组、稀疏数组与 hostile 元素 getter', () => {
    const overridden = [() => undefined]
    Object.defineProperty(overridden, 'every', { value: () => true })
    expect(() => assertStorageKey(overridden as never, 'memory', 'key')).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidKey })
    )

    const sparse = Array(1)
    expect(() => assertStorageKey(sparse as never, 'memory', 'key')).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidKey })
    )

    const hostile = ['safe']
    Object.defineProperty(hostile, 0, {
      get: () => {
        throw new Error('hostile key element')
      }
    })
    expect(() => assertStorageKey(hostile as never, 'memory', 'key')).toThrow(
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

  it('structuredClone 全局 getter 异常不会逃逸出 key validator', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone')
    const cause = new Error('hostile structuredClone getter')
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      get: () => {
        throw cause
      }
    })
    try {
      expect(() => assertStorageKey(new Date(), 'memory', 'key')).toThrow(
        expect.objectContaining({ code: StorageContractErrorCode.invalidKey })
      )
      expect(() => assertStorageKey(new ArrayBuffer(8), 'memory', 'key')).toThrow(
        expect.objectContaining({ code: StorageContractErrorCode.invalidKey })
      )
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

describe('信号结构等价（真实 AbortSignal 满足 IAbortSignal）', () => {
  it('真实 AbortController().signal 被 snapshotOperationContext 接受', () => {
    const controller = new AbortController()
    const snapshot = snapshotOperationContext({ signal: controller.signal })
    expect(snapshot?.signal).toBe(controller.signal)
  })

  it('非法 timeoutMs / pageSize 抛 contract invalidArgument', () => {
    expect(() => snapshotOperationContext({ timeoutMs: -1 } as never)).toThrow(StorageContractError)
    expect(() => snapshotOperationContext({ pageSize: 0 } as never)).toThrow(StorageContractError)
  })
})

describe('V2 capability contracts', () => {
  it('SWV2-T04 exports runtime-neutral capability protocols', () => {
    expect(typeof isStorageCapabilities).toBe('function')
    expect(typeof isSecondaryIndexRecordStore).toBe('function')
    expect(typeof isChangeFeedStore).toBe('function')
  })

  it('SWV2-T04 capability modules have no host-layer imports', () => {
    const sourceRoot = resolve(process.cwd(), 'src')
    for (const moduleName of ['secondary-index.ts', 'change-feed.ts']) {
      const source = readFileSync(resolve(sourceRoot, moduleName), 'utf8')
      expect(source).not.toMatch(
        /from ['"](?:@migaia\/(?:storage-web|reactive|store)|node:|(?:idb|dom))/i
      )
      expect(source).not.toMatch(/\b(?:IDBDatabase|IDBIndex|AbortSignal|BroadcastChannel|NodeJS)\b/)
    }
  })

  it('SWV2-T05 legacy capability descriptors default new flags to false', () => {
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
    expect(snapshotStorageCapabilities(capabilities)).toMatchObject({
      secondaryIndexes: false,
      changeFeed: false
    })
  })

  it('SWV2-T05 secondary-index and change-feed guards fail closed on partial shapes', () => {
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

  it('SWV2-T05 snapshots base capabilities once before added-method inspection', () => {
    let capabilityReads = 0
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
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: async () => false,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined,
      dispose: async () => undefined,
      getBytes: async () => null,
      setBytes: async () => undefined,
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
    Object.defineProperty(store, 'capabilities', {
      get: () => {
        capabilityReads += 1
        return capabilities
      }
    })
    expect(isSecondaryIndexRecordStore(store)).toBe(false)
    expect(capabilityReads).toBe(1)
  })

  it('SWV2-T05 positively narrows complete secondary-index and change-feed stores', () => {
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
      dispose: async () => undefined,
      getBytes: async () => null,
      setBytes: async () => undefined,
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
      subscribeChanges: () => () => undefined
    }
    let capabilityReads = 0
    let changeMethodReads = 0
    Object.defineProperty(store, 'capabilities', {
      get: () => {
        capabilityReads += 1
        return capabilities
      }
    })
    Object.defineProperty(store, 'subscribeChanges', {
      get: () => {
        changeMethodReads += 1
        return () => () => undefined
      }
    })
    expect(isSecondaryIndexRecordStore(store)).toBe(true)
    expect(isChangeFeedStore(store)).toBe(true)
    expect(asChangeFeedStore(store)).toBe(store)
    expect(capabilityReads).toBe(3)
    expect(changeMethodReads).toBe(2)
  })

  it('SWV2-T05 rejects throwing and alternating capability accessors without escaping', () => {
    const base = {
      backend: 'memory' as const,
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: async () => false,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined,
      dispose: async () => undefined
    }
    const capabilityFailure = new Error('capability getter failed')
    const throwingCapabilities = Object.create(null) as Record<string, unknown>
    Object.defineProperty(throwingCapabilities, 'syncRead', {
      get: () => {
        throw capabilityFailure
      }
    })
    const capabilityHostile = { ...base, capabilities: throwingCapabilities }
    expect(() => isChangeFeedStore(capabilityHostile)).not.toThrow()
    expect(isChangeFeedStore(capabilityHostile)).toBe(false)

    let subscribeReads = 0
    const alternating = {
      ...base,
      capabilities: {
        syncRead: false,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        maxValueBytes: undefined,
        opaqueEntries: false,
        secondaryIndexes: false,
        changeFeed: true
      }
    }
    Object.defineProperty(alternating, 'subscribeChanges', {
      get: () => {
        subscribeReads += 1
        if (subscribeReads === 1) return () => () => undefined
        throw new Error('subscribe accessor changed')
      }
    })
    expect(isChangeFeedStore(alternating)).toBe(true)
    expect(isChangeFeedStore(alternating)).toBe(false)
    expect(subscribeReads).toBe(2)
  })

  it('SWV2-T05 asChangeFeedStore reads a hostile method once and preserves unsupported identity', () => {
    let subscribeReads = 0
    const store = {
      backend: 'memory' as const,
      capabilities: {
        syncRead: false,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        maxValueBytes: undefined,
        opaqueEntries: false,
        secondaryIndexes: false,
        changeFeed: true
      },
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: async () => false,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined,
      dispose: async () => undefined
    }
    Object.defineProperty(store, 'subscribeChanges', {
      get: () => {
        subscribeReads += 1
        throw new Error('subscribe accessor failed')
      }
    })
    expect(() => asChangeFeedStore(store as never)).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.unsupported })
    )
    expect(subscribeReads).toBe(1)
  })
})
