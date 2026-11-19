import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildModule,
  call,
  ordersPage,
  publish,
  removeData,
  snapshotBytes,
  startCatalog,
  token,
  upload,
  type ICatalog
} from './support.ts'

/** Running catalog. */
let catalog: ICatalog

beforeAll(async () => {
  catalog = await startCatalog()
})

afterAll(async () => {
  await catalog.stop()
  removeData(catalog)
})

describe('environments, promotion and rollback', () => {
  it('moves each pointer independently and records history with the token actor', async () => {
    /** Token for every environment. */
    const write = token(catalog.data, 'dev,staging,prod', 'write', 'alice')
    /** Built module. */
    const notify = buildModule('effects/notify.ts')
    /** Two versions. */
    const v1 = await upload(
      catalog.url,
      write,
      snapshotBytes('v1', [ordersPage('Create order')], [notify]),
      [notify]
    )
    const v2 = await upload(
      catalog.url,
      write,
      snapshotBytes('v2', [ordersPage('New order')], [notify]),
      [notify]
    )
    await publish(catalog.url, write, 'dev', v1)
    await publish(catalog.url, write, 'dev', v2)
    await call(catalog.url, '/p/orders/env/staging/promote', {
      method: 'POST',
      token: write,
      body: JSON.stringify({ from: 'dev' })
    })
    await call(catalog.url, '/p/orders/env/dev/rollback', {
      method: 'POST',
      token: write,
      body: JSON.stringify({ snapshot: v1 })
    })
    /** Unknown rollback. */
    const unknown = await call(catalog.url, '/p/orders/env/dev/rollback', {
      method: 'POST',
      token: write,
      body: JSON.stringify({ snapshot: 'sha256-none' })
    })
    expect(unknown.status).toBe(404)
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe(
      'SNAPSHOT_UNKNOWN'
    )
    /** Pointer of an environment. */
    const etagOf = async (env: string) =>
      (await call(catalog.url, `/p/orders/env/${env}/snapshot`, { token: write })).headers.get(
        'etag'
      )
    expect(await etagOf('dev')).toBe(`"${v1}"`)
    expect(await etagOf('staging')).toBe(`"${v2}"`)
    /** Prod response. */
    const prod = await call(catalog.url, '/p/orders/env/prod/snapshot', { token: write })
    expect(((await prod.json()) as { error: { code: string } }).error.code).toBe('ENV_UNPUBLISHED')
    /** Dev history. */
    const history = (await (
      await call(catalog.url, '/p/orders/env/dev/history', { token: write })
    ).json()) as { action: string; actor: string; tag: string }[]
    expect(history.map((entry) => [entry.action, entry.tag, entry.actor])).toEqual([
      ['rollback', 'v1', 'alice'],
      ['publish', 'v2', 'alice'],
      ['publish', 'v1', 'alice']
    ])
  })
})
