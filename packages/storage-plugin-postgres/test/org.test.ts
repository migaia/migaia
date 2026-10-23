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

/** Global native collection identity is independent from each host's configured default org. */
it('shares one native collection across hosts with different defaults and preserves it across org drop', async () => {
  const connectionString = process.env.MIGAIA_PG_URL
  if (!connectionString)
    throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
  const pool = new Pool({ connectionString })
  const prefix = 'pg_shared_' + randomUUID().slice(0, 8)
  const makeHost = () =>
    createStorageHost({
      org: randomUUID(),
      plugins: [
        postgresBackendPlugin({ driver: pgDriver(pool), prefix }, { vector: pgvectorFeature() })
      ] as const
    })
  const first = await makeHost()
  const second = await makeHost()
  onTestFinished(async () => {
    await first.dispose()
    await second.dispose()
    await pool.end()
  })
  const orgId = randomUUID()
  const otherOrg = randomUUID()
  const left = first.org(orgId).backend('postgres')
  const right = second.org(orgId).backend('postgres')
  await left
    .use(vector)
    .collection('shared', { dimensions: 1, metric: 'dot' })
    .upsert([{ id: 'same', vector: [2] }])
  await first
    .org(otherOrg)
    .backend('postgres')
    .use(vector)
    .collection('shared')
    .upsert([{ id: 'other', vector: [3] }])
  expect(
    (
      await right
        .use(vector)
        .collection('shared', { dimensions: 1, metric: 'dot' })
        .near([1], { exact: true })
        .topK(1)
        .all()
    )[0]?.id
  ).toBe('same')
  expect(
    (await pool.query('SELECT count(*)::int4 AS count FROM ' + prefix + '_vector_config')).rows[0]
      ?.count
  ).toBe(1)
  await first.dropOrg(orgId)
  expect(
    await right.use(vector).collection('shared').near([1], { exact: true }).topK(1).all()
  ).toEqual([])
  expect(
    (
      await first
        .org(otherOrg)
        .backend('postgres')
        .use(vector)
        .collection('shared')
        .near([1], { exact: true })
        .topK(1)
        .all()
    )[0]?.id
  ).toBe('other')
  expect(
    (await pool.query('SELECT count(*)::int4 AS count FROM ' + prefix + '_vector_config')).rows[0]
      ?.count
  ).toBe(1)
})
