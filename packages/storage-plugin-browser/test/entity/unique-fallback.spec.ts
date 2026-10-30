import { entityTestFeatures } from '../helpers/entity-features.ts'
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { defineEntityPlugin } from '@migaia/storage-host/entity'
import {
  createLocalTestStore,
  createSessionTestStore,
  createCookieTestStore
} from '../helpers/installed-backends.ts'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.ts'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.ts'

/** Shared domain keeps each assertion about backend-neutral unique ownership. */
type IUser = { id: string; email: string }

/** Every factory uses the real public backend plus existing complete isolated host ports. */
const factories = [
  {
    name: 'local',
    create: () => createLocalTestStore({ storage: fakeWebStorage(), namespace: 'unique' }, true)
  },
  {
    name: 'session',
    create: () => createSessionTestStore({ storage: fakeWebStorage(), namespace: 'unique' }, true)
  },
  {
    name: 'cookie',
    create: () =>
      createCookieTestStore({ document: fakeCookieDocument(), namespace: 'unique' }, true)
  }
]

/** Both independently connected repositories use the same public definition. */
const usersEntityPlugin = defineEntityPlugin<IUser>()('unique-fallback-spec-ts-34', {
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
      const { host: storeHost, store } = await create()
      try {
        /** The definition must remain valid even when evaluating a particular value fails. */
        const repoEntityPlugin = defineEntityPlugin<IUser>()('unique-fallback-spec-ts-55', {
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
        })
        /** Install once on the real fixture host and retain exact extension inference. */
        const repoEntityPluginHost =
          await storeHost.use<readonly [typeof repoEntityPlugin]>(repoEntityPlugin)
        /** Borrow the supplied backend through the installed repository capability factories. */
        const repo = repoEntityPluginHost.extensions[repoEntityPlugin.id](store)
        await expect(repo.put({ id: 'row', email: 'same' })).rejects.toMatchObject({
          source: 'storage.host',
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
    let repo!: import('@migaia/storage-host/entity').IRepository<IUser>
    /** A complete isolated host port gives the public backend its normal sync and async surfaces. */
    const { host: storeHost, store } = await createLocalTestStore(
      {
        namespace: 'reentrant-codec',
        storage: fakeWebStorage()
      },
      true
    )
    try {
      /** Explicit native declaration owns this scenario's optional repository capabilities. */
      const entity1EntityPlugin = defineEntityPlugin<IUser>()('unique-fallback-spec-ts-94', {
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
      })
      /** Install once on the real fixture host and retain exact extension inference. */
      const entity1EntityPluginHost = await storeHost.use(entity1EntityPlugin)
      repo = entity1EntityPluginHost.extensions[entity1EntityPlugin.id](store)
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
      const { host: storeHost, store } = await create()
      try {
        /** Distinct repository instances cannot maintain separate uniqueness authorities. */
        const usersEntityPluginHost =
          await storeHost.use<readonly [typeof usersEntityPlugin]>(usersEntityPlugin)
        /** Borrow the supplied backend through the installed repository capability factories. */
        const first = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
        /** Reconnect through the actual public definition rather than sharing private state. */
        const second = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
        await first.put({ id: 'a', email: 'same' })
        await expect(second.put({ id: 'b', email: 'same' })).rejects.toMatchObject({
          source: 'storage.host',
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
      const { host: firstStoreHost, store: firstStore } = await createLocalTestStore(
        { storage, namespace: 'parallel-unique' },
        true
      )
      /** Uses the same public namespace, with a separate controller and repository. */
      const { host: secondStoreHost, store: secondStore } = await createLocalTestStore(
        { storage, namespace: 'parallel-unique' },
        true
      )
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
      const definitionEntityPlugin = defineEntityPlugin<IUser>()('unique-fallback-spec-ts-176', {
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
        /** Install once on the real fixture host and retain exact extension inference. */
        const definitionEntityPluginHost = await firstStoreHost.use(definitionEntityPlugin)
        await definitionEntityPluginHost.extensions[definitionEntityPlugin.id](firstStore).put({
          id: 'seed',
          email: 'other'
        })
        gate = true
        /** Both new values collide, while their snapshots initially contain only the seed. */
        const definitionEntityPluginHost2 = await secondStoreHost.use(definitionEntityPlugin)
        const writing = Promise.allSettled([
          definitionEntityPluginHost.extensions[definitionEntityPlugin.id](firstStore).put({
            id: 'a',
            email: 'same'
          }),
          definitionEntityPluginHost2.extensions[definitionEntityPlugin.id](secondStore).put({
            id: 'b',
            email: 'same'
          })
        ])
        await Promise.race([both, writing.then(() => undefined)])
        expect(reads).toBe(2)
        gate = false
        release()
        /** The losing snapshot cannot overwrite or bypass the first accepted commit. */
        const results = await writing
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
        expect(results.find((result) => result.status === 'rejected')).toMatchObject({
          reason: { source: 'storage.contract', code: 'WRITE_CONFLICT' }
        })
        expect(
          await definitionEntityPluginHost.extensions[definitionEntityPlugin.id](firstStore)
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
