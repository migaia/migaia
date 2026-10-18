// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { IKeyValueStore } from '@migaia/storage-contract'
import { defineEntity } from '../../src/entity.js'
import { memoryStorageHost } from '../../src/memory.js'
import { localStorageHost } from '../../src/local-storage.js'
import { sessionStorageHost } from '../../src/session-storage.js'
import { cookiesHost } from '../../src/cookies.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'

/** Shared domain keeps each assertion about backend-neutral unique ownership. */
type IUser = { id: string; email: string }

/** Every factory uses the real public backend plus existing complete isolated host ports. */
const factories: ReadonlyArray<{ name: string; create: () => IKeyValueStore }> = [
  { name: 'memory', create: () => memoryStorageHost() },
  {
    name: 'local',
    create: () => localStorageHost({ storage: fakeWebStorage(), namespace: 'unique' })
  },
  {
    name: 'session',
    create: () => sessionStorageHost({ storage: fakeWebStorage(), namespace: 'unique' })
  },
  {
    name: 'cookie',
    create: () => cookiesHost({ document: fakeCookieDocument(), namespace: 'unique' })
  }
]

/** Both independently connected repositories use the same public definition. */
const users = defineEntity<IUser>()({
  name: 'unique-users',
  key: 'id',
  indexes: { byEmail: { path: 'email', unique: true } },
  onDiagnostic: () => {}
})

