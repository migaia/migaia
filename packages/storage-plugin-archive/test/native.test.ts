import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { describe, it, expect } from 'vitest'
import { createStorageHost, memoryBackendPlugin, definePlugin } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'
import { blob } from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { archivePlugin } from '../src/index.js'

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
                  driver: nodeSqliteDriver(join(directory, 'hot.sqlite'))
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
        expect(await host.extensions.archiveGet('event:a', { restore: true })).toEqual({
          old: true,
          value: 'actual'
        })
        expect((await host.extensions.archiveSweep()).removed).toBe(1)
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
