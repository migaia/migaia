import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { describe, it, expect } from 'vitest'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'
import { blob } from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { archivePlugin } from '../src/index.ts'

/** Native PostgreSQL runs through the sole repository service launcher rather than skipping. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Archive native matrix requires scripts/storage-services.mts run')

for (const backend of ['memory', 'sqlite', 'postgres'] as const)
  describe(`Archive ${backend} hot with native filesystem blobs`, () => {
    it('archives/restores/reopens, isolates organizations and serializes sweep against native head commit', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'archive-native-')),
        pool = new Pool({ connectionString }),
        prefix = 'archive_' + crypto.randomUUID().replaceAll('-', '')
      /** Successful archive calls are observed on the original published hot/cold ports. */
      const ports: { backend: string; operation: string; stream: boolean; key?: unknown }[] = []
      /**
       * Native SQLite statement execution proves hot records/transactions reach the physical
       * engine.
       */
      const statements: string[] = []
      const nativeSqlite =
        backend === 'sqlite' ? nodeSqliteDriver(join(directory, 'hot.sqlite')) : undefined
      const observedSqlite: typeof nativeSqlite = nativeSqlite && {
        ...nativeSqlite,
        exec(text) {
          statements.push(text)
          nativeSqlite.exec(text)
        },
        prepare(text) {
          /** Forward each real invocation; preparation alone is not execution evidence. */
          const statement = nativeSqlite.prepare(text)
          return {
            run(...values) {
              statements.push(text)
              return statement.run(...values)
            },
            get(...values) {
              statements.push(text)
              return statement.get(...values)
            },
            all(...values) {
              statements.push(text)
              return statement.all(...values)
            }
          }
        }
      }
      let hold = false
      const entered = deferred<void>(),
        resume = deferred<void>()
      const observer = definePlugin('native-observer', (core) => ({
        install() {
          core.useAsyncPipeline(async (input, next) => {
            if (hold && input.backendId === 'cold' && input.operation.endsWith('head')) {
              hold = false
              entered.resolve()
              await resume.promise
            }
            await next(input)
            ports.push({
              backend: input.backendId,
              operation: input.operation,
              stream:
                input.operation === 'blob.put' &&
                (input.input as { body: unknown }).body instanceof ReadableStream,
              ...(input.operation === 'putRecord'
                ? { key: (input.input as { key: unknown }).key }
                : {})
            })
          })
          return {}
        }
      }))
      const initial = await createStorageHost({
        plugins: [
          backend === 'memory'
            ? memoryBackendPlugin({ id: 'hot' })
            : backend === 'sqlite'
              ? sqliteBackendPlugin({
                  id: 'hot',
                  driver: observedSqlite!
                })
              : postgresBackendPlugin({ id: 'hot', driver: pgDriver(pool), prefix }),
          objectBackendPlugin({
            id: 'cold',
            driver: fsObjectDriver({ root: join(directory, 'cold') })
          }),
          observer
        ]
      })
      const host = await initial.use(
        archivePlugin({
          id: 'archive',
          hot: 'hot',
          cold: 'cold',
          rules: [{ name: 'all', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]
        })
      )
      await host.detect()
      try {
        await host.backend('hot').putRecord({ old: true, value: 'actual' }, 'event:a')
        ports.length = 0
        statements.length = 0
        hold = true
        const run = host.extensions.archiveRun()
        await entered.promise
        let swept = false
        const sweeping = host.extensions.archiveSweep().then((result) => {
          swept = true
          return result
        })
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(swept).toBe(false)
        resume.resolve()
        expect(await run).toEqual({ archived: 1, skipped: 0, segments: 1 })
        expect((await sweeping).removed).toBe(0)
        expect(ports).toEqual(
          expect.arrayContaining([
            {
              backend: 'hot',
              operation: backend === 'memory' ? 'iterateRecords' : 'iterateRecords.next',
              stream: false
            },
            { backend: 'hot', operation: 'deleteRecord', stream: false },
            { backend: 'cold', operation: 'blob.put', stream: true },
            { backend: 'cold', operation: 'blob.head', stream: false }
          ])
        )
        /** The uploaded native file contains the actual gzip archive stream. */
        const dataFiles = (await readdir(join(directory, 'cold'), { recursive: true })).filter(
          (file) => file.endsWith('.data')
        )
        expect(dataFiles).toHaveLength(1)
        expect([
          ...(await readFile(join(directory, 'cold', dataFiles[0]!))).subarray(0, 2)
        ]).toEqual([31, 139])
        if (backend === 'sqlite') {
          expect(statements).toEqual(
            expect.arrayContaining([
              expect.stringMatching(/SELECT key,value,expires_at FROM "?migaia_records/),
              expect.stringMatching(/DELETE FROM "?migaia_records/),
              expect.stringContaining('BEGIN'),
              expect.stringContaining('COMMIT')
            ])
          )
        }
        ports.length = 0
        expect(await host.extensions.archiveGet('event:a', { restore: true })).toEqual({
          old: true,
          value: 'actual'
        })
        expect(ports).toContainEqual({ backend: 'cold', operation: 'blob.get', stream: false })
        expect(ports).toContainEqual({
          backend: 'hot',
          operation: 'putRecord',
          stream: false,
          key: 'event:a'
        })
        ports.length = 0
        expect((await host.extensions.archiveSweep()).removed).toBe(1)
        expect(ports).toContainEqual({ backend: 'cold', operation: 'blob.remove', stream: false })
        expect(
          (await readdir(join(directory, 'cold'), { recursive: true })).filter((file) =>
            file.endsWith('.data')
          )
        ).toEqual([])
        const org = host.org('11111111-1111-4111-8111-111111111111')
        await org.backend('hot').putRecord({ old: true, value: 'org' }, 'event:a')
        expect((await org.extensions.archiveRun()).archived).toBe(1)
        expect(await org.extensions.archiveGet('event:a')).toEqual({ old: true, value: 'org' })
        expect(await host.extensions.archiveGet('event:a')).toEqual({ old: true, value: 'actual' })
        await host.dropOrg(org.orgId)
        expect(await org.extensions.archiveGet('event:a')).toBeUndefined()
        expect((await host.backend('cold').use(blob).list()).items).toHaveLength(0)
        expect(await host.backend('hot').getRecord('event:a')).toEqual({
          old: true,
          value: 'actual'
        })
      } finally {
        resume.resolve()
        await host.dispose()
        await nativeSqlite?.dispose()
        await pool.end()
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

it('reopens the original SQLite and filesystem owners and sweeps an upload orphan after rollback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'archive-reopen-')),
    path = join(directory, 'hot.sqlite'),
    coldRoot = join(directory, 'cold')
  let fail = true
  const open = async () => {
    const base = await createStorageHost({
      plugins: [
        sqliteBackendPlugin({ id: 'hot', driver: nodeSqliteDriver(path) }),
        objectBackendPlugin({ id: 'cold', driver: fsObjectDriver({ root: coldRoot }) }),
        definePlugin('rollback', (core) => ({
          install() {
            core.useAsyncPipeline(async (input, next) => {
              if (
                fail &&
                input.backendId === 'hot' &&
                input.operation === 'putRecord' &&
                input.scope !== undefined &&
                Array.isArray((input.input as { key?: unknown }).key) &&
                (input.input as { key: unknown[] }).key[2] === 'manifest'
              )
                throw new RangeError('persisted orphan fixture')
              await next(input)
            })
            return {}
          }
        }))
      ]
    })
    const host = await base.use(
      archivePlugin({
        id: 'archive',
        hot: 'hot',
        cold: 'cold',
        rules: [{ name: 'all', prefix: 'event:', olderThanMs: 0, where: () => ({ old: true }) }]
      })
    )
    await host.detect()
    return host
  }
  let host = await open()
  try {
    await host.backend('hot').putRecord({ old: true, value: 'durable' }, 'event:a')
    await expect(host.extensions.archiveRun()).rejects.toMatchObject({
      code: 'ARCHIVE_OPERATION_FAILED'
    })
    expect((await host.backend('cold').use(blob).list()).items).toHaveLength(1)
    await host.dispose()
    fail = false
    host = await open()
    expect(await host.backend('hot').getRecord('event:a')).toEqual({ old: true, value: 'durable' })
    expect(await host.extensions.archiveSweep()).toEqual({ scanned: 1, removed: 1 })
    expect((await host.extensions.archiveRun()).archived).toBe(1)
    expect(await host.extensions.archiveGet('event:a')).toEqual({ old: true, value: 'durable' })
  } finally {
    await host.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