describe('SW-D06 authoritative fallback unique writes', () => {
  it.each(factories.slice(0, 2))(
    '$name classifies a failing unique projection without losing its original error',
    async ({ create }) => {
      /**
       * Projection callbacks are newly exercised by fallback writes and share the extension
       * boundary.
       */
      const original = new Error('unique selector failed')
      /** Use the real backend with an ordinary public throwing selector. */
      const store = create()
      try {
        /** The definition must remain valid even when evaluating a particular value fails. */
        const repo = defineEntity<IUser>()({
          name: 'failed-projection',
          key: 'id',
          onDiagnostic: () => {},
          indexes: {
            byEmail: {
              unique: true,
              revision: 1,
              select: () => {
                throw original
              }
            }
          }
        }).connect(store)
        await expect(repo.put({ id: 'row', email: 'same' })).rejects.toMatchObject({
          source: '@migaia/storage-web',
          code: 'EXTENSION_FAILED',
          operation: 'entity.index.project',
          cause: original
        })
        expect(await repo.get('row')).toBeUndefined()
      } finally {
        await store.dispose()
      }
    }
  )

  it('runs asynchronous KV codecs before lock admission so a nested write can finish', async () => {
    /** The application codec deliberately performs one supported asynchronous nested write. */
    let entered = false
    /** Capture the public repository after its ordinary construction. */
    let repo!: ReturnType<typeof users.connect>
    /** A complete isolated host port gives the public backend its normal sync and async surfaces. */
    const store = localStorageHost({ namespace: 'reentrant-codec', storage: fakeWebStorage() })
    try {
      repo = defineEntity<IUser>()({
        name: 'nested-users',
        key: 'id',
        onDiagnostic: () => {},
        indexes: { byEmail: { path: 'email', unique: true } },
        codec: {
          name: 'nested-json',
          output: 'text',
          async encode(value) {
            /** Only the outer application's encode path performs the nested request. */
            const envelope = value as { data?: IUser }
            if (!entered && envelope.data?.id === 'outer') {
              entered = true
              await repo.put({ id: 'inner', email: 'other' })
            }
            return JSON.stringify(value)
          },
          async decode(raw) {
            return JSON.parse(raw as string)
          }
        }
      }).connect(store)
      await expect(repo.put({ id: 'outer', email: 'same' })).resolves.toBe('outer')
      expect(await repo.get('inner')).toEqual({ id: 'inner', email: 'other' })
    } finally {
      await store.dispose()
    }
  })

  it.each(factories)(
    '$name rejects another owner, permits self replacement, and frees deleted values',
    async ({ create }) => {
      /** The tested store advertises no native secondary index and must keep its ordinary API. */
      const store = create()
      try {
        /** Distinct repository instances cannot maintain separate uniqueness authorities. */
        const first = users.connect(store)
        /** Reconnect through the actual public definition rather than sharing private state. */
        const second = users.connect(store)
        await first.put({ id: 'a', email: 'same' })
        await expect(second.put({ id: 'b', email: 'same' })).rejects.toMatchObject({
          source: '@migaia/storage-web',
          code: 'INDEX_UNIQUE_CONFLICT'
        })
        await expect(first.put({ id: 'a', email: 'same' })).resolves.toBe('a')
        expect(await second.get('b')).toBeUndefined()
        await first.remove('a')
        await expect(second.put({ id: 'b', email: 'same' })).resolves.toBe('b')
      } finally {
        await store.dispose()
      }
    }
  )

  it('checks the final transaction draft, with rollback on duplicate owners', async () => {
    /** Memory's real transaction performs rollback and revision checks. */
    const store = memoryStorageHost()
    /** A public repository batch may temporarily draft a duplicate before removing its old owner. */
    const repo = users.connect(store)
    try {
      await repo.put({ id: 'a', email: 'same' })
      await expect(
        repo.batch(async (tx) => {
          await tx.put({ id: 'b', email: 'new' })
          await tx.put({ id: 'c', email: 'new' })
        })
      ).rejects.toMatchObject({ code: 'INDEX_UNIQUE_CONFLICT' })
      expect(await repo.get('b')).toBeUndefined()
      expect(await repo.get('c')).toBeUndefined()
      await repo.batch(async (tx) => {
        await tx.put({ id: 'b', email: 'same' })
        await tx.remove('a')
      })
      expect(await repo.findBy('byEmail', 'same')).toEqual({ id: 'b', email: 'same' })
    } finally {
      await store.dispose()
    }
  })

  it('uses the record transaction to reject a concurrent phantom owner', async () => {
    /** Hold two genuine public transactions after their callbacks, before the existing commit. */
    const store = memoryStorageHost()
    /** Preserve the normal implementation and all of its revision/rollback semantics. */
    const transaction = store.transaction
    /** Release both transactions only after both complete their uniqueness read sets. */
    let release!: () => void
    /** Synchronizes the supported public transaction callbacks without private state changes. */
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Counts completed public callbacks, rather than mocking commit results. */
    let callbacks = 0
    store.transaction = (run, ctx) =>
      transaction(async (tx) => {
        /** The callback has drafted its complete candidate write and validation. */
        const result = await run(tx)
        callbacks += 1
        if (callbacks === 2) release()
        await ready
        return result
      }, ctx)
    try {
      /** Two different owners compete through independent public repository instances. */
      const results = await Promise.allSettled([
        users.connect(store).put({ id: 'a', email: 'same' }),
        users.connect(store).put({ id: 'b', email: 'same' })
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { source: '@migaia/storage-web', code: 'TRANSACTION_CONFLICT' }
      })
    } finally {
      release()
      await store.dispose()
    }
  })

  it.each([false, true])(
    'serializes two KV instances after concurrent preparation (local queue: %s)',
    async (localQueue) => {
      if (localQueue) vi.stubGlobal('navigator', undefined)
      /** Independent backend objects share only their real underlying Storage port. */
      const storage = fakeWebStorage()
      /** One instance per writer prevents per-repository or per-store caches from passing. */
      const firstStore = localStorageHost({ storage, namespace: 'parallel-unique' })
      /** Uses the same public namespace, with a separate controller and repository. */
      const secondStore = localStorageHost({ storage, namespace: 'parallel-unique' })
      /** Force both snapshots to exist before either commits. */
      let release!: () => void
      /** Only existing-row validation is delayed; codec and commit paths remain real. */
      const waiting = new Promise<void>((resolve) => {
        release = resolve
      })
      /** Announce the supported schema hook before releasing the two writers. */
      let announce!: () => void
      /** Both writers must finish preparation from the same initial data. */
      const both = new Promise<void>((resolve) => {
        announce = resolve
      })
      /** The seed write is not gated. */
      let gate = false
      /** Counts actual existing-record schema reads. */
      let reads = 0
      /** Shared indexes are declared identically by both public repositories. */
      const definition = defineEntity<IUser>()({
        name: 'parallel-users',
        key: 'id',
        indexes: { byEmail: { path: 'email', unique: true } },
        onDiagnostic: () => {},
        schema: {
          name: 'gated',
          async validate(value) {
            /** The application schema sees the domain through its normal validation boundary. */
            const user = value as IUser
            if (gate && user.id === 'seed') {
              reads += 1
              if (reads === 2) announce()
              await waiting
            }
            return user
          }
        }
      })
      try {
        await definition.connect(firstStore).put({ id: 'seed', email: 'other' })
        gate = true
        /** Both new values collide, while their snapshots initially contain only the seed. */
        const writing = Promise.allSettled([
          definition.connect(firstStore).put({ id: 'a', email: 'same' }),
          definition.connect(secondStore).put({ id: 'b', email: 'same' })
        ])
        await Promise.race([both, writing.then(() => undefined)])
        expect(reads).toBe(2)
        gate = false
        release()
        /** The losing snapshot cannot overwrite or bypass the first accepted commit. */
        const results = await writing
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
        expect(results.find((result) => result.status === 'rejected')).toMatchObject({
          reason: { source: '@migaia/storage-web', code: 'TRANSACTION_CONFLICT' }
        })
        expect(
          await definition
            .connect(firstStore)
            .findManyBy('byEmail', { lower: 'same', upper: 'same' })
        ).toHaveLength(1)
      } finally {
        gate = false
        release()
        await firstStore.dispose()
        await secondStore.dispose()
        vi.unstubAllGlobals()
      }
    }
  )

  it('rejects a migration collision without invoking each written migration twice', async () => {
    /** Normal v1 writes predate the new unique declaration. */
    const store = memoryStorageHost()
    /** Count user migration work independently of schema and projection reads. */
    let migrations = 0
    try {
      /** Seed valid historical values through the public repository. */
      const old = defineEntity<IUser>({ name: 'migration-unique', key: 'id' }).connect(store)
      await old.put({ id: 'a', email: 'same' })
      await old.put({ id: 'b', email: 'SAME' })
      /** The migration would create two owners of one normalized index value. */
      const upgraded = defineEntity<IUser>()({
        name: 'migration-unique',
        key: 'id',
        version: 2,
        migrations: {
          2: async (value) => {
            migrations += 1
            return { ...(value as IUser), email: (value as IUser).email.toLowerCase() }
          }
        },
        indexes: { byEmail: { path: 'email', unique: true } },
        onDiagnostic: () => {}
      }).connect(store)
      await expect(upgraded.migrate({ batchSize: 2 })).rejects.toMatchObject({
        code: 'INDEX_UNIQUE_CONFLICT'
      })
      expect(migrations).toBe(2)
      expect(await old.get('b')).toEqual({ id: 'b', email: 'SAME' })
    } finally {
      await store.dispose()
    }
  })
})
