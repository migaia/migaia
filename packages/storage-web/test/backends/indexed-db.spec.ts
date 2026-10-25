import { entityTestFeatures } from '../helpers/entity-features.js'
import {
  kv,
  records,
  isChangeFeedStore,
  type IStorageChange,
  type IStorageKey
} from '@migaia/storage-contract'
import {
  forceCloseDatabase,
  IDBCursor,
  IDBDatabase,
  IDBFactory,
  IDBKeyRange,
  IDBObjectStore
} from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import {
  defineEntity,
  REPOSITORY_KEY_PREFIX,
  RecordIndexBackfillPhase,
  type IRecordIndexBackfillStore
} from '@migaia/storage-host/entity'
import type { IKeyValueStore } from '@migaia/storage-contract'
import { createOrgId, createStorageHost, STORAGE_HOST_SOURCE } from '@migaia/storage-host'
import { STORAGE_WEB_SOURCE } from '../../src/index.js'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { walkErrorCauses } from '@migaia/utils/error'
import { encodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'
import { captureOperationCleanup } from '../helpers/operation-reporter.js'
import {
  createIndexedDbTestStore,
  createIndexedDbBackfillTestStore
} from '../helpers/installed-backends.js'

/** Public installation keeps the original native failure reachable below its host/plugin wrappers. */
const expectNativeInstallationFailure = async (
  pending: Promise<unknown>,
  expected: Record<string, unknown>
): Promise<void> => {
  const failure: unknown = await pending.then(
    () => undefined,
    (cause: unknown) => cause
  )
  const identity = failure as { readonly source?: unknown } | undefined
  if (identity?.source !== STORAGE_WEB_SOURCE)
    expect(failure).toMatchObject({ source: STORAGE_HOST_SOURCE, code: 'BACKEND_INSTALL_FAILED' })
  expect(walkErrorCauses(failure)).toContainEqual(expect.objectContaining(expected))
}

const encoder = new TextEncoder()

/** 每个用例一套全新的 IndexedDB，避免相互串数据。 */
const freshFactory = () => new IDBFactory()
const freshDb = () =>
  createIndexedDbTestStore({
    factory: freshFactory(),
    keyRange: IDBKeyRange,
    dbName: `test-${Math.random().toString(36).slice(2)}`
  })
/** Capture the actual provider during the same real plugin installation, without a lookup registry. */
const createBackfillDb = (
  options: Parameters<typeof createIndexedDbTestStore>[0] = {
    factory: freshFactory(),
    keyRange: IDBKeyRange,
    dbName: `test-1o8ee6u6sqp`
  }
) => createIndexedDbBackfillTestStore(options)

/** Native key fixtures derive canonical identity through the same actual public repository. */
const entityRecordKey = (store: IKeyValueStore, scope: string, id: IStorageKey): IStorageKey =>
  defineEntity<{ id: IStorageKey }>({ features: entityTestFeatures, name: scope, key: 'id' })
    .connect(store)
    .lockKey(id).key

/** These explicit bounds select the known native canonical-key fixture prefix. */
const canonicalFixtureRange = (scope: string) => ({
  lower: [REPOSITORY_KEY_PREFIX, scope, ''],
  upper: [REPOSITORY_KEY_PREFIX, scope, '\uffff']
})

/** Legacy native fixture keys use the original public record channel and remain ordinary data. */
const legacyFixtureRange = (scope: string) => ({
  lower: [scope],
  upper: [scope, '\uffff']
})

/** Test-only physical scope for the string-key fixtures in this file. */
const backfillOptions = {
  range: { lower: '', upper: '\uffff' },
  allowComplete: true
} as const

type ITestBroadcastMessage = {
  readonly data: unknown
}

/** Minimal in-process BroadcastChannel transport for deterministic same-page coordination tests. */
class TestBroadcastChannel {
  static readonly channels = new Map<string, Set<TestBroadcastChannel>>()
  static readonly instances: TestBroadcastChannel[] = []
  static closedCount = 0
  readonly name: string
  onmessage: ((event: ITestBroadcastMessage) => void) | null = null
  /** Tracks the one terminal close transition used by the fake transport. */
  #closed = false

  constructor(name: string) {
    this.name = name
    TestBroadcastChannel.instances.push(this)
    const members = TestBroadcastChannel.channels.get(name) ?? new Set<TestBroadcastChannel>()
    members.add(this)
    TestBroadcastChannel.channels.set(name, members)
  }

  addEventListener(type: string, listener: (event: ITestBroadcastMessage) => void): void {
    if (type === 'message') this.onmessage = listener
  }

  removeEventListener(type: string, listener: (event: ITestBroadcastMessage) => void): void {
    if (type === 'message' && this.onmessage === listener) this.onmessage = null
  }

  postMessage(data: unknown): void {
    if (this.#closed) throw new Error('closed test channel')
    const members = TestBroadcastChannel.channels.get(this.name) ?? new Set()
    for (const member of members) {
      if (member === this || member.#closed || member.onmessage === null) continue
      queueMicrotask(() => member.onmessage?.({ data }))
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    TestBroadcastChannel.closedCount += 1
    const members = TestBroadcastChannel.channels.get(this.name)
    members?.delete(this)
    if (members?.size === 0) TestBroadcastChannel.channels.delete(this.name)
  }
}

describe('indexedDbHost backend', () => {
  it('seeks prefixes without IDBKeyRange while preserving earlier and later native keys', async () => {
    /** Missing range support uses the same native cursor rather than a different backend. */
    const store = await createIndexedDbTestStore({
      factory: freshFactory(),
      dbName: 'prefix-without-keyrange'
    })
    for (const key of ['a', 'team:1', 'team:2', 'z']) await store.set(key, key)
    await expect(store.use(kv).removeByPrefix('team:')).resolves.toBe(2)
    expect(await store.keys()).toEqual(['a', 'z'])
    await expect(store.use(kv).removeByPrefix('missing:')).resolves.toBe(0)
    for (const key of [['a'], ['team', '1'], ['team', '2'], ['z']] as const)
      await store.putRecord({ key }, key)
    await expect(store.use(records).removeByPrefix(['team'])).resolves.toBe(2)
    expect(await store.getRecord(['a'])).toEqual({ key: ['a'] })
    expect(await store.getRecord(['z'])).toEqual({ key: ['z'] })
    expect(await store.getRecord(['team', '1'])).toBeUndefined()
    await store.clearAll()
    await expect(store.use(records).removeByPrefix(['team'])).resolves.toBe(0)
  })

  it('keeps inclusive upper-only and empty record ranges in native order', async () => {
    /** The public iterator snapshots each caller range before opening its native page. */
    const store = await freshDb()
    for (const key of ['a', 'b', 'c']) await store.putRecord({ key }, key)
    /** An omitted upperOpen includes the boundary row. */
    const bounded: IStorageKey[] = []
    for await (const [key] of store.iterateRecords({ upper: 'b' })) bounded.push(key)
    expect(bounded).toEqual(['a', 'b'])
    /** An explicitly empty range retains the same full source as an omitted range. */
    const all: IStorageKey[] = []
    for await (const [key] of store.iterateRecords({})) all.push(key)
    expect(all).toEqual(['a', 'b', 'c'])
  })

  it('keeps transaction record queries usable without keyset and rejects paging at its terminal', async () => {
    /** No optional assembly is selected, so the missing keyset belongs to this registration. */
    await using host = await createStorageHost({
      plugins: [indexedDbBackendPlugin({ factory: freshFactory(), keyRange: IDBKeyRange })]
    })
    /** The ordinary backend retains native transactions without granting optional pagination. */
    const store = host.backend('indexed-db')
    await store.putRecord({ value: 'kept' }, 'row')
    await expect(
      store.transaction(async (scope) => {
        expect(await scope.use(records).query().all()).toEqual([{ value: 'kept' }])
        await scope.use(records).query().page(1)
      })
    ).rejects.toMatchObject({
      source: STORAGE_WEB_SOURCE,
      code: 'INDEXED_DB_FEATURE_NOT_INSTALLED',
      message: expect.stringContaining('indexedDbKeysetFeature')
    })
    expect(await store.getRecord('row')).toEqual({ value: 'kept' })
  })

  it('rejects a non-string transaction value without committing its earlier write', async () => {
    /** Runtime inputs still pass through the original transaction validation boundary. */
    const store = await freshDb()
    await expect(
      store.transaction(async (scope) => {
        await scope.set('first', 'rolled back')
        await scope.set('invalid', 42 as never)
      })
    ).rejects.toMatchObject({ source: STORAGE_WEB_SOURCE, code: 'INVALID_CONFIG' })
    expect(await store.get('first')).toBeNull()
    expect(await store.get('invalid')).toBeNull()
  })

  it('reopens after a native forced close without losing committed text or records', async () => {
    /** Observing the injected native factory obtains the actual owned connection. */
    const factory = freshFactory()
    /** The public port observer forwards every real open and upgrade. */
    const opening = vi.spyOn(factory, 'open')
    /** Installation owns this connection until native storage reports its close event. */
    const store = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName: 'native-close-recovery'
    })
    await store.set('text', 'committed')
    await store.putRecord({ value: 'record' }, 'row')
    /** The last successful native open is the active installed connection, not a replacement. */
    const database = opening.mock.results.at(-1)!.value.result as IDBDatabase
    /** Await the actual native close event before exercising automatic reopening. */
    const closed = new Promise<void>((resolve) => {
      database.addEventListener('close', () => resolve(), { once: true })
    })
    opening.mockClear()
    // fake-indexeddb's declaration mistakenly takes a constructor; its runtime takes the database.
    forceCloseDatabase(database as unknown as typeof IDBDatabase)
    await closed
    expect(await store.get('text')).toBe('committed')
    expect(await store.getRecord('row')).toEqual({ value: 'record' })
    expect(opening).toHaveBeenCalledExactlyOnceWith('native-close-recovery')
  })

  it.each(['request', 'throw'] as const)(
    'retains a native delete %s failure and allows the organization to reopen unchanged',
    async (failureMode) => {
      /** Each organization deletion owns a real installed database and committed sentinel. */
      const factory = freshFactory()
      /** An explicit default organization targets the configured physical database. */
      const org = createOrgId()
      await using host = await createStorageHost({
        org,
        plugins: [
          indexedDbBackendPlugin({ factory, keyRange: IDBKeyRange, dbName: 'failed-delete' })
        ]
      })
      /** The borrowed view remains usable after the failed maintenance operation settles. */
      const store = host.backend('indexed-db')
      await store.set('sentinel', 'preserved')
      /** The injected native port reports its original failure without deleting storage. */
      const cause = new DOMException('native deletion denied', 'SecurityError')
      /** This fault replaces only the one native request; normal reads and opens remain real. */
      const deletion = vi.spyOn(factory, 'deleteDatabase').mockImplementationOnce(() => {
        if (failureMode === 'throw') throw cause
        return {
          error: cause,
          set onblocked(_handler: unknown) {},
          set onupgradeneeded(_handler: unknown) {},
          set onsuccess(_handler: unknown) {},
          set onerror(handler: () => void) {
            queueMicrotask(handler)
          }
        } as unknown as IDBOpenDBRequest
      })
      /** Capture the public failure chain before checking native identity and recovery. */
      const failure: unknown = await host.dropOrg(org).catch((error: unknown) => error)
      expect(walkErrorCauses(failure)).toContainEqual(
        expect.objectContaining({
          source: STORAGE_WEB_SOURCE,
          code: 'BACKEND_UNAVAILABLE',
          operation: 'indexeddb.delete',
          cause
        })
      )
      expect(walkErrorCauses(failure)).toContain(cause)
      expect(deletion).toHaveBeenCalledExactlyOnceWith('failed-delete')
      expect(await store.get('sentinel')).toBe('preserved')
    }
  )

  it('rejects a future schema checkpoint without overwriting metadata or committed data', async () => {
    /** The original public backend creates the supported layout before a newer writer takes over. */
    const factory = freshFactory()
    /** Native request observation exposes the same physical database used by ordinary writes. */
    const opening = vi.spyOn(factory, 'open')
    /** Installation and the raw metadata edit share this existing database name. */
    const options = { factory, keyRange: IDBKeyRange, dbName: 'future-schema-preserved' }
    /** A real supported write provides data that the rejected older reader must leave intact. */
    const store = await createIndexedDbTestStore(options)
    await store.set('sentinel', 'preserved')
    /** A future producer updates the actual durable schema checkpoint through the native port. */
    const database = opening.mock.results.at(-1)!.value.result as IDBDatabase
    await new Promise<void>((resolve, reject) => {
      /** Both writes belong to the existing physical metadata store's native transaction. */
      const transaction = database.transaction('storage-web:meta', 'readwrite')
      transaction
        .objectStore('storage-web:meta')
        .put({ version: 4 }, ['__storage_web_internal__', 'schema'])
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
    })
    await store.dispose()
    await expectNativeInstallationFailure(createIndexedDbTestStore(options), {
      source: STORAGE_WEB_SOURCE,
      code: 'VERSION_UNSUPPORTED',
      operation: 'indexeddb.schema'
    })
    /** Independent native reading verifies that failed installation does not downgrade data. */
    const preserved = await new Promise<IDBDatabase>((resolve, reject) => {
      /** This connection is read-only inspection after the rejected host released its handle. */
      const request = factory.open(options.dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      for (const [storeName, key, expected] of [
        ['kv', 'sentinel', 'preserved'],
        ['storage-web:meta', ['__storage_web_internal__', 'schema'], { version: 4 }]
      ] as const) {
        await expect(
          new Promise<unknown>((resolve, reject) => {
            /** Each assertion reads the independently opened native transaction directly. */
            const request = preserved
              .transaction(storeName, 'readonly')
              .objectStore(storeName)
              .get(typeof key === 'string' ? key : [...key])
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
        ).resolves.toEqual(expected)
      }
    } finally {
      preserved.close()
    }
  })

  it.each(['kv', 'storage-web:meta', '__storage_web_revisions__'])(
    'rejects an existing keyPath on %s without deleting the database',
    async (keyPathStore) => {
      /** A physical database created by another producer can conflict with this declared layout. */
      const factory = freshFactory()
      /** The native schema conflict remains stable until the caller repairs or replaces storage. */
      const dbName = 'foreign-keypath-' + keyPathStore
      /** Seed only a real native schema, with one unsupported keyPath among otherwise valid stores. */
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        /** The supplied schema is accepted by IndexedDB but incompatible with this backend. */
        const request = factory.open(dbName, 1)
        request.onupgradeneeded = () => {
          for (const name of [
            'kv',
            'bytes',
            'records',
            'storage-web:meta',
            '__storage_web_revisions__'
          ])
            request.result.createObjectStore(name, name === keyPathStore ? { keyPath: 'id' } : {})
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      database.close()
      await expectNativeInstallationFailure(
        createStorageHost({
          plugins: [indexedDbBackendPlugin({ factory, keyRange: IDBKeyRange, dbName })]
        }),
        { source: STORAGE_WEB_SOURCE, code: 'INVALID_CONFIG', operation: 'indexeddb.schema' }
      )
      expect(await factory.databases()).toContainEqual({ name: dbName, version: 1 })
    }
  )

  it('serializes overlapping native record updates without losing a write', async () => {
    const store = await freshDb()
    await store.putRecord({ value: 0 }, 'counter')
    /** Both original callbacks read and write under their own overlapping native transactions. */
    const update = () =>
      store.transaction(async (scope) => {
        const previous = (await scope.getRecord('counter')) as { value: number }
        await scope.putRecord({ value: previous.value + 1 }, 'counter')
      })
    await Promise.all([update(), update()])
    await expect(store.getRecord('counter')).resolves.toEqual({ value: 2 })
    await store.dispose()
  })

  it('exposes every public mutation route through the installed backend', async () => {
    const store = await freshDb()
    const requiredRoutes = [
      'putRecord',
      'deleteRecord',
      'clearRecords',
      'clearAll',
      'transaction',
      'putIndexedRecord',
      'transactionIndexed'
    ] as const
    for (const route of requiredRoutes) expect(typeof store[route]).toBe('function')
    expect(store.capabilities.secondaryIndexes).toBe(true)
    await store.dispose()
  })

  it('registers the original private backfill provider without publishing session methods', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    expect(backfill).toBeDefined()
    expect('openBackfillSession' in store).toBe(false)
    await store.dispose()
  })

  it('opens a leased backfill session and returns immutable record snapshots', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    await store.putRecord({ value: 1 }, 'record-1')
    const handle = await store.ensureRecordIndexes('users', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const session = await backfill
    expect(session).toBeDefined()
    const batch = await session!.openBackfillSession(handle, { ...backfillOptions, batchSize: 2 })
    const result = await batch.readBatch()
    expect(result.endOfScan).toBe(true)
    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]!
    await expect(
      batch.commitBatch({
        generation: handle.generation,
        ownerToken: batch.ownerToken,
        checkpoint: undefined,
        nextCheckpoint: candidate.key,
        endOfScan: true,
        projections: []
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    const commit = {
      generation: handle.generation,
      ownerToken: batch.ownerToken,
      checkpoint: undefined,
      nextCheckpoint: candidate.key,
      endOfScan: true,
      projections: [
        {
          key: candidate.key,
          expectedRevision: candidate.revision,
          outcome: 'indexed',
          projection: { value: { kind: 'single', key: 'value' } }
        }
      ]
    } as const
    await expect(batch.commitBatch(commit)).resolves.toMatchObject({
      status: 'complete',
      scanned: 1,
      indexed: 1
    })
    await expect(batch.commitBatch(commit)).rejects.toMatchObject({
      code: 'INDEX_BACKFILL_STALE'
    })
    batch.release()
    await expect(batch.readBatch()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await store.dispose()
  })

  it('resumes from canonical phase into bounded legacy phase', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    await store.putRecord({ value: 1 }, entityRecordKey(store, 'phased', 'canonical'))
    await store.putRecord({ value: 2 }, ['phased', 'legacy'])
    const handle = await store.ensureRecordIndexes('phased', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const options = {
      range: canonicalFixtureRange('phased'),
      legacyRange: legacyFixtureRange('phased'),
      includeLegacy: true,
      allowComplete: true,
      batchSize: 1
    } as const
    const canonical = await capability.openBackfillSession(handle, options)
    const canonicalBatch = await canonical.readBatch()
    expect(canonicalBatch.phase).toBe(RecordIndexBackfillPhase.canonical)
    expect(canonicalBatch.candidates).toHaveLength(1)
    await canonical.commitBatch({
      phase: canonicalBatch.phase,
      generation: handle.generation,
      ownerToken: canonical.ownerToken,
      checkpoint: canonicalBatch.checkpoint,
      nextCheckpoint: canonicalBatch.candidates[0]!.key,
      endOfScan: canonicalBatch.endOfScan,
      projections: [
        {
          key: canonicalBatch.candidates[0]!.key,
          expectedRevision: canonicalBatch.candidates[0]!.revision,
          outcome: 'indexed',
          projection: { value: { kind: 'single', key: 1 } }
        }
      ]
    })
    canonical.release()

    const legacy = await capability.openBackfillSession(handle, options)
    const legacyBatch = await legacy.readBatch()
    expect(legacyBatch.phase).toBe(RecordIndexBackfillPhase.legacy)
    expect(legacyBatch.candidates).toHaveLength(1)
    await expect(
      legacy.commitBatch({
        phase: legacyBatch.phase,
        generation: handle.generation,
        ownerToken: legacy.ownerToken,
        checkpoint: legacyBatch.checkpoint,
        nextCheckpoint: legacyBatch.candidates[0]!.key,
        endOfScan: legacyBatch.endOfScan,
        projections: [
          {
            key: legacyBatch.candidates[0]!.key,
            expectedRevision: legacyBatch.candidates[0]!.revision,
            outcome: 'indexed',
            projection: { value: { kind: 'single', key: 2 } }
          }
        ]
      })
    ).resolves.toMatchObject({ status: 'complete', scanned: 2, indexed: 2 })
    legacy.release()
    await store.dispose()
  })

  it('rejects foreign owners and refuses forged completion checkpoints', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    await store.putRecord({ value: 1 }, 'record-1')
    const handle = await store.ensureRecordIndexes('users', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = await backfill
    const session = await capability!.openBackfillSession(handle, {
      ...backfillOptions,
      batchSize: 2
    })
    const result = await session.readBatch()
    const candidate = result.candidates[0]!
    const projection = {
      key: candidate.key,
      expectedRevision: candidate.revision,
      outcome: 'indexed' as const,
      projection: { value: { kind: 'single' as const, key: 'value' } }
    }
    await expect(
      session.commitBatch({
        generation: handle.generation,
        ownerToken: 'foreign-owner',
        checkpoint: undefined,
        nextCheckpoint: candidate.key,
        endOfScan: true,
        projections: [projection]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      session.commitBatch({
        generation: handle.generation,
        ownerToken: session.ownerToken,
        checkpoint: undefined,
        nextCheckpoint: 'zzzz-forged-checkpoint',
        endOfScan: true,
        projections: [projection]
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await store.dispose()
  })

  it('validates lease options and completes an issued empty batch', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const handle = await store.ensureRecordIndexes('empty', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    await expect(
      capability.openBackfillSession(handle, { ...backfillOptions, batchSize: 0 })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      capability.openBackfillSession(handle, { ...backfillOptions, batchSize: 513 })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      capability.openBackfillSession(handle, { ...backfillOptions, leaseMs: 0 })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      capability.openBackfillSession(handle, { ...backfillOptions, leaseMs: 4_999 })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(
      capability.openBackfillSession(handle, { ...backfillOptions, leaseMs: 120_001 })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    const session = await capability.openBackfillSession(handle, {
      ...backfillOptions,
      batchSize: 512,
      leaseMs: 120_000
    })
    await expect(capability.openBackfillSession(handle, backfillOptions)).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE'
    })
    await expect(
      capability.openBackfillSession({ ...handle, generation: 'stale-generation' }, backfillOptions)
    ).rejects.toMatchObject({ code: 'INDEX_BACKFILL_STALE' })
    const issued = await session.readBatch()
    expect(issued).toMatchObject({ endOfScan: true, candidates: [] })
    await expect(
      session.commitBatch({
        generation: handle.generation,
        ownerToken: session.ownerToken,
        checkpoint: undefined,
        nextCheckpoint: undefined,
        endOfScan: true,
        projections: []
      })
    ).resolves.toMatchObject({ status: 'complete', scanned: 0, indexed: 0 })
    await store.dispose()
  })

  it('preserves one exact nonterminal retry and rejects successor or altered replays', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    await store.putRecord({ value: 1 }, 'record-1')
    await store.putRecord({ value: 2 }, 'record-2')
    const handle = await store.ensureRecordIndexes('retry', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const owner = await capability.openBackfillSession(handle, {
      ...backfillOptions,
      batchSize: 1
    })
    const issued = await owner.readBatch()
    const candidate = issued.candidates[0]!
    const commit = {
      generation: handle.generation,
      ownerToken: owner.ownerToken,
      checkpoint: issued.checkpoint,
      nextCheckpoint: candidate.key,
      endOfScan: issued.endOfScan,
      projections: [
        {
          key: candidate.key,
          expectedRevision: candidate.revision,
          outcome: 'skipped' as const
        }
      ]
    }
    const firstReadiness = await owner.commitBatch(commit)
    expect(firstReadiness.status).toBe('running')
    await expect(owner.commitBatch(commit)).resolves.toEqual(firstReadiness)
    await expect(owner.commitBatch({ ...commit, endOfScan: true })).rejects.toMatchObject({
      code: 'INDEX_BACKFILL_STALE'
    })

    const successor = await capability.openBackfillSession(handle, {
      ...backfillOptions,
      batchSize: 1
    })
    await expect(owner.commitBatch(commit)).rejects.toMatchObject({
      code: 'INDEX_BACKFILL_STALE'
    })
    successor.release()
    owner.release()
    await store.dispose()
  })

  it('classifies terminal reopen as stale rather than fallback contention', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const handle = await store.ensureRecordIndexes('terminal-reopen', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, backfillOptions)
    const batch = await session.readBatch()
    await session.commitBatch({
      generation: handle.generation,
      ownerToken: session.ownerToken,
      checkpoint: batch.checkpoint,
      nextCheckpoint: undefined,
      endOfScan: true,
      projections: []
    })
    try {
      await capability.openBackfillSession(handle, backfillOptions)
      throw new Error('terminal reopen unexpectedly succeeded')
    } catch (cause) {
      expect(cause).toMatchObject({ code: 'INDEX_BACKFILL_STALE' })
    }
    session.release()
    await store.dispose()
  })

  it('keeps takeover observations local to one IndexedDB context', async () => {
    const factory = new IDBFactory()
    const dbName = `restart-lease-${Math.random().toString(36).slice(2)}`
    const { store: ownerStore, capability: ownerCapability } = await createBackfillDb({
      factory,
      keyRange: IDBKeyRange,
      dbName
    })
    const { store: contenderStore, capability: contenderCapability } = await createBackfillDb({
      factory,
      keyRange: IDBKeyRange,
      dbName
    })
    const { store: restartedStore, capability: restartedCapability } = await createBackfillDb({
      factory,
      keyRange: IDBKeyRange,
      dbName
    })
    const definitions = [{ name: 'value', unique: false, multiEntry: false, revision: 1 }] as const
    await ownerStore.putRecord({ value: 1 }, entityRecordKey(ownerStore, 'restart-lease', 'id-0'))
    const handle = await ownerCapability.ensureRecordIndexes('restart-lease', definitions)
    const owner = await ownerCapability.openBackfillSession(handle, {
      range: canonicalFixtureRange('restart-lease'),
      allowComplete: true,
      leaseMs: 5_000
    })
    const ownerBatch = await owner.readBatch()
    const clock = vi.spyOn(performance, 'now')
    clock.mockReturnValue(1_000)
    await expect(
      contenderCapability.openBackfillSession(handle, {
        range: canonicalFixtureRange('restart-lease'),
        allowComplete: true,
        leaseMs: 5_000
      })
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
    clock.mockReturnValue(1_001)
    await expect(
      restartedCapability.openBackfillSession(handle, {
        range: canonicalFixtureRange('restart-lease'),
        allowComplete: true,
        leaseMs: 5_000
      })
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
    clock.mockReturnValue(3_000)
    await owner.renew()
    clock.mockReturnValue(6_001)
    await expect(
      contenderCapability.openBackfillSession(handle, {
        range: canonicalFixtureRange('restart-lease'),
        allowComplete: true,
        leaseMs: 5_000
      })
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
    clock.mockReturnValue(11_002)
    const takeover = await contenderCapability.openBackfillSession(handle, {
      range: canonicalFixtureRange('restart-lease'),
      allowComplete: true,
      leaseMs: 5_000
    })
    await expect(owner.renew()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
    await expect(
      owner.commitBatch({
        generation: handle.generation,
        ownerToken: owner.ownerToken,
        checkpoint: ownerBatch.checkpoint,
        nextCheckpoint: ownerBatch.candidates.at(-1)?.key,
        endOfScan: ownerBatch.endOfScan,
        projections: ownerBatch.candidates.map((candidate) => ({
          key: candidate.key,
          expectedRevision: candidate.revision,
          outcome: 'skipped' as const
        }))
      })
    ).rejects.toMatchObject({ code: 'INDEX_BACKFILL_STALE' })
    takeover.release()
    owner.release()
    clock.mockRestore()
    await ownerStore.dispose()
    await contenderStore.dispose()
    await restartedStore.dispose()
  })

  it('自动生成 key 即使随机源重复也不会覆盖已有 record', async () => {
    const random = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-000000000000')
    try {
      const store = await freshDb()
      const first = await store.putRecord({ value: 1 })
      const second = await store.putRecord({ value: 2 })
      expect(second).not.toEqual(first)
      await expect(store.getRecord(first)).resolves.toEqual({ value: 1 })
      await expect(store.getRecord(second)).resolves.toEqual({ value: 2 })
      await store.dispose()
    } finally {
      random.mockRestore()
    }
  })

  it('keeps hostile scopes out of private generation tokens', async () => {
    const factory = freshFactory()
    const dbName = 'indexed-generation-hostile-scope'
    const { store, capability: backfill } = await createBackfillDb({
      factory,
      keyRange: IDBKeyRange,
      dbName
    })
    const capability = backfill
    const scopes = ['scope\u0000with-nul', `scope-${String.fromCodePoint(0x10ffff)}`]
    const definitions = [{ name: 'value', unique: false, multiEntry: false, revision: 1 }] as const

    await store.putRecord({ value: 'indexed' }, 'hostile-scope-record')
    for (const scope of scopes) {
      const handle = await store.ensureRecordIndexes(scope, definitions)
      expect(handle.generation).toMatch(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/)
      expect(handle.generation.length).toBeLessThanOrEqual(128)
      expect(handle.generation).not.toContain(scope)
      const session = await capability.openBackfillSession(handle, {
        ...backfillOptions,
        batchSize: 1
      })
      const batch = await session.readBatch()
      const candidate = batch.candidates[0]!
      await session.commitBatch({
        generation: handle.generation,
        ownerToken: session.ownerToken,
        checkpoint: batch.checkpoint,
        nextCheckpoint: candidate.key,
        endOfScan: batch.endOfScan,
        projections: [
          {
            key: candidate.key,
            expectedRevision: candidate.revision,
            outcome: 'indexed',
            projection: { value: { kind: 'single', key: 'indexed' } }
          }
        ]
      })
      session.release()
      const entries = []
      for await (const entry of store.iterateRecordIndex({ handle, index: 'value' }))
        entries.push(entry)
      expect(entries).toEqual([['hostile-scope-record', { value: 'indexed' }]])
    }
    await store.dispose()
  })

  it('rotates malformed persisted generations once and rejects old handles', async () => {
    const factory = freshFactory()
    const dbName = 'indexed-generation-recovery'
    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const definitions = [{ name: 'value', unique: false, multiEntry: false, revision: 1 }] as const
    const scope = 'recovery-scope'
    const handle = await store.ensureRecordIndexes(scope, definitions)
    await store.dispose()

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const malformedHandle = { ...handle, generation: `${scope}:persisted\u0000generation` }
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('storage-web:meta', 'readwrite')
      transaction.objectStore('storage-web:meta').put(
        {
          handle: malformedHandle,
          currentGeneration: malformedHandle.generation,
          readiness: { status: 'complete', scanned: 0, indexed: 0 }
        },
        ['__storage_web_internal__', 'index', scope]
      )
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    const firstConnection = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName
    })
    const secondConnection = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName
    })
    const [recovered, adopted] = await Promise.all([
      firstConnection.ensureRecordIndexes(scope, definitions),
      secondConnection.ensureRecordIndexes(scope, definitions)
    ])
    expect(adopted).toEqual(recovered)
    expect(recovered.generation).not.toBe(malformedHandle.generation)
    expect(recovered.generation).toMatch(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/)
    await expect(firstConnection.ensureRecordIndexes(scope, definitions)).resolves.toEqual(
      recovered
    )
    await expect(secondConnection.ensureRecordIndexes(scope, definitions)).resolves.toEqual(
      recovered
    )
    await expect(firstConnection.getRecordIndexReadiness(malformedHandle)).rejects.toMatchObject({
      code: 'INDEX_BACKFILL_STALE'
    })
    await expect(
      firstConnection.putIndexedRecord({ value: 'old' }, 'old-handle-record', malformedHandle, {
        value: { kind: 'single', key: 'old' }
      })
    ).rejects.toMatchObject({ code: 'INDEX_BACKFILL_STALE' })
    await expect(
      firstConnection.iterateRecordIndex({ handle: malformedHandle, index: 'value' }).next()
    ).rejects.toMatchObject({ code: 'INDEX_BACKFILL_STALE' })
    await firstConnection.dispose()
    await secondConnection.dispose()

    const inspected = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const metadataKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const transaction = inspected.transaction('storage-web:meta', 'readonly')
      const request = transaction.objectStore('storage-web:meta').getAllKeys()
      request.onsuccess = () => resolve(request.result as IDBValidKey[])
      request.onerror = () => reject(request.error)
    })
    expect(
      metadataKeys.filter(
        (key) =>
          Array.isArray(key) && key[0] === '__storage_web_internal__' && key[1] === 'index-stale'
      )
    ).toHaveLength(1)
    inspected.close()
  })

  it('安装时拒绝 null、数组和 primitive options', async () => {
    for (const options of [null, [], 'options', 1])
      await expectNativeInstallationFailure(createIndexedDbTestStore(options as never), {
        code: 'INVALID_CONFIG'
      })
  })

  it('安装时拒绝非 boolean cleanupLegacyRecords', async () => {
    for (const cleanupLegacyRecords of [null, 'yes', 1, []])
      await expectNativeInstallationFailure(
        createIndexedDbTestStore({
          factory: freshFactory(),
          keyRange: IDBKeyRange,
          cleanupLegacyRecords: cleanupLegacyRecords as never
        }),
        { code: 'INVALID_CONFIG' }
      )
  })

  it('拒绝运行时非字符串 value', async () => {
    const store = await freshDb()
    await expect(store.set('key', 42 as unknown as string)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    await store.dispose()
  })
  it('L0、bytes 与 metadata 通道拒绝运行时非字符串 key', async () => {
    const store = await freshDb()
    const invalidKey = 42 as unknown as string
    for (const invoke of [
      () => store.get(invalidKey),
      () => store.set(invalidKey, 'value'),
      () => store.remove(invalidKey),
      () => store.use(kv).has(invalidKey),
      () => store.getBytes(invalidKey),
      () => store.removeBytes(invalidKey),
      () => store.setBytes(invalidKey, new Uint8Array([1])),
      () => store.metadata!.get(invalidKey),
      () => store.metadata!.set(invalidKey, 'value'),
      () => store.metadata!.delete(invalidKey)
    ])
      await expect(invoke()).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        backend: 'indexed-db'
      })
    await store.dispose()
  })

  it('结构化 key 在异步边界前快照，调用方后续修改不改变目标记录', async () => {
    const store = await freshDb()
    const key: IStorageKey = ['tenant', 1]
    const pendingPut = store.putRecord({ value: 'original' }, key)
    ;(key as IStorageKey[])[1] = 2
    await pendingPut
    await expect(store.getRecord(['tenant', 1])).resolves.toEqual({ value: 'original' })
    await expect(store.getRecord(['tenant', 2])).resolves.toBeUndefined()

    const transactionKey: IStorageKey = ['transaction', 1]
    await store.transaction(async (tx) => {
      const pending = tx.putRecord({ value: 'transaction' }, transactionKey)
      ;(transactionKey as IStorageKey[])[1] = 2
      await pending
    })
    await expect(store.getRecord(['transaction', 1])).resolves.toEqual({
      value: 'transaction'
    })
    await expect(store.getRecord(['transaction', 2])).resolves.toBeUndefined()

    await store.dispose()
  })

  it('可变写入值在异步边界前快照', async () => {
    const store = await freshDb()
    const record = { nested: { value: 1 } }
    const pendingRecord = store.putRecord(record, 'record-snapshot')
    record.nested.value = 2
    await pendingRecord
    await expect(store.getRecord('record-snapshot')).resolves.toEqual({ nested: { value: 1 } })

    const bytes = new Uint8Array([1, 2])
    const pendingBytes = store.setBytes('bytes-snapshot', bytes)
    bytes[0] = 9
    await pendingBytes
    await expect(store.getBytes('bytes-snapshot')).resolves.toEqual(new Uint8Array([1, 2]))

    const transactionValue = { nested: { value: 1 } }
    await store.transaction(async (tx) => {
      const pending = tx.putRecord(transactionValue, 'transaction-value-snapshot')
      transactionValue.nested.value = 2
      await pending
    })
    await expect(store.getRecord('transaction-value-snapshot')).resolves.toEqual({
      nested: { value: 1 }
    })
    await store.dispose()
  })

  it('值为 undefined 的 record 仍参与跨通道冲突检测', async () => {
    const store = await freshDb()
    await store.putRecord(undefined, 'undefined-record')
    await expect(store.set('undefined-record', 'text')).rejects.toMatchObject({
      code: 'DUPLICATE_KEY',
      existingChannel: 'record',
      attemptedChannel: 'value'
    })
    await store.set('undefined-record', 'text', { conflictPolicy: 'replace' })
    await expect(store.get('undefined-record')).resolves.toBe('text')
    const entries = []
    for await (const entry of store.iterateRecords()) entries.push(entry)
    expect(entries).toEqual([])
    await store.dispose()
  })

  it('clearRecords 在 epoch 请求期间 abort 时不提交 destructive clear', async () => {
    const store = await freshDb()
    await store.putRecord({ keep: true }, 'keep')
    const controller = new AbortController()
    const pending = store.clearRecords({ signal: controller.signal })
    controller.abort('cancel clear')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(store.getRecord('keep')).resolves.toEqual({ keep: true })
    await store.dispose()
  })

  it('clearAll 在 epoch 请求期间 abort 时不提交 destructive clear', async () => {
    const store = await freshDb()
    await store.set('keep', 'value')
    await store.putRecord({ keep: true }, 'record')
    const controller = new AbortController()
    const pending = store.clearAll({ signal: controller.signal })
    controller.abort('cancel clear all')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(store.get('keep')).resolves.toBe('value')
    await expect(store.getRecord('record')).resolves.toEqual({ keep: true })
    await store.dispose()
  })

  it.each(['clearRecords', 'clearAll'] as const)(
    '%s atomically wipes the sidecar and every scope index handle, so an old complete handle becomes stale',
    async (operation) => {
      const { store, capability: backfill } = await createBackfillDb()
      const indexed = store as unknown as {
        ensureRecordIndexes: (
          scope: string,
          definitions: readonly unknown[]
        ) => Promise<{ scope: string; generation: string; fingerprint: string }>
        iterateRecordIndex: (
          query: unknown
        ) => AsyncIterableIterator<[IStorageKey, { value: number }]>
      }
      await store.putRecord({ value: 1 }, 'record-1')
      await store.putRecord({ value: 2 }, 'record-2')
      const handle = await indexed.ensureRecordIndexes('users', [
        { name: 'value', unique: false, multiEntry: false, revision: 1 }
      ])
      const capability = backfill
      const session = await capability.openBackfillSession(handle, backfillOptions)
      const batch = await session.readBatch()
      await session.commitBatch({
        generation: handle.generation,
        ownerToken: session.ownerToken,
        checkpoint: batch.checkpoint,
        nextCheckpoint: batch.candidates[batch.candidates.length - 1]!.key,
        endOfScan: true,
        projections: batch.candidates.map((candidate) => ({
          key: candidate.key,
          expectedRevision: candidate.revision,
          outcome: 'indexed' as const,
          projection: {
            value: { kind: 'single' as const, key: (candidate.raw as { value: number }).value }
          }
        }))
      })
      // Sanity: the handle is genuinely complete and queryable before the raw clear.
      const beforeClear: number[] = []
      for await (const [, value] of indexed.iterateRecordIndex({ handle, index: 'value' }))
        beforeClear.push(value.value)
      expect(beforeClear.sort()).toEqual([1, 2])

      if (operation === 'clearRecords') await store.clearRecords()
      else await store.clearAll()

      // The old complete handle must fail closed rather than silently answering against
      // now-deleted data or a now-orphaned sidecar row.
      await expect(indexed.iterateRecordIndex({ handle, index: 'value' }).next()).rejects.toThrow()

      // Recovery: re-registering the same scope/index definition must be able to build a fresh,
      // working generation — the wipe must not leave the store permanently wedged.
      await store.putRecord({ value: 3 }, 'record-3')
      const freshHandle = await indexed.ensureRecordIndexes('users', [
        { name: 'value', unique: false, multiEntry: false, revision: 1 }
      ])
      const freshSession = await capability.openBackfillSession(freshHandle, backfillOptions)
      const freshBatch = await freshSession.readBatch()
      expect(freshBatch.candidates.map((candidate) => candidate.key).sort()).toEqual(['record-3'])
      await freshSession.commitBatch({
        generation: freshHandle.generation,
        ownerToken: freshSession.ownerToken,
        checkpoint: freshBatch.checkpoint,
        nextCheckpoint: freshBatch.candidates[freshBatch.candidates.length - 1]!.key,
        endOfScan: true,
        projections: freshBatch.candidates.map((candidate) => ({
          key: candidate.key,
          expectedRevision: candidate.revision,
          outcome: 'indexed' as const,
          projection: {
            value: { kind: 'single' as const, key: (candidate.raw as { value: number }).value }
          }
        }))
      })
      const afterRecovery: number[] = []
      for await (const [, value] of indexed.iterateRecordIndex({
        handle: freshHandle,
        index: 'value'
      }))
        afterRecovery.push(value.value)
      expect(afterRecovery).toEqual([3])
      await store.dispose()
    }
  )

  type IIndexedTestStore = {
    ensureRecordIndexes: (
      scope: string,
      definitions: readonly unknown[]
    ) => Promise<{ scope: string; generation: string; fingerprint: string }>
    iterateRecordIndex: (query: unknown) => AsyncIterableIterator<[IStorageKey, { value: number }]>
  }

  it('rejects nested undefined in the raw backfill budget before sidecar writes', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const scope = 'raw-nested-undefined'
    await store.putRecord({ payload: { nested: undefined } }, entityRecordKey(store, scope, 'id-0'))
    const indexed = store as unknown as IIndexedTestStore
    const handle = await indexed.ensureRecordIndexes(scope, [
      { name: 'payload', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, {
      range: canonicalFixtureRange(scope),
      allowComplete: true,
      batchSize: 1
    })
    await expect(session.readBatch()).rejects.toMatchObject({
      code: 'VALUE_TOO_LARGE',
      cause: expect.any(RangeError)
    })
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'running',
      scanned: 0,
      indexed: 0
    })
    session.release()
    await store.dispose()
  })

  /**
   * Registers scope's `value` index and drives it to `complete` over seed records written at the
   * scope's own canonical entity key shape (`composeRepositoryKey`) — the physical format entity
   * repository records actually use. Seeding through plain/foreign-shaped keys would itself be an
   * "unclassifiable" raw write and would conservatively downgrade every already-registered scope
   * while building the next one.
   */
  const buildCompleteIndex = async (
    store: Awaited<ReturnType<typeof freshDb>>,
    capability: IRecordIndexBackfillStore<unknown>,
    scope: string,
    records: ReadonlyArray<readonly [string, number]>
  ) => {
    for (const [id, value] of records)
      await store.putRecord({ value }, entityRecordKey(store, scope, id))
    const indexed = store as unknown as IIndexedTestStore
    const handle = await indexed.ensureRecordIndexes(scope, [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const session = await capability.openBackfillSession(handle, backfillOptions)
    const batch = await session.readBatch()
    await session.commitBatch({
      generation: handle.generation,
      ownerToken: session.ownerToken,
      checkpoint: batch.checkpoint,
      nextCheckpoint: batch.candidates.at(-1)?.key ?? batch.checkpoint,
      endOfScan: true,
      projections: batch.candidates.map((candidate) => ({
        key: candidate.key,
        expectedRevision: candidate.revision,
        outcome: 'indexed' as const,
        projection: {
          value: { kind: 'single' as const, key: (candidate.raw as { value: number }).value }
        }
      }))
    })
    return handle
  }

  const isIndexQueryable = async (
    store: Awaited<ReturnType<typeof freshDb>>,
    handle: { scope: string; generation: string; fingerprint: string }
  ): Promise<boolean> => {
    const indexed = store as unknown as IIndexedTestStore
    try {
      await indexed.iterateRecordIndex({ handle, index: 'value' }).next()
      return true
    } catch {
      return false
    }
  }

  it('resumes from a durable checkpoint on the next immediate query', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const indexed = store as unknown as IIndexedTestStore
    await store.putRecord({ value: 1 }, entityRecordKey(store, 'resume', 'id-0'))
    await store.putRecord({ value: 2 }, entityRecordKey(store, 'resume', 'id-1'))
    const handle = await indexed.ensureRecordIndexes('resume', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const options = {
      range: canonicalFixtureRange('resume'),
      allowComplete: true,
      batchSize: 1
    }
    const firstSession = await capability.openBackfillSession(handle, {
      ...options,
      leaseMs: 5_000
    })
    const firstBatch = await firstSession.readBatch()
    expect(firstBatch.candidates).toHaveLength(1)
    expect(firstBatch.endOfScan).toBe(false)
    await firstSession.commitBatch({
      generation: handle.generation,
      ownerToken: firstSession.ownerToken,
      checkpoint: firstBatch.checkpoint,
      nextCheckpoint: firstBatch.candidates[0]!.key,
      endOfScan: false,
      projections: firstBatch.candidates.map((candidate) => ({
        key: candidate.key,
        expectedRevision: candidate.revision,
        outcome: 'skipped' as const
      }))
    })
    firstSession.release()
    const secondSession = await capability.openBackfillSession(handle, {
      ...options,
      leaseMs: 5_000
    })
    const secondBatch = await secondSession.readBatch()
    expect(secondBatch.candidates).toHaveLength(1)
    expect(secondBatch.candidates[0]!.key).not.toEqual(firstBatch.candidates[0]!.key)
    await expect(
      secondSession.commitBatch({
        generation: handle.generation,
        ownerToken: secondSession.ownerToken,
        checkpoint: secondBatch.checkpoint,
        nextCheckpoint: secondBatch.candidates[0]!.key,
        endOfScan: true,
        projections: secondBatch.candidates.map((candidate) => ({
          key: candidate.key,
          expectedRevision: candidate.revision,
          outcome: 'skipped' as const
        }))
      })
    ).resolves.toMatchObject({ status: 'complete', scanned: 2 })
    await store.dispose()
  })

  it('enforces the decoded backfill page cap and rejects late release writes', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const indexed = store as unknown as IIndexedTestStore
    await store.putRecord(
      { value: 'x'.repeat(1024 * 1024 + 32) },
      entityRecordKey(store, 'cap', 'id-0')
    )
    await store.putRecord({ value: 'small' }, entityRecordKey(store, 'cap', 'id-1'))
    const handle = await indexed.ensureRecordIndexes('cap', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, {
      range: canonicalFixtureRange('cap'),
      allowComplete: true,
      batchSize: 2,
      leaseMs: 5_000
    })
    await expect(session.readBatch()).rejects.toMatchObject({
      code: 'VALUE_TOO_LARGE',
      cause: expect.any(RangeError)
    })
    session.release()
    await store.dispose()
  })

  it('rejects two-item aggregate decoded overflow before issuing a partial page', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const scope = 'decoded-aggregate-cap'
    await store.putRecord({ value: 1 }, entityRecordKey(store, scope, 'id-0'))
    await store.putRecord({ value: 2 }, entityRecordKey(store, scope, 'id-1'))
    const indexed = store as unknown as IIndexedTestStore
    const handle = await indexed.ensureRecordIndexes(scope, [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, {
      range: canonicalFixtureRange(scope),
      allowComplete: true,
      batchSize: 2
    })
    await expect(
      session.readBatch(undefined, {
        prepare: async () => ({ decodedBytes: 600_000, outcome: 'skipped' as const })
      })
    ).rejects.toMatchObject({
      code: 'VALUE_TOO_LARGE',
      cause: expect.any(RangeError)
    })
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'running',
      scanned: 0,
      indexed: 0
    })
    session.release()
    await store.dispose()
  })

  it('accounts the exact persisted tuple and accepts its byte boundary', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const scope = 's'.repeat(120)
    const indexName = 'i'.repeat(120)
    const indexed = store as unknown as IIndexedTestStore
    await store.putRecord({ value: 1 }, entityRecordKey(store, scope, 'id-0'))
    const handle = await indexed.ensureRecordIndexes(scope, [
      { name: indexName, unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, {
      range: canonicalFixtureRange(scope),
      allowComplete: true,
      batchSize: 1
    })
    const recordKey = entityRecordKey(store, scope, 'id-0')
    const tupleBytes = (indexValue: string): number =>
      encoder.encode(
        encodeFlatStorageKey([scope, indexName, handle.generation, indexValue, recordKey])
      ).byteLength
    let low = 0
    let high = 2 * 1024 * 1024
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (tupleBytes('x'.repeat(middle)) < 2 * 1024 * 1024) low = middle + 1
      else high = middle
    }
    const exactIndexValue = 'x'.repeat(low)
    expect(tupleBytes(exactIndexValue)).toBe(2 * 1024 * 1024)
    const batch = await session.readBatch(undefined, {
      prepare: async () => ({
        decodedBytes: 1,
        outcome: 'indexed' as const,
        projection: { [indexName]: { kind: 'single' as const, key: exactIndexValue } }
      })
    })
    expect(batch.candidates).toHaveLength(1)
    await expect(
      session.commitBatch({
        phase: batch.phase,
        generation: handle.generation,
        ownerToken: session.ownerToken,
        checkpoint: batch.checkpoint,
        nextCheckpoint: batch.candidates[0]!.key,
        endOfScan: batch.endOfScan,
        projections: [
          {
            key: recordKey,
            expectedRevision: batch.candidates[0]!.revision,
            outcome: 'indexed',
            projection: batch.preparations![0]!.projection
          }
        ]
      })
    ).resolves.toMatchObject({ status: 'complete', indexed: 1 })
    session.release()
    await store.dispose()
  })

  it('rejects a preparation that settles after session release', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    await store.putRecord({ value: 'pending' }, entityRecordKey(store, 'late-release', 'id-0'))
    const handle = await store.ensureRecordIndexes('late-release', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const session = backfill.openBackfillSession(handle, {
      range: canonicalFixtureRange('late-release'),
      allowComplete: true,
      leaseMs: 5_000
    })
    const active = await session
    let signalPreparationStarted!: () => void
    let settlePreparation!: () => void
    const preparationStarted = new Promise<void>((resolve) => {
      signalPreparationStarted = resolve
    })
    const preparation = new Promise<{ decodedBytes: number; outcome: 'skipped' }>((resolve) => {
      settlePreparation = () => resolve({ decodedBytes: 0, outcome: 'skipped' })
    })
    const pending = active.readBatch(undefined, {
      prepare: async () => {
        signalPreparationStarted()
        return preparation
      }
    })
    await preparationStarted
    active.release()
    settlePreparation()
    await expect(pending).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await store.dispose()
  })

  it('reports abort and expired lease-renew failures without metadata completion', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const indexed = store as unknown as IIndexedTestStore
    await store.putRecord({ value: 1 }, entityRecordKey(store, 'failure', 'id-0'))
    const handle = await indexed.ensureRecordIndexes('failure', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, {
      range: canonicalFixtureRange('failure'),
      allowComplete: true,
      leaseMs: 5_000
    })
    const controller = new AbortController()
    controller.abort('cancel backfill read')
    await expect(session.readBatch({ signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED'
    })
    const clock = vi.spyOn(performance, 'now')
    clock.mockReturnValue(1_000)
    await expect(
      capability.openBackfillSession(handle, {
        range: canonicalFixtureRange('failure'),
        allowComplete: true,
        leaseMs: 5_000
      })
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
    clock.mockReturnValue(6_001)
    const takeover = await capability.openBackfillSession(handle, {
      range: canonicalFixtureRange('failure'),
      allowComplete: true,
      leaseMs: 5_000
    })
    await expect(session.renew()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
    takeover.release()
    clock.mockRestore()
    await store.dispose()
  })

  it.each(['putRecord', 'deleteRecord'] as const)(
    'raw %s on a canonical entity key downgrades only that scope’s index, not other scopes',
    async (operation) => {
      const { store, capability: backfill } = await createBackfillDb()
      const usersHandle = await buildCompleteIndex(store, backfill, 'users', [
        ['users-a', 1],
        ['users-b', 2]
      ])
      const postsHandle = await buildCompleteIndex(store, backfill, 'posts', [
        ['posts-a', 10],
        ['posts-b', 20]
      ])
      await expect(isIndexQueryable(store, usersHandle)).resolves.toBe(true)
      await expect(isIndexQueryable(store, postsHandle)).resolves.toBe(true)

      const canonicalKey = entityRecordKey(store, 'users', 'raw-bypass-id')
      if (operation === 'putRecord') await store.putRecord({ value: 999 }, canonicalKey)
      else {
        await store.putRecord({ value: 999 }, canonicalKey)
        await store.deleteRecord(canonicalKey)
      }

      // The scope the raw key structurally belongs to must fail closed ("为该 scope 创建新
      // pending generation"); an unrelated scope must be left alone (the rule does not license a
      // conservative full-store rotation when the mutation is classifiable).
      await expect(isIndexQueryable(store, usersHandle)).resolves.toBe(false)
      await expect(isIndexQueryable(store, postsHandle)).resolves.toBe(true)
      const freshUsersHandle = await (store as unknown as IIndexedTestStore).ensureRecordIndexes(
        'users',
        [{ name: 'value', unique: false, multiEntry: false, revision: 1 }]
      )
      expect(freshUsersHandle.generation).not.toBe(usersHandle.generation)
      await expect(store.getRecordIndexReadiness(freshUsersHandle)).resolves.toMatchObject({
        status: 'pending',
        scanned: 0,
        indexed: 0
      })
      await store.dispose()
    }
  )

  it.each(['putRecord', 'deleteRecord'] as const)(
    'raw %s on a legacy-shaped key conservatively invalidates every scope',
    async (operation) => {
      const { store, capability: backfill } = await createBackfillDb()
      const usersHandle = await buildCompleteIndex(store, backfill, 'users', [
        ['users-a', 1],
        ['users-b', 2]
      ])
      await expect(isIndexQueryable(store, usersHandle)).resolves.toBe(true)

      const legacyKey = ['legacy-users', 'legacy-id'] as const
      if (operation === 'putRecord') await store.putRecord({ value: 999 }, legacyKey)
      else {
        await store.putRecord({ value: 999 }, legacyKey)
        await store.deleteRecord(legacyKey)
      }

      await expect(isIndexQueryable(store, usersHandle)).resolves.toBe(false)
      await store.dispose()
    }
  )

  it.each([
    ['string', 'raw-string'] as const,
    ['number', 42] as const,
    ['date', new Date('2024-01-01T00:00:00.000Z')] as const,
    ['binary', new Uint8Array([1, 2, 3]).buffer] as const,
    ['compound', ['legacy-scope', 'legacy-id'] as const]
  ])('/061 rotates all non-canonical raw key domains (%s)', async (_label, rawKey) => {
    const { store, capability: backfill } = await createBackfillDb()
    const indexed = store as unknown as IIndexedTestStore
    const oldHandle = await buildCompleteIndex(store, backfill, 'raw-domain', [['seed', 1]])

    await store.putRecord({ value: 2 }, rawKey as IStorageKey)

    const freshHandle = await indexed.ensureRecordIndexes('raw-domain', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    expect(freshHandle.generation).not.toBe(oldHandle.generation)
    await expect(store.getRecordIndexReadiness(freshHandle)).resolves.toMatchObject({
      status: 'pending'
    })
    await expect(store.getRecordIndexReadiness(oldHandle)).rejects.toMatchObject({
      code: 'INDEX_BACKFILL_STALE'
    })
    await expect(
      indexed.iterateRecordIndex({ handle: oldHandle, index: 'value' }).next()
    ).rejects.toMatchObject({
      code: 'INDEX_BACKFILL_STALE'
    })
    await store.dispose()
  })

  it('aborts a raw mutation transaction without rotating the complete generation', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const oldHandle = await buildCompleteIndex(store, backfill, 'rollback', [['seed', 1]])
    const failure = new Error('transaction rollback')
    await expect(
      store.transaction(async (transaction) => {
        await transaction.putRecord({ value: 2 }, entityRecordKey(store, 'rollback', 'uncommitted'))
        throw failure
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    await expect(isIndexQueryable(store, oldHandle)).resolves.toBe(true)
    await store.dispose()
  })

  it('a raw canonical write to an already-scanned key mid-backfill must never let the index report complete', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const indexed = store as unknown as IIndexedTestStore
    await store.putRecord({ value: 1 }, entityRecordKey(store, 'users', 'id-0'))
    await store.putRecord({ value: 2 }, entityRecordKey(store, 'users', 'id-1'))
    await store.putRecord({ value: 3 }, entityRecordKey(store, 'users', 'id-2'))
    const handle = await indexed.ensureRecordIndexes('users', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const scopeRange = { range: canonicalFixtureRange('users'), allowComplete: true }
    const session = await capability.openBackfillSession(handle, scopeRange)
    const batch = await session.readBatch()
    expect(batch.candidates).toHaveLength(3)

    // The raw write lands on an already-scanned canonical key, after `readBatch` already
    // captured id-0's old revision/value — the exact stale-revision scenario.
    await store.putRecord({ value: 999 }, entityRecordKey(store, 'users', 'id-0'))

    await expect(
      session.commitBatch({
        generation: handle.generation,
        ownerToken: session.ownerToken,
        checkpoint: batch.checkpoint,
        nextCheckpoint: batch.candidates.at(-1)!.key,
        endOfScan: true,
        projections: []
      })
    ).rejects.toMatchObject({ code: 'INDEX_BACKFILL_STALE' })
    // Rotation makes the old session terminal instead of allowing it to publish a partial result.
    await expect(isIndexQueryable(store, handle)).resolves.toBe(false)
    await store.dispose()
  })

  it('a raw canonical write landing between two batch commits (on an already-committed key) must also block completion', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const indexed = store as unknown as IIndexedTestStore
    await store.putRecord({ value: 1 }, entityRecordKey(store, 'users', 'id-0'))
    await store.putRecord({ value: 2 }, entityRecordKey(store, 'users', 'id-1'))
    await store.putRecord({ value: 3 }, entityRecordKey(store, 'users', 'id-2'))
    await store.putRecord({ value: 4 }, entityRecordKey(store, 'users', 'id-3'))
    const handle = await indexed.ensureRecordIndexes('users', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, {
      range: canonicalFixtureRange('users'),
      allowComplete: true,
      batchSize: 2
    })

    const firstBatch = await session.readBatch()
    expect(firstBatch.candidates).toHaveLength(2)
    const firstReadiness = await session.commitBatch({
      generation: handle.generation,
      ownerToken: session.ownerToken,
      checkpoint: firstBatch.checkpoint,
      nextCheckpoint: firstBatch.candidates.at(-1)!.key,
      endOfScan: false,
      projections: firstBatch.candidates.map((candidate) => ({
        key: candidate.key,
        expectedRevision: candidate.revision,
        outcome: 'indexed' as const,
        projection: {
          value: { kind: 'single' as const, key: (candidate.raw as { value: number }).value }
        }
      }))
    })
    expect(firstReadiness.status).toBe('running')

    // The raw write lands *between* commits, on `id-0` — a key the *first* batch already
    // committed cleanly. No later batch's `projections` will ever include it again, so a
    // batch-local check cannot see this; only the scope-epoch comparison at final completion can.
    await store.putRecord({ value: 999 }, entityRecordKey(store, 'users', 'id-0'))

    await expect(session.readBatch()).rejects.toMatchObject({ code: 'INDEX_BACKFILL_STALE' })
    await expect(isIndexQueryable(store, handle)).resolves.toBe(false)
    await store.dispose()
  })

  it('after a stale-skipped scan reaches its natural end, a later fresh full re-scan with no further raw writes can still reach complete', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const indexed = store as unknown as IIndexedTestStore
    await store.putRecord({ value: 1 }, entityRecordKey(store, 'recover', 'id-0'))
    await store.putRecord({ value: 2 }, entityRecordKey(store, 'recover', 'id-1'))
    const handle = await indexed.ensureRecordIndexes('recover', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const scopeRange = { range: canonicalFixtureRange('recover'), allowComplete: true }

    // First attempt: a raw write interleaves, so this scan must not reach `complete` (same
    // mechanism as the other stale-revision fixtures above).
    const staleLeaseMs = 5_000
    const firstSession = await capability.openBackfillSession(handle, {
      ...scopeRange,
      leaseMs: staleLeaseMs
    })
    const firstBatch = await firstSession.readBatch()
    expect(firstBatch.candidates).toHaveLength(2)
    await store.putRecord({ value: 999 }, entityRecordKey(store, 'recover', 'id-0'))
    await expect(
      firstSession.commitBatch({
        generation: handle.generation,
        ownerToken: firstSession.ownerToken,
        checkpoint: firstBatch.checkpoint,
        nextCheckpoint: firstBatch.candidates.at(-1)!.key,
        endOfScan: true,
        projections: firstBatch.candidates.map((candidate) => ({
          key: candidate.key,
          expectedRevision: candidate.revision,
          outcome: 'indexed' as const,
          projection: {
            value: { kind: 'single' as const, key: (candidate.raw as { value: number }).value }
          }
        }))
      })
    ).rejects.toMatchObject({ code: 'INDEX_BACKFILL_STALE' })

    // The raw write rotated the generation, so a genuinely new session can start immediately. The
    // new session sees `checkpoint === undefined` and takes a fresh raw-firewall epoch snapshot.
    const freshHandle = await indexed.ensureRecordIndexes('recover', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    expect(freshHandle.generation).not.toBe(handle.generation)
    const secondSession = await capability.openBackfillSession(freshHandle, scopeRange)
    const secondBatch = await secondSession.readBatch()
    expect(secondBatch.candidates).toHaveLength(2)
    // No further raw writes this time — a genuinely clean full re-scan.
    const secondReadiness = await secondSession.commitBatch({
      generation: freshHandle.generation,
      ownerToken: secondSession.ownerToken,
      checkpoint: secondBatch.checkpoint,
      nextCheckpoint: secondBatch.candidates.at(-1)!.key,
      endOfScan: true,
      projections: secondBatch.candidates.map((candidate) => ({
        key: candidate.key,
        expectedRevision: candidate.revision,
        outcome: 'indexed' as const,
        projection: {
          value: { kind: 'single' as const, key: (candidate.raw as { value: number }).value }
        }
      }))
    })
    expect(secondReadiness.status).toBe('complete')
    await expect(isIndexQueryable(store, handle)).resolves.toBe(false)
    await expect(isIndexQueryable(store, freshHandle)).resolves.toBe(true)
    await store.dispose()
  })

  it('deleteRecord 在 revision 请求期间 abort 时不提交 delete', async () => {
    const store = await freshDb()
    await store.putRecord({ keep: true }, 'delete-me')
    const controller = new AbortController()
    const pending = store.deleteRecord('delete-me', { signal: controller.signal })
    await Promise.resolve()
    controller.abort('cancel delete')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(store.getRecord('delete-me')).resolves.toEqual({ keep: true })
    await store.dispose()
  })

  it('putRecord 在 revision 请求期间 abort 时不提交 put', async () => {
    const store = await freshDb()
    await store.putRecord({ warm: true }, 'warm')
    const controller = new AbortController()
    const pending = store.putRecord({ keep: true }, 'put-me', {
      signal: controller.signal
    })
    await Promise.resolve()
    controller.abort('cancel put')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(store.getRecord('put-me')).resolves.toBeUndefined()
    await store.dispose()
  })
  it('拒绝非 Uint8Array 的 bytes value', async () => {
    const store = await freshDb()
    await expect(
      store.setBytes('key', new DataView(new ArrayBuffer(1)) as unknown as Uint8Array)
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await store.dispose()
  })

  it('拒绝结构非法的 factory 与 keyRange 注入', async () => {
    await expectNativeInstallationFailure(createIndexedDbTestStore({ factory: {} as IDBFactory }), {
      code: 'INVALID_CONFIG'
    })
    await expectNativeInstallationFailure(
      createIndexedDbTestStore({ factory: freshFactory(), keyRange: {} as typeof IDBKeyRange }),
      { code: 'INVALID_CONFIG' }
    )
  })

  it('拒绝空/非法数据库名、重复/保留名和空的 channel store 名', async () => {
    await expectNativeInstallationFailure(
      createIndexedDbTestStore({ factory: freshFactory(), keyRange: IDBKeyRange, dbName: '' }),
      { code: 'INVALID_CONFIG' }
    )
    await expectNativeInstallationFailure(
      createIndexedDbTestStore({
        factory: freshFactory(),
        keyRange: IDBKeyRange,
        dbName: null as unknown as string
      }),
      { code: 'INVALID_CONFIG' }
    )
    await expectNativeInstallationFailure(
      createIndexedDbTestStore({
        factory: freshFactory(),
        keyRange: IDBKeyRange,
        kvStoreName: 'same',
        bytesStoreName: 'same'
      }),
      { code: 'INVALID_CONFIG' }
    )
    await expectNativeInstallationFailure(
      createIndexedDbTestStore({
        factory: freshFactory(),
        keyRange: IDBKeyRange,
        recordsStoreName: '__storage_web_revisions__'
      }),
      { code: 'INVALID_CONFIG' }
    )
    await expectNativeInstallationFailure(
      createIndexedDbTestStore({
        factory: freshFactory(),
        keyRange: IDBKeyRange,
        recordsStoreName: ''
      }),
      { code: 'INVALID_CONFIG' }
    )
    await expectNativeInstallationFailure(
      createIndexedDbTestStore({
        factory: freshFactory(),
        keyRange: IDBKeyRange,
        bytesStoreName: null as unknown as string
      }),
      { code: 'INVALID_CONFIG' }
    )
  })

  it('不同 records store 的 transaction revision 不互相污染', async () => {
    const factory = freshFactory()
    const first = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName: 'revision-scope',
      recordsStoreName: 'records-a'
    })
    const second = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName: 'revision-scope',
      recordsStoreName: 'records-b'
    })
    await first.putRecord({ value: 'a' }, 'same')
    await second.putRecord({ value: 'b' }, 'same')
    await expect(first.transaction(async (tx) => tx.getRecord('same'))).resolves.toEqual({
      value: 'a'
    })
    await first.dispose()
    await second.dispose()
  })

  it('record 读写与修订检查共用同一原生 readwrite transaction', async () => {
    const factory = freshFactory()
    const dbName = 'snapshot-epoch-atomic'
    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await store.putRecord({ value: 'before' }, 'key')
    /**
     * Call-through observation distinguishes one native transaction from snapshot plus draft
     * commit.
     */
    const native = vi.spyOn(IDBDatabase.prototype, 'transaction')
    try {
      await store.transaction(async (tx) => {
        expect(await tx.getRecord('key')).toEqual({ value: 'before' })
        await tx.putRecord({ value: 'transaction' }, 'key')
        expect(await tx.getRecord('key')).toEqual({ value: 'transaction' })
      })
      expect(native).toHaveBeenCalledTimes(1)
      expect(native.mock.calls[0]?.[1]).toBe('readwrite')
      expect(native.mock.calls[0]?.[0]).toEqual(
        expect.arrayContaining([
          'records',
          '__storage_web_revisions__',
          'storage-web:index-records',
          'storage-web:meta'
        ])
      )
    } finally {
      native.mockRestore()
    }
    await expect(store.getRecord('key')).resolves.toEqual({ value: 'transaction' })
    await store.dispose()
  })

  it('writeTo 路径在 pre-abort 时不调度写入并稳定返回 ABORTED', async () => {
    const store = await createIndexedDbTestStore({
      factory: freshFactory(),
      keyRange: IDBKeyRange,
      dbName: 'pre-abort-write-to'
    })
    const controller = new AbortController()
    controller.abort('before remove')
    await expect(store.remove('key', { signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED'
    })
    await expect(store.clearValues({ signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED'
    })
    await store.dispose()
  })

  it('读取路径等待 readonly transaction settle 后才返回', async () => {
    const store = await freshDb()
    await store.set('settle', 'ok')
    await expect(store.get('settle')).resolves.toBe('ok')
    await expect(store.getRecord('missing')).resolves.toBeUndefined()
    await store.dispose()
  })

  it('初始化 schema meta checkpoint，并补建旧库缺失的 meta store', async () => {
    const factory = freshFactory()
    const dbName = 'meta-checkpoint'
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('kv')
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await store.get('probe')
    await store.dispose()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(database.objectStoreNames.contains('storage-web:meta')).toBe(true)
    const transaction = database.transaction('storage-web:meta', 'readonly')
    await new Promise<void>((resolve, reject) => {
      const request = transaction.objectStore('storage-web:meta').get('schema')
      request.onsuccess = () => {
        expect(request.result).toMatchObject({ version: 3, keySpace: 'repository-v2' })
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    database.close()
  })

  it('schema v3 creates one fixed sidecar store with lookup and record indexes', async () => {
    const factory = freshFactory()
    const store = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName: 'sidecar-schema-v3'
    })
    await store.get('probe')
    await store.dispose()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('sidecar-schema-v3')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(database.objectStoreNames.contains('storage-web:index-records')).toBe(true)
    const transaction = database.transaction('storage-web:index-records', 'readonly')
    const indexRecords = transaction.objectStore('storage-web:index-records')
    expect(indexRecords.keyPath).toEqual([
      'scope',
      'indexName',
      'generation',
      'indexValue',
      'recordKey'
    ])
    expect(indexRecords.indexNames.contains('lookup')).toBe(true)
    expect(indexRecords.indexNames.contains('record')).toBe(true)
    database.close()
  })

  it('upgrades v2 stores once and preserves authoritative record/bytes values', async () => {
    const factory = freshFactory()
    const dbName = 'sidecar-v2-upgrade'
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName, 2)
      request.onupgradeneeded = () => {
        const database = request.result
        database.createObjectStore('kv')
        database.createObjectStore('bytes')
        database.createObjectStore('records')
        database.createObjectStore('__storage_web_revisions__')
        database.createObjectStore('storage-web:meta')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = legacy.transaction(['bytes', 'records'], 'readwrite')
      transaction.objectStore('bytes').put(new Uint8Array([1, 2, 3]), 'bytes-key')
      transaction.objectStore('records').put({ stable: true }, 'record-key')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    legacy.close()

    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(store.getBytes('bytes-key')).resolves.toEqual(new Uint8Array([1, 2, 3]))
    await expect(store.getRecord('record-key')).resolves.toEqual({ stable: true })
    await store.dispose()
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(upgraded.version).toBe(3)
    expect(upgraded.objectStoreNames.contains('storage-web:index-records')).toBe(true)
    upgraded.close()
  })

  it('logical index definitions do not trigger another database upgrade', async () => {
    const factory = freshFactory()
    const dbName = 'logical-index-no-upgrade'
    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const indexed = store
    await store.get('probe')
    await indexed.ensureRecordIndexes('users', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    await store.dispose()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(database.version).toBe(1)
    database.close()
  })

  it('indexed put atomically replaces sidecar projection and increments revision', async () => {
    const factory = freshFactory()
    const store = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName: 'indexed-put'
    })
    const indexed = store
    const handle = await indexed.ensureRecordIndexes('users', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    await indexed.putIndexedRecord({ id: 'u1', email: 'a@example.test' }, 'u1', handle, {
      email: { kind: 'single', key: 'a@example.test' }
    })
    await indexed.putIndexedRecord({ id: 'u1', email: 'b@example.test' }, 'u1', handle, {
      email: { kind: 'single', key: 'b@example.test' }
    })
    await store.dispose()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('indexed-put')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(['records', 'storage-web:index-records'], 'readonly')
    await new Promise<void>((resolve, reject) => {
      const recordRequest = transaction.objectStore('records').get('u1')
      recordRequest.onsuccess = () => {
        expect(recordRequest.result).toEqual({ id: 'u1', email: 'b@example.test' })
        const keysRequest = transaction
          .objectStore('storage-web:index-records')
          .index('lookup')
          .getAllKeys(['users', 'email', handle.generation, 'a@example.test'])
        keysRequest.onsuccess = () => {
          expect(keysRequest.result).toHaveLength(0)
          resolve()
        }
        keysRequest.onerror = () => reject(keysRequest.error)
      }
      recordRequest.onerror = () => reject(recordRequest.error)
    })
    database.close()
  })

  it('indexed planner rolls back unique conflicts and atomically deletes rows', async () => {
    const store = await freshDb()
    /** Canonical entity keys let the complete scope remove the matching sidecars precisely. */
    const firstKey = entityRecordKey(store, 'unique-users', 'u1')
    /** A separate record owns the second unique index value after the first record is deleted. */
    const secondKey = entityRecordKey(store, 'unique-users', 'u2')
    /** This third record must never survive its conflicting unique projection. */
    const thirdKey = entityRecordKey(store, 'unique-users', 'u3')
    const handle = await store.ensureRecordIndexes('unique-users', [
      { name: 'email', unique: true, multiEntry: false, revision: 1 }
    ])
    await expect(
      store.transactionIndexed(handle, async (transaction) => {
        await transaction.putIndexedRecord({ id: 'u1' }, firstKey, handle, {
          email: { kind: 'single', key: 'same@example.test' }
        })
        await transaction.putIndexedRecord({ id: 'u2' }, secondKey, handle, {
          email: { kind: 'single', key: 'same@example.test' }
        })
      })
    ).rejects.toMatchObject({ code: 'INDEX_UNIQUE_CONFLICT' })
    await expect(store.getRecord(firstKey)).resolves.toBeUndefined()
    await expect(store.getRecord(secondKey)).resolves.toBeUndefined()

    await store.transactionIndexed(handle, async (transaction) => {
      await transaction.putIndexedRecord({ id: 'u1' }, firstKey, handle, {
        email: { kind: 'single', key: 'one@example.test' }
      })
      await transaction.putIndexedRecord({ id: 'u2' }, secondKey, handle, {
        email: { kind: 'single', key: 'two@example.test' }
      })
    })
    await expect(
      store.putIndexedRecord({ id: 'u3' }, thirdKey, handle, {
        email: { kind: 'single', key: 'one@example.test' }
      })
    ).rejects.toMatchObject({ code: 'INDEX_UNIQUE_CONFLICT' })
    await expect(store.getRecord(thirdKey)).resolves.toBeUndefined()
    await store.transactionIndexed(handle, async (transaction) => {
      expect(await transaction.getRecord(firstKey)).toEqual({ id: 'u1' })
      await transaction.deleteRecord(firstKey)
    })
    await expect(store.getRecord(firstKey)).resolves.toBeUndefined()
    await expect(store.getRecord(secondKey)).resolves.toEqual({ id: 'u2' })
    await store.dispose()
  })

  it('reports orphan sidecar rows and excludes them from results', async () => {
    const factory = freshFactory()
    const dbName = 'indexed-orphan-report'
    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const indexed = store
    const handle = await indexed.ensureRecordIndexes('users', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    await store.dispose()

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        ['storage-web:meta', 'storage-web:index-records'],
        'readwrite'
      )
      transaction.objectStore('storage-web:meta').put(
        {
          handle,
          readiness: { status: 'complete', scanned: 1, indexed: 1 }
        },
        ['__storage_web_internal__', 'index', 'users']
      )
      transaction.objectStore('storage-web:index-records').put({
        scope: 'users',
        generation: handle.generation,
        indexName: 'email',
        indexValue: 'orphan@example.test',
        recordKey: 'missing-record'
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    const reported: unknown[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => reported.push(args[1])
    try {
      const reopened = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
      const result = await reopened.iterateRecordIndex({ handle, index: 'email' }).next()
      expect(result.done).toBe(true)
      expect(reported[0]).toEqual(
        expect.objectContaining({
          source: '@migaia/storage-web',
          code: 'INDEX_ORPHAN',
          message: 'indexed record index contains orphan sidecar row',
          key: 'missing-record'
        })
      )
      await reopened.dispose()
    } finally {
      console.error = originalError
    }
  })

  it('pages a native index in bounded transactions across both directions', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    const total = 70
    for (let index = 0; index < total; index += 1)
      await store.putRecord({ value: index }, `record-${index}`)
    const indexed = store as unknown as {
      ensureRecordIndexes: (
        scope: string,
        definitions: readonly unknown[]
      ) => Promise<{ scope: string; generation: string; fingerprint: string }>
      iterateRecordIndex: (
        query: unknown
      ) => AsyncIterableIterator<[IStorageKey, { value: number }]>
    }
    const handle = await indexed.ensureRecordIndexes('users', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, backfillOptions)
    const batch = await session.readBatch()
    expect(batch.candidates).toHaveLength(total)
    expect(batch.endOfScan).toBe(true)
    await session.commitBatch({
      generation: handle.generation,
      ownerToken: session.ownerToken,
      checkpoint: batch.checkpoint,
      nextCheckpoint: batch.candidates[batch.candidates.length - 1]!.key,
      endOfScan: true,
      projections: batch.candidates.map((candidate) => ({
        key: candidate.key,
        expectedRevision: candidate.revision,
        outcome: 'indexed' as const,
        projection: {
          value: { kind: 'single' as const, key: (candidate.raw as { value: number }).value }
        }
      }))
    })

    const forward: number[] = []
    for await (const [, value] of indexed.iterateRecordIndex({ handle, index: 'value' }))
      forward.push(value.value)
    expect(forward).toHaveLength(total)
    expect(forward).toEqual([...forward].sort((a, b) => a - b))

    const backward: number[] = []
    for await (const [, value] of indexed.iterateRecordIndex({
      handle,
      index: 'value',
      direction: 'prev'
    }))
      backward.push(value.value)
    expect(backward).toEqual([...forward].reverse())

    const iterator = indexed.iterateRecordIndex({ handle, index: 'value' })
    for (let index = 0; index < 64; index += 1) {
      const result = await iterator.next()
      expect(result.done).toBe(false)
    }
    await store.putRecord({ value: 'unrelated-mutation' }, 'record-unrelated')
    await expect(iterator.next()).rejects.toMatchObject({ code: 'INDEX_QUERY_INVALIDATED' })
    await store.dispose()
  })

  it('pages a non-unique index whose duplicate group straddles the page boundary in both directions without loss or duplication', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    /**
     * 50 unique-low + 20 tied (value 50) + 50 unique-high records. Forward order consumes 50 low +
     * 14 of the tie group before the 64-item page boundary; backward order consumes 50 high + 14 of
     * the _same_ tie group before its own boundary — so the tie group straddles
     * `INDEX_QUERY_PAGE_SIZE` in both directions from one fixture.
     */
    const lowKeys: string[] = []
    for (let index = 0; index < 50; index += 1) {
      const key = `record-lo-${index}`
      lowKeys.push(key)
      await store.putRecord({ value: index }, key)
    }
    const tieKeys: string[] = []
    for (let index = 0; index < 20; index += 1) {
      const key = `record-tie-${index}`
      tieKeys.push(key)
      await store.putRecord({ value: 50 }, key)
    }
    const highKeys: string[] = []
    for (let index = 0; index < 50; index += 1) {
      const key = `record-hi-${index}`
      highKeys.push(key)
      await store.putRecord({ value: 51 + index }, key)
    }
    const allKeys = new Set([...lowKeys, ...tieKeys, ...highKeys])
    const total = allKeys.size
    const indexed = store as unknown as {
      ensureRecordIndexes: (
        scope: string,
        definitions: readonly unknown[]
      ) => Promise<{ scope: string; generation: string; fingerprint: string }>
      iterateRecordIndex: (
        query: unknown
      ) => AsyncIterableIterator<[IStorageKey, { value: number }]>
    }
    const handle = await indexed.ensureRecordIndexes('users', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, backfillOptions)
    const batch = await session.readBatch()
    expect(batch.candidates).toHaveLength(total)
    expect(batch.endOfScan).toBe(true)
    await session.commitBatch({
      generation: handle.generation,
      ownerToken: session.ownerToken,
      checkpoint: batch.checkpoint,
      nextCheckpoint: batch.candidates[batch.candidates.length - 1]!.key,
      endOfScan: true,
      projections: batch.candidates.map((candidate) => ({
        key: candidate.key,
        expectedRevision: candidate.revision,
        outcome: 'indexed' as const,
        projection: {
          value: { kind: 'single' as const, key: (candidate.raw as { value: number }).value }
        }
      }))
    })

    const forwardKeys: string[] = []
    const forwardValues: number[] = []
    for await (const [key, value] of indexed.iterateRecordIndex({ handle, index: 'value' })) {
      forwardKeys.push(key as string)
      forwardValues.push(value.value)
    }
    expect(forwardKeys).toHaveLength(total)
    expect(new Set(forwardKeys)).toEqual(allKeys)
    expect(forwardValues).toEqual([...forwardValues].sort((a, b) => a - b))

    const backwardKeys: string[] = []
    const backwardValues: number[] = []
    for await (const [key, value] of indexed.iterateRecordIndex({
      handle,
      index: 'value',
      direction: 'prev'
    })) {
      backwardKeys.push(key as string)
      backwardValues.push(value.value)
    }
    expect(backwardKeys).toHaveLength(total)
    expect(new Set(backwardKeys)).toEqual(allKeys)
    expect(backwardValues).toEqual([...forwardValues].reverse())
    await store.dispose()
  })

  it('pages a tie group larger than the page size with O(pageSize) cursor steps, not a quadratic re-walk', async () => {
    const { store, capability: backfill } = await createBackfillDb()
    // Exceeds `INDEX_QUERY_PAGE_SIZE` (64, so the group spans multiple pages) while staying under
    // the backfill session's own default batch cap (128), so a single `readBatch` covers it.
    const total = 100
    for (let index = 0; index < total; index += 1)
      await store.putRecord({ value: 'tied' }, `record-${String(index).padStart(4, '0')}`)
    const indexed = store as unknown as {
      ensureRecordIndexes: (
        scope: string,
        definitions: readonly unknown[]
      ) => Promise<{ scope: string; generation: string; fingerprint: string }>
      iterateRecordIndex: (
        query: unknown
      ) => AsyncIterableIterator<[IStorageKey, { value: string }]>
    }
    const handle = await indexed.ensureRecordIndexes('users', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const capability = backfill
    const session = await capability.openBackfillSession(handle, backfillOptions)
    const batch = await session.readBatch()
    expect(batch.candidates).toHaveLength(total)
    await session.commitBatch({
      generation: handle.generation,
      ownerToken: session.ownerToken,
      checkpoint: batch.checkpoint,
      nextCheckpoint: batch.candidates[batch.candidates.length - 1]!.key,
      endOfScan: true,
      projections: batch.candidates.map((candidate) => ({
        key: candidate.key,
        expectedRevision: candidate.revision,
        outcome: 'indexed' as const,
        projection: {
          value: { kind: 'single' as const, key: (candidate.raw as { value: string }).value }
        }
      }))
    })

    /**
     * Counts native cursor step calls across the whole iteration. A JS re-walk of every
     * already-emitted tied entry on each page is `Θ(G)` per page and `Θ(G²/pageSize)` overall for a
     * tie group of size `G`; `continuePrimaryKey`-based resumption keeps this near-linear in `G` (a
     * small constant number of extra steps per page boundary, not per tied row).
     */
    let continueCalls = 0
    let continuePrimaryKeyCalls = 0
    const originalContinue = IDBCursor.prototype.continue
    const originalContinuePrimaryKey = IDBCursor.prototype.continuePrimaryKey
    IDBCursor.prototype.continue = function (...args: Parameters<typeof originalContinue>) {
      continueCalls += 1
      return Reflect.apply(originalContinue, this, args)
    }
    IDBCursor.prototype.continuePrimaryKey = function (
      ...args: Parameters<typeof originalContinuePrimaryKey>
    ) {
      continuePrimaryKeyCalls += 1
      return Reflect.apply(originalContinuePrimaryKey, this, args)
    }
    let forwardKeys: string[]
    try {
      forwardKeys = []
      for await (const [key] of indexed.iterateRecordIndex({ handle, index: 'value' }))
        forwardKeys.push(key as string)
    } finally {
      IDBCursor.prototype.continue = originalContinue
      IDBCursor.prototype.continuePrimaryKey = originalContinuePrimaryKey
    }
    expect(forwardKeys).toHaveLength(total)
    expect(new Set(forwardKeys).size).toBe(total)
    const totalSteps = continueCalls + continuePrimaryKeyCalls
    // Linear bound with slack for one extra step per page boundary; a quadratic re-walk of a
    // 100-row tie group across 2 pages (pageSize 64) would cost roughly 100 + 64 = 164 steps,
    // well above this bound.
    expect(totalSteps).toBeLessThan(total + 20)
    await store.dispose()
  })

  it('upgrade 将历史 documents store 复制到 records，并保留旧 store 供人工清理', async () => {
    const factory = freshFactory()
    const dbName = 'documents-to-records'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents')
        request.result.createObjectStore('records')
      }
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      transaction.objectStore('documents').put({ legacy: true }, 'legacy-key')
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()

    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(store.getRecord('legacy-key')).resolves.toEqual({ legacy: true })
    await store.dispose()
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
    })
    expect(database.objectStoreNames.contains('documents')).toBe(true)
    const metadata = await new Promise<unknown>((resolve) => {
      const transaction = database.transaction('storage-web:meta', 'readonly')
      const request = transaction.objectStore('storage-web:meta').get('migration:records-v1-to-v2')
      request.onsuccess = () => resolve(request.result)
    })
    expect(metadata).toMatchObject({ status: 'complete', from: 'documents', to: 'records' })
    database.close()
  })

  it('clearRecords 不得清除 legacy migration checkpoint，reopen 后已清除的 legacy record 不得复活', async () => {
    const factory = freshFactory()
    const dbName = 'documents-clear-no-resurrection'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents')
        request.result.createObjectStore('records')
      }
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      transaction.objectStore('documents').put({ legacy: true }, 'legacy-key')
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()

    const first = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(first.getRecord('legacy-key')).resolves.toEqual({ legacy: true })
    await first.clearRecords()
    await expect(first.getRecord('legacy-key')).resolves.toBeUndefined()
    await first.dispose()

    // The legacy `documents` store was never touched by clearRecords, so re-running the
    // migration guard on a fresh store instance must recognize the checkpoint as complete and
    // not silently re-copy the already-cleared row back into `records`.
    const second = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(second.getRecord('legacy-key')).resolves.toBeUndefined()
    await second.dispose()

    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
    })
    const checkpoint = await new Promise<unknown>((resolve) => {
      const transaction = database.transaction('storage-web:meta', 'readonly')
      const request = transaction.objectStore('storage-web:meta').get('migration:records-v1-to-v2')
      request.onsuccess = () => resolve(request.result)
    })
    expect(checkpoint).toMatchObject({ status: 'complete', from: 'documents', to: 'records' })
    database.close()
  })

  it.each(['clearRecords', 'clearAll'] as const)(
    '%s 保留 public metadata、global epoch 与防 ABA 墓碑，清空旧索引 revisions',
    async (operation) => {
      const factory = freshFactory()
      const dbName = `clear-scope-${operation}`
      const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
      await store.metadata!.set('user-key', { keep: 'yes' })
      await store.putRecord({ value: 1 }, 'record-1')
      await store.putRecord({ value: 2 }, 'record-2')

      if (operation === 'clearRecords') await store.clearRecords()
      else await store.clearAll()

      await expect(store.metadata!.get('user-key')).resolves.toEqual({ keep: 'yes' })
      await expect(store.getRecord('record-1')).resolves.toBeUndefined()
      await store.dispose()

      // Original record/index revisions are cleared; complete point tombstones survive so an
      // independently opened contract writer cannot reset a committed undo revision.
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = factory.open(dbName)
        request.onsuccess = () => resolve(request.result)
      })
      const revisionKeys = await new Promise<IDBValidKey[]>((resolve) => {
        const transaction = database.transaction('__storage_web_revisions__', 'readonly')
        const request = transaction.objectStore('__storage_web_revisions__').getAllKeys()
        request.onsuccess = () => resolve(request.result as IDBValidKey[])
      })
      database.close()
      expect(revisionKeys).toEqual([
        '__storage_web_record_epoch__',
        ['__storage_web_internal__', 'journal-point', 'record', encodeFlatStorageKey('record-1')],
        ['__storage_web_internal__', 'journal-point', 'record', encodeFlatStorageKey('record-2')]
      ])
    }
  )

  it('后续 schema upgrade 不会重复 legacy copy 覆盖已迁移 records', async () => {
    const factory = freshFactory()
    const dbName = 'documents-copy-once'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents')
        request.result.createObjectStore('records')
      }
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      transaction.objectStore('documents').put({ value: 'legacy' }, 'key')
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()
    const first = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(first.getRecord('key')).resolves.toEqual({ value: 'legacy' })
    await first.putRecord({ value: 'new' }, 'key', { conflictPolicy: 'replace' })
    await first.dispose()
    const second = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName,
      kvStoreName: 'kv-next'
    })
    await expect(second.getRecord('key')).resolves.toEqual({ value: 'new' })
    await second.dispose()
  })

  it('cleanupLegacyRecords 显式开启时才删除 documents store', async () => {
    const factory = freshFactory()
    const dbName = 'documents-cleanup-opt-in'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('documents')
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      transaction.objectStore('documents').put({ legacy: true }, 'key')
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()
    const store = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName,
      cleanupLegacyRecords: true
    })
    await expect(store.getRecord('key')).resolves.toEqual({ legacy: true })
    await store.dispose()
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
    })
    expect(database.objectStoreNames.contains('documents')).toBe(false)
    database.close()
  })

  it('后续显式 cleanup 可清理已完成迁移但仍保留的 documents store', async () => {
    const factory = freshFactory()
    const dbName = 'documents-late-cleanup'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('documents')
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      transaction.objectStore('documents').put({ legacy: true }, 'key')
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()
    const first = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(first.getRecord('key')).resolves.toEqual({ legacy: true })
    await first.dispose()
    const cleanup = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName,
      cleanupLegacyRecords: true
    })
    await expect(cleanup.getRecord('key')).resolves.toEqual({ legacy: true })
    await cleanup.dispose()
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
    })
    expect(database.objectStoreNames.contains('documents')).toBe(false)
    database.close()
  })

  it('legacy migration 超过单批后按 lastKey 继续，不重复首批', async () => {
    const factory = freshFactory()
    const dbName = 'documents-large-migration'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('documents')
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      const documents = transaction.objectStore('documents')
      for (let index = 0; index < 130; index += 1)
        documents.put({ index }, `legacy-${String(index).padStart(3, '0')}`)
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()
    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(store.getRecord('legacy-000')).resolves.toEqual({ index: 0 })
    await store.dispose()
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
    })
    const transaction = database.transaction('records', 'readonly')
    const count = await new Promise<number>((resolve, reject) => {
      const request = transaction.objectStore('records').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(count).toBe(130)
    database.close()
  })

  it('legacy migration 缺少 keyRange 失败后可用新连接从 checkpoint 重试', async () => {
    const factory = freshFactory()
    const dbName = 'documents-migration-retry'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('documents')
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      for (let index = 0; index < 130; index += 1)
        transaction.objectStore('documents').put({ index }, `key-${String(index).padStart(3, '0')}`)
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()
    await expectNativeInstallationFailure(createIndexedDbTestStore({ factory, dbName }), {
      code: 'BACKEND_UNAVAILABLE'
    })
    const retry = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(retry.getRecord('key-129')).resolves.toEqual({ index: 129 })
    await retry.dispose()
  })

  it('legacy migration transaction 提前 complete 时不会永久 pending', async () => {
    const factory = freshFactory()
    const dbName = 'documents-premature-cursor-complete'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('documents')
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      transaction.objectStore('documents').put({ legacy: true }, 'key')
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()
    const originalOpenCursor = IDBObjectStore.prototype.openCursor
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        set onsuccess(_handler: unknown) {},
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor
    try {
      await expectNativeInstallationFailure(
        createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName }),
        {
          code: 'TRANSACTION_FAILED',
          backend: 'indexed-db',
          operation: 'indexeddb.legacy.cursor'
        }
      )
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor
    }
  })

  it('legacy migration 不覆盖已存在的 records v2 键', async () => {
    const factory = freshFactory()
    const dbName = 'documents-migration-winner'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents')
        request.result.createObjectStore('records')
      }
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      transaction.objectStore('documents').put({ value: 'legacy' }, 'same')
      transaction.oncomplete = () => resolve()
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('records', 'readwrite')
      transaction.objectStore('records').put({ value: 'current' }, 'same')
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()
    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(store.getRecord('same')).resolves.toEqual({ value: 'current' })
    await store.dispose()
  })

  it('backend 与 capabilities 正确声明（无 sync 通道）', async () => {
    const store = await freshDb()
    expect(store.backend).toBe('indexed-db')
    expect(store.capabilities.syncRead).toBe(false)
    expect(store.capabilities.binary).toBe(true)
    expect(store.capabilities.records).toBe(true)
    expect(store.sync).toBeUndefined()
    expect(store.metadata).toBeDefined()
  })

  it('metadata channel persists and deletes maintenance state', async () => {
    const store = await freshDb()
    await store.metadata!.set('maintenance', { batch: 2 })
    await expect(store.metadata!.get('maintenance')).resolves.toEqual({ batch: 2 })
    await store.metadata!.delete('maintenance')
    await expect(store.metadata!.get('maintenance')).resolves.toBeUndefined()
  })

  it('未提供 factory 且 globalThis.indexedDB 不存在时抛 BACKEND_UNAVAILABLE', async () => {
    await expectNativeInstallationFailure(
      createIndexedDbTestStore({ factory: undefined as unknown as IDBFactory }),
      { code: 'BACKEND_UNAVAILABLE' }
    )
  })

  it('两条通道字节原样存取，文本通道存字符串', async () => {
    const store = await freshDb()
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    await store.setBytes('bin-key', bytes)
    await expect(store.getBytes('bin-key')).resolves.toEqual(bytes)
    await expect(store.get('bin-key')).resolves.toBeNull()

    await store.set('text-key', '{"a":1}')
    await expect(store.get('text-key')).resolves.toBe('{"a":1}')
    await expect(store.getBytes('text-key')).resolves.toBeNull()
  })

  it('iterateRecords 按 pageSize 分页且保持完整顺序', async () => {
    const store = await freshDb()
    for (let index = 0; index < 5; index += 1) await store.putRecord({ index }, `page-${index}`)
    const keys: string[] = []
    for await (const [key] of store.iterateRecords(undefined, { pageSize: 2 }))
      keys.push(key as string)
    expect(keys).toEqual(['page-0', 'page-1', 'page-2', 'page-3', 'page-4'])
  })

  it('非字符串 record key 不与 value/bytes 字符串 key 冲突', async () => {
    const store = await freshDb()
    await store.set('1', 'text')
    await store.putRecord({ kind: 'number' }, 1)
    await expect(store.get('1')).resolves.toBe('text')
    await expect(store.getRecord(1)).resolves.toEqual({ kind: 'number' })
    await store.putRecord({ kind: 'date' }, new Date('2024-01-01T00:00:00Z'))
    await expect(store.get('1')).resolves.toBe('text')
  })

  it('已 abort 的 signal 立即拒绝', async () => {
    const store = await freshDb()
    const controller = new AbortController()
    controller.abort()
    await expect(store.set('k', 'v', { signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED'
    })
  })

  it('重复打开同一个 dbName 复用同一个连接（不重复升级）', async () => {
    const factory = freshFactory()
    const dbName = `shared-${Math.random().toString(36).slice(2)}`
    const storeA = await createIndexedDbTestStore({ factory, dbName })
    await storeA.set('k', 'from-a')
    const storeB = await createIndexedDbTestStore({ factory, dbName })
    await expect(storeB.get('k')).resolves.toBe('from-a')
  })

  it('dispose 后关闭连接，操作抛 STORE_DISPOSED', async () => {
    const store = await freshDb()
    await store.set('k', 'v')
    await store.dispose()
    await expect(store.get('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
  })

  it('dispose 在安装后尚未执行数据操作时正常完成', async () => {
    const store = await freshDb()
    await expect(store.dispose()).resolves.toBeUndefined()
  })

  it('getBytes 对已存在但类型不是字节的值返回 null', async () => {
    const store = await freshDb()
    await store.set('k', 'plain text')
    await expect(store.getBytes('k')).resolves.toBeNull()
  })

  it('iterate 遍历 records store，range 按 IDBKeyRange 语义过滤', async () => {
    const store = await freshDb()
    await store.putRecord({ v: 1 }, 1)
    await store.putRecord({ v: 2 }, 2)
    await store.putRecord({ v: 3 }, 3)

    const collect = async (range?: Parameters<typeof store.iterateRecords>[0]) => {
      const seen: unknown[] = []
      for await (const [, value] of store.iterateRecords(range)) seen.push(value)
      return seen
    }

    expect(await collect()).toHaveLength(3)
    expect(await collect({ lower: 2 })).toEqual([{ v: 2 }, { v: 3 }])
    expect(await collect({ upper: 2, upperOpen: true })).toEqual([{ v: 1 }])
    expect(await collect({ lower: 1, lowerOpen: true, upper: 3 })).toEqual([{ v: 2 }, { v: 3 }])
  })

  it('iterate 在已 abort 时抛 ABORTED', async () => {
    const store = await freshDb()
    await store.putRecord({ v: 1 }, 1)
    const controller = new AbortController()
    controller.abort()
    const iterator = store.iterateRecords(undefined, { signal: controller.signal })
    await expect(iterator.next()).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('悬挂 cursor 在外部 abort 后主动唤醒并以 ABORTED 结束', async () => {
    const store = await freshDb()
    await store.putRecord({ v: 1 }, 'hanging-key')
    const originalOpenCursor = IDBObjectStore.prototype.openCursor
    IDBObjectStore.prototype.openCursor = (() => ({}) as IDBRequest) as typeof originalOpenCursor
    const controller = new AbortController()
    try {
      const pending = store.iterateRecords(undefined, { signal: controller.signal }).next()
      await Promise.resolve()
      controller.abort('hanging cursor')
      await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor
    }
  })

  it('悬挂 cursor 在 timeout 到期后主动唤醒并以 ABORTED 结束', async () => {
    const store = await freshDb()
    await store.putRecord({ v: 1 }, 'timeout-hanging-key')
    const originalOpenCursor = IDBObjectStore.prototype.openCursor
    IDBObjectStore.prototype.openCursor = (() => ({}) as IDBRequest) as typeof originalOpenCursor
    try {
      const pending = store.iterateRecords(undefined, { timeoutMs: 0 }).next()
      await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor
    }
  })

  it('cursor listener 同步 abort race 稳定返回 ABORTED', async () => {
    const store = await freshDb()
    await store.putRecord({ v: 1 }, 'sync-abort-key')
    let aborted = false
    const signal = {
      get aborted() {
        return aborted
      },
      reason: 'sync cursor abort',
      addEventListener: (_type: string, listener: () => void) => {
        aborted = true
        listener()
      },
      removeEventListener: () => {}
    } as never
    await expect(store.iterateRecords(undefined, { signal }).next()).rejects.toMatchObject({
      code: 'ABORTED',
      cause: 'sync cursor abort'
    })
  })

  it('cursor listener setup/cleanup 异常遵循共享 operation 协议', async () => {
    const store = await freshDb()
    await store.putRecord({ v: 1 }, 'listener-key')
    await expect(
      store
        .iterateRecords(undefined, {
          signal: {
            aborted: false,
            addEventListener: () => {
              throw new Error('hostile cursor listener setup')
            },
            removeEventListener: () => {}
          } as never
        })
        .next()
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    const cleanup = await captureOperationCleanup(() =>
      store
        .iterateRecords(undefined, {
          signal: {
            aborted: false,
            addEventListener: () => {},
            removeEventListener: () => {
              throw new Error('hostile cursor listener cleanup')
            }
          } as never
        })
        .next()
    )
    expect(cleanup.result.value?.[1]).toEqual({ v: 1 })
    expect(cleanup.reports).toEqual([
      expect.objectContaining({ message: 'hostile cursor listener cleanup' })
    ])
  })

  it('cursor request.error 统一归一为 TRANSACTION_FAILED 并保留 cause', async () => {
    const store = await freshDb()
    const originalOpenCursor = IDBObjectStore.prototype.openCursor
    const cause = new DOMException('cursor failed', 'UnknownError')
    IDBObjectStore.prototype.openCursor = (() => {
      const request = {
        error: cause,
        result: null,
        set onsuccess(_handler: unknown) {},
        set onerror(handler: (() => void) | null) {
          queueMicrotask(() => handler?.())
        }
      }
      return request
    }) as typeof originalOpenCursor
    try {
      await expect(store.iterateRecords().next()).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        cause
      })
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor
    }
  })

  it.each(['key', 'value', 'continue'] as const)(
    'cursor %s 异常保留 owning operation 且不会泄漏 callback',
    async (attack) => {
      const store = await freshDb()
      await store.putRecord({ v: 1 }, `cursor-${attack}-key`)
      const originalOpenCursor = IDBObjectStore.prototype.openCursor
      const cause = new Error(`hostile cursor ${attack}`)
      const cursor = {
        get key(): IDBValidKey {
          if (attack === 'key') throw cause
          return 'key'
        },
        get value(): unknown {
          if (attack === 'value') throw cause
          return { v: 1 }
        },
        continue: () => {
          if (attack === 'continue') throw cause
        }
      } as unknown as IDBCursorWithValue
      IDBObjectStore.prototype.openCursor = (() =>
        ({
          result: cursor,
          set onsuccess(handler: (() => void) | null) {
            queueMicrotask(() => handler?.())
          },
          set onerror(_handler: unknown) {}
        }) as unknown as IDBRequest) as typeof originalOpenCursor
      try {
        await expect(store.iterateRecords().next()).rejects.toMatchObject({
          code: 'TRANSACTION_FAILED',
          backend: 'indexed-db',
          operation: 'indexeddb.cursor',
          cause
        })
      } finally {
        IDBObjectStore.prototype.openCursor = originalOpenCursor
        await store.dispose()
      }
    }
  )

  it('cursor transaction 提前 complete 时不会永久 pending', async () => {
    const store = await freshDb()
    await store.putRecord({ v: 1 }, 'premature-complete-key')
    const originalOpenCursor = IDBObjectStore.prototype.openCursor
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        set onsuccess(_handler: unknown) {},
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor
    try {
      await expect(store.iterateRecords().next()).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexed-db',
        operation: 'indexeddb.cursor'
      })
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor
      await store.dispose()
    }
  })

  it('transaction 成功后写入持久化', async () => {
    const store = await freshDb()
    await store.transaction(async (tx) => {
      await tx.putRecord({ v: 1 }, 'tx-key')
    })
    await expect(store.getRecord('tx-key')).resolves.toEqual({ v: 1 })
  })

  it('transaction 内抛错时通过原生 abort 整批回滚', async () => {
    const store = await freshDb()
    await store.putRecord({ v: 'before' }, 'existing')
    await expect(
      store.transaction(async (tx) => {
        await tx.putRecord({ v: 'new' }, 'tx-key')
        await tx.deleteRecord('existing')
        throw new Error('boom')
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    await expect(store.getRecord('tx-key')).resolves.toBeUndefined()
    await expect(store.getRecord('existing')).resolves.toEqual({ v: 'before' })
  })

  it('transaction 内同任务的 microtask await 后保持单次提交语义', async () => {
    const store = await freshDb()
    await expect(
      store.transaction(async (tx) => {
        await tx.putRecord({ v: 1 }, 'k')
        await Promise.resolve()
        await tx.putRecord({ v: 2 }, 'k2')
      })
    ).resolves.toBeUndefined()
    await expect(store.getRecord('k')).resolves.toEqual({ v: 1 })
    await expect(store.getRecord('k2')).resolves.toEqual({ v: 2 })
  })

  it('自动生成 key（putRecord 不传 key）可用返回值读回', async () => {
    const store = await freshDb()
    const key = await store.putRecord({ a: 1 })
    await expect(store.getRecord(key)).resolves.toEqual({ a: 1 })
  })

  it('setBytes 接受由其他 codec 产出的字节', async () => {
    const store = await freshDb()
    await store.setBytes('k', encoder.encode('hello'))
    const read = await store.getBytes('k')
    expect(read).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(read!)).toBe('hello')
  })

  it('transaction 作用域内 getRecord 可读取已写入的记录', async () => {
    const store = await freshDb()
    await store.putRecord({ v: 1 }, 'k')
    await store.transaction(async (tx) => {
      await expect(tx.getRecord('k')).resolves.toEqual({ v: 1 })
      await expect(tx.getRecord('missing')).resolves.toBeUndefined()
    })
  })

  it('getBytes 对原生 ArrayBuffer（非 Uint8Array 包装）值也能识别', async () => {
    const factory = freshFactory()
    const dbName = `raw-buffer-${Math.random().toString(36).slice(2)}`
    // 直接用原生 IDB API 写入一个裸 ArrayBuffer，模拟某些实现把字节还原成
    // ArrayBuffer 而不是 Uint8Array 的情况。
    const rawDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('kv')
        request.result.createObjectStore('bytes')
        request.result.createObjectStore('records')
      }
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const tx = rawDb.transaction('bytes', 'readwrite')
      tx.objectStore('bytes').put(new Uint8Array([9, 8, 7]).buffer, 'raw-buffer-key')
      tx.oncomplete = () => resolve()
    })
    rawDb.close()

    const store = await createIndexedDbTestStore({ factory, dbName, keyRange: IDBKeyRange })
    await expect(store.getBytes('raw-buffer-key')).resolves.toEqual(new Uint8Array([9, 8, 7]))
  })

  it('已有部分 store（缺 records store）时补建，不影响已有数据', async () => {
    const factory = freshFactory()
    const dbName = `partial-${Math.random().toString(36).slice(2)}`
    // 模拟只创建过 kv store 的旧版数据库。
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('kv')
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const tx = legacyDb.transaction('kv', 'readwrite')
      tx.objectStore('kv').put('legacy-value', 'legacy-key')
      tx.oncomplete = () => resolve()
    })
    legacyDb.close()

    const store = await createIndexedDbTestStore({ factory, dbName, keyRange: IDBKeyRange })
    await expect(store.get('legacy-key')).resolves.toBe('legacy-value')
    await store.putRecord({ v: 1 }, 'doc-key')
    await expect(store.getRecord('doc-key')).resolves.toEqual({ v: 1 })
  })

  it('升级前 close 抛错时回滚 recovery connection，后续安装可重试', async () => {
    const factory = freshFactory()
    const dbName = 'partial-hostile-transition-close'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('kv')
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('kv', 'readwrite')
      transaction.objectStore('kv').put('legacy-value', 'legacy-key')
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()
    const cause = new Error('hostile transition close')
    const close = vi.spyOn(IDBDatabase.prototype, 'close').mockImplementationOnce(() => {
      throw cause
    })
    try {
      await expectNativeInstallationFailure(
        createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName }),
        {
          code: 'BACKEND_UNAVAILABLE',
          backend: 'indexed-db',
          operation: 'indexeddb.close',
          cause
        }
      )
      // Original host rollback retries only its retained recovery connection before it rejects.
      expect(close).toHaveBeenCalledTimes(2)
      const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
      await expect(store.get('legacy-key')).resolves.toBe('legacy-value')
      await expect(store.putRecord({ recovered: true }, 'record')).resolves.toBe('record')
    } finally {
      close.mockRestore()
    }
  })

  it('open 请求失败时归一为可读错误（而非裸 IDB 异常）', async () => {
    const failingFactory: IDBFactory = {
      open: () => {
        const listeners: Record<string, (() => void) | null> = { onerror: null }
        const request = {
          error: new DOMException('open failed', 'UnknownError'),
          get onerror() {
            return listeners.onerror
          },
          set onerror(handler) {
            listeners.onerror = handler
            queueMicrotask(() => handler?.())
          },
          set onupgradeneeded(_handler: unknown) {},
          set onblocked(_handler: unknown) {},
          set onsuccess(_handler: unknown) {}
        }
        return request as unknown as IDBOpenDBRequest
      }
    } as unknown as IDBFactory

    await expectNativeInstallationFailure(
      createIndexedDbTestStore({ factory: failingFactory, dbName: 'x' }),
      {
        source: '@migaia/storage-web',
        code: 'BACKEND_UNAVAILABLE',
        backend: 'indexed-db',
        operation: 'indexeddb.open',
        cause: expect.objectContaining({ name: 'UnknownError', message: 'open failed' })
      }
    )
  })

  it('factory.open 同步抛错时也归一为 UNAVAILABLE', async () => {
    const cause = new DOMException('open threw', 'SecurityError')
    const throwingFactory = {
      open: () => {
        throw cause
      }
    } as unknown as IDBFactory
    await expectNativeInstallationFailure(
      createIndexedDbTestStore({ factory: throwingFactory, dbName: 'sync-open-throw' }),
      {
        code: 'BACKEND_UNAVAILABLE',
        operation: 'indexeddb.open',
        cause
      }
    )
  })

  it('dispose 封口已安装后端并等待已接纳请求结算', async () => {
    const store = await freshDb()
    const pendingGet = store.get('k')
    const disposePromise = store.dispose()
    await expect(pendingGet).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(disposePromise).resolves.toBeUndefined()
  })

  it('dispose 后的请求不能复用已关闭连接', async () => {
    const factory = freshFactory()
    const dbName = 'dispose-open-race'
    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const pending = store.get('k')
    await store.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(store.get('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
  })

  it('versionchange close 抛错后仍清除 stale connection cache', async () => {
    const factory = freshFactory()
    const dbName = 'versionchange-hostile-close'
    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    await store.set('before', 'value')
    const current = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const nextVersion = current.version + 1
    current.close()

    const originalClose = IDBDatabase.prototype.close
    let reportCloseAttempt!: (database: IDBDatabase) => void
    const closeAttempted = new Promise<IDBDatabase>((resolve) => {
      reportCloseAttempt = resolve
    })
    IDBDatabase.prototype.close = function (this: IDBDatabase): void {
      reportCloseAttempt(this)
      throw new Error('hostile versionchange close')
    }
    const upgrade = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName, nextVersion)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const staleDatabase = await closeAttempted
      IDBDatabase.prototype.close = originalClose
      staleDatabase.close()
      const upgraded = await upgrade
      upgraded.close()
      await expect(store.set('after', 'reopened')).resolves.toBeUndefined()
      await expect(store.get('after')).resolves.toBe('reopened')
    } finally {
      IDBDatabase.prototype.close = originalClose
      await store.dispose()
    }
  })

  it('自动生成 key 在 crypto.randomUUID 不可用时回退到时间戳方案', async () => {
    const original = crypto.randomUUID
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const store = await freshDb()
      const key = await store.putRecord({ a: 1 })
      expect(typeof key).toBe('string')
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
    }
  })

  it('transaction 作用域内 put 不传 key 时自动生成', async () => {
    const store = await freshDb()
    let generatedKey: unknown
    await store.transaction(async (tx) => {
      generatedKey = await tx.putRecord({ v: 'auto' })
    })
    await expect(store.getRecord(generatedKey as never)).resolves.toEqual({ v: 'auto' })
  })

  it('iterate 在没有注入 keyRange 且传了 range 时抛 BACKEND_UNAVAILABLE', async () => {
    const store = await createIndexedDbTestStore({ factory: freshFactory(), dbName: 'no-keyrange' })
    const iterator = store.iterateRecords({ lower: 1 })
    await expect(iterator.next()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
  })
})

