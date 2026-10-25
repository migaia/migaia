import { entityTestFeatures } from '../helpers/entity-features.js'
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { IKeyValueStore } from '@migaia/storage-contract'
import { defineEntity } from '@migaia/storage-host/entity'
import {
  createLocalTestStore,
  createSessionTestStore,
  createCookieTestStore
} from '../helpers/installed-backends.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'

/** Shared domain keeps each assertion about backend-neutral unique ownership. */
type IUser = { id: string; email: string }

/** Every factory uses the real public backend plus existing complete isolated host ports. */
const factories: ReadonlyArray<{ name: string; create: () => Promise<IKeyValueStore> }> = [
  {
    name: 'local',
    create: () => createLocalTestStore({ storage: fakeWebStorage(), namespace: 'unique' })
  },
  {
    name: 'session',
    create: () => createSessionTestStore({ storage: fakeWebStorage(), namespace: 'unique' })
  },
  {
    name: 'cookie',
    create: () => createCookieTestStore({ document: fakeCookieDocument(), namespace: 'unique' })
  }
]

/** Both independently connected repositories use the same public definition. */
const users = defineEntity<IUser>()({
  features: entityTestFeatures,
  name: 'unique-users',
  key: 'id',
  indexes: { byEmail: { path: 'email', unique: true } },
  onDiagnostic: () => {}
})

describe('authoritative fallback unique writes', () => {
  it.each(factories.slice(0, 1))(
    '$name classifies a failing unique projection without losing its original error',
    async ({ create }) => {
      /**
       * Projection callbacks are newly exercised by fallback writes and share the extension
       * boundary.
       */
      const original = new Error('unique selector failed')
      /** Use the real backend with an ordinary public throwing selector. */
      const store = await create()
      try {
        /** The definition must remain valid even when evaluating a particular value fails. */
        const repo = defineEntity<IUser>()({
          features: entityTestFeatures,
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
          source: '@migaia/storage-host',
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
    const store = await createLocalTestStore({
      namespace: 'reentrant-codec',
      storage: fakeWebStorage()
    })
    try {
      repo = defineEntity<IUser>()({
        features: entityTestFeatures,
        name: 'nested-users',
        key: 'id',
        onDiagnostic: () => {},
        indexes: { byEmail: { path: 'email', unique: true } },
        codec: {
          name: 'nested-json',
          output: 'text',
          async encode(value) {
            /** Only the outer application's encode path performs the nested request. */
            const envelope = value as { state?: IUser }
            if (!entered && envelope.state?.id === 'outer') {
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
      const store = await create()
      try {
        /** Distinct repository instances cannot maintain separate uniqueness authorities. */
        const first = users.connect(store)
        /** Reconnect through the actual public definition rather than sharing private state. */
        const second = users.connect(store)
        await first.put({ id: 'a', email: 'same' })
        await expect(second.put({ id: 'b', email: 'same' })).rejects.toMatchObject({
          source: '@migaia/storage-host',
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

  it.each([false, true])(
    'serializes two KV instances after concurrent preparation (local queue: %s)',
    async (localQueue) => {
      if (localQueue) vi.stubGlobal('navigator', undefined)
      /** Independent backend objects share only their real underlying Storage port. */
      const storage = fakeWebStorage()
      /** One instance per writer prevents per-repository or per-store caches from passing. */
      const firstStore = await createLocalTestStore({ storage, namespace: 'parallel-unique' })
      /** Uses the same public namespace, with a separate controller and repository. */
      const secondStore = await createLocalTestStore({ storage, namespace: 'parallel-unique' })
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
        features: entityTestFeatures,
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
          reason: { source: '@migaia/storage-contract', code: 'WRITE_CONFLICT' }
        })
        expect(
          await definition
            .connect(firstStore)
            .query()
            .index('byEmail', { lower: 'same', upper: 'same' })
            .all()
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
})
