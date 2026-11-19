import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { call, catalogCommand, removeData, startCatalog, token, type ICatalog } from './support.ts'

/** Allowed origin. */
const ORIGIN = 'http://127.0.0.1:5555'
/** Running catalog. */
let catalog: ICatalog

beforeAll(async () => {
  catalog = await startCatalog(['--allow-origin', ORIGIN])
})

afterAll(async () => {
  await catalog.stop()
  removeData(catalog)
})

describe('tokens, scopes, limits and CORS', () => {
  it('authorizes by project, environment and scope, limits writes and stores only hashes', async () => {
    /** Dev write and prod read tokens. */
    const write = token(catalog.data, 'dev', 'write')
    const read = token(catalog.data, 'prod', 'read', 'bob')
    /** Publish attempts. */
    const publishAs = (value?: string) =>
      call(catalog.url, '/p/orders/env/dev/publish', {
        method: 'POST',
        body: '{}',
        ...(value === undefined ? {} : { token: value })
      })
    expect((await publishAs()).status).toBe(401)
    expect((await publishAs('wrong')).status).toBe(401)
    expect((await publishAs(read)).status).toBe(403)
    expect((await call(catalog.url, '/p/orders/drafts', { token: read })).status).toBe(403)
    expect((await call(catalog.url, '/p/orders/audit', { token: read })).status).toBe(403)
    /** Statuses of 61 writes. */
    const statuses: number[] = []
    for (let index = 0; index < 61; index += 1) statuses.push((await publishAs(write)).status)
    expect(statuses.slice(0, 60).every((status) => status !== 429)).toBe(true)
    expect(statuses[60]).toBe(429)
    /** Database bytes. */
    const files = readdirSync(catalog.data).map((name) =>
      readFileSync(join(catalog.data, name)).toString('latin1')
    )
    expect(files.some((text) => text.includes(write) || text.includes(read))).toBe(false)
  })

  it('answers CORS only for allowed origins and honours public reads', async () => {
    /** Read token for dev. */
    const read = token(catalog.data, 'dev', 'read')
    /** Preflights. */
    const allowed = await fetch(`${catalog.url}/p/orders/env/dev/snapshot`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN }
    })
    const other = await fetch(`${catalog.url}/p/orders/env/dev/snapshot`, {
      method: 'OPTIONS',
      headers: { origin: 'http://evil.test' }
    })
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('access-control-allow-headers')).toContain('Authorization')
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect([...other.headers.keys()].some((name) => name.startsWith('access-control-'))).toBe(false)
    /** Authorized cross-origin read. */
    const get = await call(catalog.url, '/p/orders/env/dev/snapshot', {
      token: read,
      headers: { origin: ORIGIN }
    })
    expect(get.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(get.headers.get('access-control-expose-headers')).toBe('ETag')
    catalogCommand(catalog.data, [
      'env',
      'set',
      '--project',
      'orders',
      '--env',
      'prod',
      '--public-read',
      'true'
    ])
    /** Anonymous reads. */
    const prod = await call(catalog.url, '/p/orders/env/prod/snapshot')
    expect(prod.status).toBe(404)
    expect(((await prod.json()) as { error: { code: string } }).error.code).toBe('ENV_UNPUBLISHED')
    expect((await call(catalog.url, '/p/orders/env/dev/snapshot')).status).toBe(401)
  })
})