describe('indexedDbHost backend change feed (record channel + clearAll only)', () => {
  it('putRecord/deleteRecord/clearRecords/clearAll each fire exactly one correctly-typed post-commit event', async () => {
    const store = await freshDb()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.putRecord({ x: 1 }, 'r')
    await store.deleteRecord('r')
    await store.putRecord({ x: 1 }, entityRecordKey(store, 'users', 'id-1'))
    await store.clearRecords()
    await store.putRecord({ x: 2 }, 'r2')
    await store.clearAll()

    expect(
      changes.map(({ channel, kind, keys, scope }) => ({ channel, kind, keys, scope }))
    ).toEqual([
      { channel: 'record', kind: 'put', keys: ['r'], scope: undefined },
      { channel: 'record', kind: 'remove', keys: ['r'], scope: undefined },
      {
        channel: 'record',
        kind: 'put',
        keys: [entityRecordKey(store, 'users', 'id-1')],
        scope: 'users'
      },
      { channel: 'record', kind: 'clear', keys: undefined, scope: undefined },
      { channel: 'record', kind: 'put', keys: ['r2'], scope: undefined },
      { channel: 'all', kind: 'clear', keys: undefined, scope: undefined }
    ])
    expect(new Set(changes.map((change) => change.origin)).size).toBe(1)
    expect(changes.map((change) => change.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    await store.dispose()
  })

  it('a no-op deleteRecord/clearRecords/clearAll (nothing to remove/clear) publishes nothing', async () => {
    const store = await freshDb()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.deleteRecord('missing')
    await store.clearRecords()
    await store.clearAll()

    expect(changes).toHaveLength(0)
    await store.dispose()
  })

  it('a putRecord whose write is aborted mid-transaction (real IDBTransaction abort/rollback) publishes nothing', async () => {
    const store = await freshDb()
    await store.putRecord({ warm: true }, 'warm')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    const controller = new AbortController()
    const pending = store.putRecord({ keep: true }, 'put-me', { signal: controller.signal })
    await Promise.resolve()
    controller.abort('cancel put')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })

    // The write was genuinely rolled back, not just the promise rejected.
    await expect(store.getRecord('put-me')).resolves.toBeUndefined()
    expect(changes).toHaveLength(0)
    await store.dispose()
  })

  it('a deleteRecord whose write is aborted mid-transaction publishes nothing, even though the key existed', async () => {
    const store = await freshDb()
    await store.putRecord({ keep: true }, 'delete-me')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    const controller = new AbortController()
    const pending = store.deleteRecord('delete-me', { signal: controller.signal })
    await Promise.resolve()
    controller.abort('cancel delete')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })

    await expect(store.getRecord('delete-me')).resolves.toEqual({ keep: true })
    expect(changes).toHaveLength(0)
    await store.dispose()
  })

  it('a rolled-back native callback publishes nothing while a queued independent write publishes its commit', async () => {
    const store = await freshDb()
    await store.putRecord({ value: 'first' }, 'first')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))
    const cause = new Error('native callback rollback')
    const pending = store.transaction(async (tx) => {
      await tx.getRecord('first')
      await tx.putRecord({ value: 'should-not-commit' }, 'result')
      throw cause
    })
    // Independent work queues outside the callback; awaiting it inside would block the native owner.
    const concurrent = store.putRecord({ value: 'concurrent' }, 'concurrent')
    await expect(pending).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause })
    await concurrent
    await expect(store.getRecord('result')).resolves.toBeUndefined()
    expect(changes.map(({ kind, keys }) => ({ kind, keys }))).toEqual([
      { kind: 'put', keys: ['concurrent'] }
    ])
    await store.dispose()
  })

  it('reopening the same physical database (dispose then a fresh store instance) starts a new, independent change feed: no leaked listeners, no cross-instance delivery, distinct origin', async () => {
    const factory = freshFactory()
    const dbName = 'change-feed-reopen'
    const first = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const firstChanges: IStorageChange[] = []
    first.subscribeChanges((change) => firstChanges.push(change))
    await first.putRecord({ x: 1 }, 'r')
    expect(firstChanges).toHaveLength(1)
    await first.dispose()

    const second = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const secondChanges: IStorageChange[] = []
    second.subscribeChanges((change) => secondChanges.push(change))
    await second.putRecord({ x: 2 }, 'r2')

    // The disposed first instance's listener must not have leaked into the reopened instance,
    // and the reopened instance gets its own fresh sequence/origin.
    expect(firstChanges).toHaveLength(1)
    expect(secondChanges).toHaveLength(1)
    expect(secondChanges[0]!.sequence).toBe(1)
    expect(secondChanges[0]!.origin).not.toBe(firstChanges[0]!.origin)
    await second.dispose()
  })

  it('a conflictPolicy:"replace" write that silently evicts an existing record publishes that record\'s own remove event, matching the memory backend', async () => {
    const store = await freshDb()
    await store.putRecord({ x: 1 }, 'shared')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    // A `value` write with `replace` evicts the pre-existing `record` at the same key.
    await store.set('shared', 'now-a-value', { conflictPolicy: 'replace' })

    expect(changes.map(({ channel, kind, keys }) => ({ channel, kind, keys }))).toEqual([
      { channel: 'value', kind: 'put', keys: ['shared'] },
      { channel: 'record', kind: 'remove', keys: ['shared'] }
    ])
    await expect(store.getRecord('shared')).resolves.toBeUndefined()
    await expect(store.get('shared')).resolves.toBe('now-a-value')
    await store.dispose()
  })

  it('transaction() publishes exactly one batch event for the records it actually commits, and none for a rolled-back or read-only transaction', async () => {
    const store = await freshDb()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.transaction(async (tx) => {
      await tx.putRecord({ v: 1 }, 'a')
      await tx.putRecord({ v: 2 }, 'b')
      await tx.deleteRecord('a')
    })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ channel: 'record', kind: 'batch' })
    expect(new Set(changes[0]!.keys)).toEqual(new Set(['a', 'b']))

    // A transaction whose callback throws must roll back with zero events.
    await expect(
      store.transaction(async (tx) => {
        await tx.putRecord({ v: 3 }, 'c')
        throw new Error('callback failure')
      })
    ).rejects.toThrow()
    expect(changes).toHaveLength(1)
    await expect(store.getRecord('c')).resolves.toBeUndefined()

    // A read-only transaction has nothing to report.
    await store.transaction(async (tx) => {
      await tx.getRecord('a')
    })
    expect(changes).toHaveLength(1)
    await store.dispose()
  })

  it('legacy documents migration finishes before publication without replaying its installation event', async () => {
    const factory = freshFactory()
    const dbName = 'change-feed-legacy-migration'
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents')
        request.result.createObjectStore('records')
      }
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite')
      transaction.objectStore('documents').put({ legacy: true }, 'legacy-key')
      transaction.oncomplete = () => resolve()
    })
    legacyDb.close()

    const store = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))
    // Eager preparation completes migration before a consumer can subscribe to the published store.
    await expect(store.getRecord('legacy-key')).resolves.toEqual({ legacy: true })

    expect(changes).toHaveLength(0)
    await store.dispose()
  })

  it('a database with no legacy documents store publishes no migration event', async () => {
    const store = await freshDb()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))
    await store.putRecord({ x: 1 }, 'k')
    // Only the real putRecord event, nothing from a migration that had nothing to do.
    expect(changes.map((change) => change.kind)).toEqual(['put'])
    await store.dispose()
  })

  it('(planner) transactionIndexed/putIndexedRecord publish exactly one batch event for the records they actually commit, and none on unique-conflict rollback', async () => {
    const store = await freshDb()
    const handle = await store.ensureRecordIndexes('idx-users', [
      { name: 'email', unique: true, multiEntry: false, revision: 1 }
    ])
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.transactionIndexed(handle, async (transaction) => {
      await transaction.putIndexedRecord(
        { id: 'u1' },
        entityRecordKey(store, 'idx-users', 'u1'),
        handle,
        { email: { kind: 'single', key: 'one@test' } }
      )
      await transaction.putIndexedRecord(
        { id: 'u2' },
        entityRecordKey(store, 'idx-users', 'u2'),
        handle,
        { email: { kind: 'single', key: 'two@test' } }
      )
    })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ channel: 'record', kind: 'batch' })
    expect(new Set(changes[0]!.keys)).toEqual(
      new Set([
        entityRecordKey(store, 'idx-users', 'u1'),
        entityRecordKey(store, 'idx-users', 'u2')
      ])
    )

    await expect(
      store.transactionIndexed(handle, async (transaction) => {
        await transaction.putIndexedRecord(
          { id: 'u3' },
          entityRecordKey(store, 'idx-users', 'u3'),
          handle,
          { email: { kind: 'single', key: 'one@test' } }
        )
      })
    ).rejects.toMatchObject({ code: 'INDEX_UNIQUE_CONFLICT' })
    // Rejected by the planner's own in-callback unique check, before any transaction commit.
    expect(changes).toHaveLength(1)
    await expect(
      store.getRecord(entityRecordKey(store, 'idx-users', 'u3'))
    ).resolves.toBeUndefined()

    await expect(
      store.putIndexedRecord({ id: 'u4' }, entityRecordKey(store, 'idx-users', 'u4'), handle, {
        email: { kind: 'single', key: 'one@test' }
      })
    ).rejects.toMatchObject({ code: 'INDEX_UNIQUE_CONFLICT' })
    expect(changes).toHaveLength(1)
    await expect(
      store.getRecord(entityRecordKey(store, 'idx-users', 'u4'))
    ).resolves.toBeUndefined()

    await store.transactionIndexed(handle, async (transaction) => {
      await transaction.deleteRecord(entityRecordKey(store, 'idx-users', 'u1'))
    })
    expect(changes).toHaveLength(2)
    expect(changes[1]).toMatchObject({
      channel: 'record',
      kind: 'batch',
      keys: [entityRecordKey(store, 'idx-users', 'u1')]
    })
    await expect(
      store.getRecord(entityRecordKey(store, 'idx-users', 'u1'))
    ).resolves.toBeUndefined()
    await store.dispose()
  })

  it('the local feed publishes value/bytes routes reached through the writeTo helper (remove/clearValues/clearBytes), not just literal object-store calls — capability flag is asserted separately', async () => {
    const store = await freshDb()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    // set()/setBytes(): the writeWithConflict put itself.
    await store.set('k', 'v1')
    await store.setBytes('b', encoder.encode('bytes1'))
    // remove(): reached via `writeTo(kvStoreName, (store) => store.delete(key), ...)` — the exact
    // helper-routed shape a `objectStore(kvStoreName).delete(...)` grep cannot see.
    await store.remove('k')
    // A no-op remove (key already gone) must not publish.
    await store.remove('k')
    await store.set('k2', 'v2')
    // clearValues()/clearBytes(): also reached via the same `writeTo` helper.
    await store.clearValues()
    await store.clearBytes()
    // A no-op clear (store already empty) must not publish.
    await store.clearValues()

    expect(changes.map((c) => `${c.channel}:${c.kind}`)).toEqual([
      'value:put',
      'bytes:put',
      'value:remove',
      'value:put',
      'value:clear',
      'bytes:clear'
    ])
    await store.dispose()
  })

  it("a `replace`-policy write evicts the other channel and publishes that channel's own remove, not just the attempted channel's put", async () => {
    const store = await freshDb()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.set('shared', 'v1')
    // Replacing with a bytes write must evict the existing value entry and publish both: the
    // bytes put and the value eviction remove.
    await store.setBytes('shared', encoder.encode('v2'), { conflictPolicy: 'replace' })
    expect(changes.map((c) => `${c.channel}:${c.kind}`)).toEqual([
      'value:put',
      'bytes:put',
      'value:remove'
    ])
    await expect(store.get('shared')).resolves.toBeNull()
    const got = await store.getBytes('shared')
    expect(Array.from(got ?? [])).toEqual(Array.from(encoder.encode('v2')))
    await store.dispose()
  })

  it('transaction replacement publishes each actually changed channel once after commit', async () => {
    const store = await freshDb()
    await store.set('shared', 'v1')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.transaction(async (tx) => {
      await tx.putRecord({ id: 'shared' }, 'shared', { conflictPolicy: 'replace' })
    })

    expect(changes.map(({ channel, kind, keys }) => ({ channel, kind, keys }))).toEqual([
      { channel: 'value', kind: 'batch', keys: ['shared'] },
      { channel: 'record', kind: 'batch', keys: ['shared'] }
    ])
    await expect(store.get('shared')).resolves.toBeNull()
    await store.dispose()
  })

  it('injected factories keep public changeFeed false while same-page handles retain private coordination', async () => {
    const factory = freshFactory()
    const dbName = `shared-${Math.random().toString(36).slice(2)}`
    const writer = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const reader = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    expect(writer.capabilities.changeFeed).toBe(false)
    expect(reader.capabilities.changeFeed).toBe(false)
    expect(() => reader.watch('k')).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    expect(isChangeFeedStore(writer)).toBe(false)
    expect(isChangeFeedStore(reader)).toBe(false)
    const writerEvents: IStorageChange[] = []
    const readerEvents: IStorageChange[] = []
    writer.subscribeChanges((c) => writerEvents.push(c))
    reader.subscribeChanges((c) => readerEvents.push(c))

    await writer.set('k', 'from-writer')

    expect(writerEvents.map((c) => `${c.channel}:${c.kind}`)).toEqual(['value:put'])
    // The private same-page hint is delivered, but the public capability remains false because an
    // injected factory cannot prove this realm's BroadcastChannel data universe.
    expect(readerEvents.map((c) => `${c.channel}:${c.kind}`)).toEqual(['value:put'])
    await expect(reader.get('k')).resolves.toBe('from-writer')
    await writer.dispose()
    await reader.dispose()
  })

  it('admits realm-default BroadcastChannel coordination with metadata-only validation and refcount cleanup', async () => {
    const factory = freshFactory()
    const dbName = `r09-wire-${Math.random().toString(36).slice(2)}`
    const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    const broadcastDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel')
    let writer: Awaited<ReturnType<typeof createIndexedDbTestStore>> | undefined
    let reader: Awaited<ReturnType<typeof createIndexedDbTestStore>> | undefined
    let rogue: TestBroadcastChannel | undefined
    try {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        get: () => factory
      })
      Object.defineProperty(globalThis, 'BroadcastChannel', {
        configurable: true,
        value: TestBroadcastChannel
      })
      TestBroadcastChannel.instances.length = 0
      TestBroadcastChannel.closedCount = 0
      writer = await createIndexedDbTestStore({ dbName, keyRange: IDBKeyRange })
      reader = await createIndexedDbTestStore({ dbName, keyRange: IDBKeyRange })
      expect(writer.capabilities.changeFeed).toBe(true)
      expect(reader.capabilities.changeFeed).toBe(true)
      expect(isChangeFeedStore(writer)).toBe(true)
      expect(TestBroadcastChannel.instances).toHaveLength(1)
      const readerEvents: IStorageChange[] = []
      reader.subscribeChanges((change) => readerEvents.push(change))
      const localWatch = reader.watch('wire-key')
      const localNext = localWatch.next()
      const remoteWatch = reader.watch('remote-key')
      const remoteNext = remoteWatch.next()

      await writer.set('wire-key', 'value')
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(readerEvents).toHaveLength(1)
      expect(readerEvents[0]).toMatchObject({ channel: 'value', kind: 'put', keys: ['wire-key'] })
      expect((await localNext).value).toBe(readerEvents[0])
      expect(readerEvents[0]!.orgId).toMatch(/^[0-9a-f-]{36}$/)
      const disposed = localWatch.dispose()
      expect(localWatch.dispose()).toBe(disposed)
      await disposed
      await expect(localWatch.next()).resolves.toMatchObject({ done: true })

      rogue = new TestBroadcastChannel(TestBroadcastChannel.instances[0]!.name)
      rogue.postMessage({
        version: 1,
        origin: 'remote-origin',
        sequence: 1,
        channel: 'value',
        kind: 'put',
        keys: [encodeFlatStorageKey('remote-key')]
      })
      rogue.postMessage({
        version: 1,
        origin: 'remote-origin',
        sequence: 3,
        channel: 'value',
        kind: 'put',
        keys: [encodeFlatStorageKey('remote-newer-key')]
      })
      rogue.postMessage({
        version: 1,
        origin: 'remote-origin',
        sequence: 2,
        channel: 'value',
        kind: 'put',
        keys: [encodeFlatStorageKey('remote-stale-key')]
      })
      rogue.postMessage({
        version: 2,
        origin: 'spoofed-version',
        sequence: 1,
        channel: 'value',
        kind: 'put'
      })
      rogue.postMessage({
        version: 1,
        origin: 'oversized',
        sequence: 2,
        channel: 'value',
        kind: 'put',
        keys: [encodeFlatStorageKey('x'.repeat(20_000))]
      })
      rogue.postMessage({
        version: 1,
        origin: 'unknown-field',
        sequence: 3,
        channel: 'value',
        kind: 'put',
        unexpected: true
      })
      rogue.postMessage({
        version: 1,
        origin: 'plain-hint',
        sequence: 10,
        channel: 'value',
        kind: 'put',
        keys: [encodeFlatStorageKey('stateful-key')]
      })
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(readerEvents).toHaveLength(4)
      expect(readerEvents[1]).toMatchObject({ keys: ['remote-key'] })
      expect(readerEvents[2]).toMatchObject({ keys: ['remote-newer-key'], sequence: 3 })
      expect(readerEvents[3]).toMatchObject({ keys: ['stateful-key'], sequence: 10 })
      const remote = (await remoteNext).value
      expect(remote).toMatchObject({ keys: ['remote-key'], orgId: readerEvents[0]!.orgId })
      await remoteWatch.dispose()

      await writer.dispose()
      expect(TestBroadcastChannel.closedCount).toBe(0)
      rogue.postMessage({
        version: 1,
        origin: 'remote-origin',
        sequence: 4,
        channel: 'value',
        kind: 'put',
        keys: [encodeFlatStorageKey('after-writer-dispose')]
      })
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(readerEvents).toHaveLength(5)
      expect(readerEvents[4]).toMatchObject({ keys: ['after-writer-dispose'], sequence: 4 })
      await reader.dispose()
      expect(TestBroadcastChannel.closedCount).toBe(1)
      rogue.close()
    } finally {
      if (writer !== undefined) await writer.dispose()
      if (reader !== undefined) await reader.dispose()
      rogue?.close()
      if (indexedDbDescriptor === undefined) Reflect.deleteProperty(globalThis, 'indexedDB')
      else Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor)
      if (broadcastDescriptor === undefined) Reflect.deleteProperty(globalThis, 'BroadcastChannel')
      else Object.defineProperty(globalThis, 'BroadcastChannel', broadcastDescriptor)
    }
  })
})
