import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { it, expect, onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { vector, records } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { pgvectorFeature } from '../src/features/pgvector.js'
import { pgCopyFeature } from '../src/features/copy.js'
/** Actual organization projection must retain the original selected provider authority. */
it('routes the same text, record and selected vector identities to their immutable organization', async () => {
  const connectionString = process.env.MIGAIA_PG_URL
  if (!connectionString)
    throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
  const pool = new Pool({ connectionString })
  const defaultOrgId = randomUUID()
  const host = await createStorageHost({
    org: defaultOrgId,
    plugins: [
      postgresBackendPlugin(
        { driver: pgDriver(pool), prefix: 'pg_org_' + randomUUID().slice(0, 8) },
        { vector: pgvectorFeature(), copy: pgCopyFeature() }
      )
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.end()
  })
  const base = host.backend('postgres')
  const org = host.org(randomUUID()).backend('postgres')
  const defaultView = host.org(defaultOrgId).backend('postgres')
  for (const view of [org, defaultView]) {
    expect(() => view.sql`SELECT 1`.get()).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    await expect(
      view.api.copy.from({ table: ['never_opened'], columns: ['x'] }, async function* () {
        throw new Error('source must not run')
      })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    await expect(
      view.transaction((scope) =>
        scope.api.copy.from({ table: ['never_opened'], columns: ['x'] }, async function* () {
          throw new Error('source must not run')
        })
      )
    ).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
      cause: expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    })
  }
  await base.set('same', 'base')
  await org.set('same', 'org')
  expect(await base.get('same')).toBe('base')
  expect(await org.get('same')).toBe('org')
  await base.putRecord({ tenant: 'base' }, 'record')
  await org.putRecord({ tenant: 'org' }, 'record')
  expect(await org.use(records).query().all()).toEqual([{ tenant: 'org' }])
  expect(org.has(vector)).toBe(true)
  await base
    .use(vector)
    .collection('shared', { dimensions: 1, metric: 'dot' })
    .upsert([{ id: 'same', vector: [1], payload: { tenant: 'base' } }])
  await org
    .use(vector)
    .collection('shared')
    .upsert([{ id: 'same', vector: [2], payload: { tenant: 'org' } }])
  expect((await base.use(vector).collection('shared').near([1]).topK(1).all())[0]?.payload).toEqual(
    { tenant: 'base' }
  )
  expect((await org.use(vector).collection('shared').near([1]).topK(1).all())[0]?.payload).toEqual({
    tenant: 'org'
  })
})
