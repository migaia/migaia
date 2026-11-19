import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildModule,
  call,
  ordersPage,
  publish,
  removeData,
  sha256,
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

/** Error code of a response. */
async function codeOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code
}

describe('snapshot upload and delivery', () => {
  it('checks hashes, modules, secrets and definitions, then serves the exact bytes', async () => {
    /** Write token. */
    const write = token(catalog.data, 'dev', 'write')
    /** Built module. */
    const notify = buildModule('effects/notify.ts')
    /** Valid snapshot. */
    const v1 = snapshotBytes('v1', [ordersPage()], [notify])
    /** Wrong path hash. */
    const wrongHash = await call(
      catalog.url,
      `/p/orders/snapshots/${sha256(new Uint8Array([1]))}`,
      { method: 'PUT', body: v1, token: write }
    )
    expect(wrongHash.status).toBe(422)
    expect(await codeOf(wrongHash)).toBe('SNAPSHOT_MISMATCH')
    /** Module not uploaded yet. */
    const missing = await call(catalog.url, `/p/orders/snapshots/${sha256(v1)}`, {
      method: 'PUT',
      body: v1,
      token: write
    })
    expect(await codeOf(missing)).toBe('SNAPSHOT_MISMATCH')
    await call(catalog.url, `/p/orders/${notify.ref.url}`, {
      method: 'PUT',
      body: notify.bytes,
      token: write
    })
    /** Snapshot with a secret. */
    const secret = snapshotBytes(
      'vs',
      [ordersPage('Create', { apiKey: 'sk-abcdefghijklmnopqrstuv' })],
      [notify]
    )
    /** Secret upload response. */
    const secretResponse = await call(catalog.url, `/p/orders/snapshots/${sha256(secret)}`, {
      method: 'PUT',
      body: secret,
      token: write
    })
    expect(secretResponse.status).toBe(422)
    expect(JSON.stringify(await secretResponse.json())).toContain('security.secret')
    /** Snapshot referencing an unknown definition. */
    const unknown = snapshotBytes(
      'vu',
      [ordersPage()],
      [notify],
      ['page@1', 'button@1', 'notify@1', 'ghost@1']
    )
    /** Unknown-definition response. */
    const unknownResponse = await call(catalog.url, `/p/orders/snapshots/${sha256(unknown)}`, {
      method: 'PUT',
      body: unknown,
      token: write
    })
    expect(unknownResponse.status).toBe(422)
    expect(JSON.stringify(await unknownResponse.json())).toContain('ghost@1')
    /** Hash of v1. */
    const hash = await upload(catalog.url, write, v1, [notify])
    expect(
      (
        await call(catalog.url, `/p/orders/snapshots/${hash}`, {
          method: 'PUT',
          body: v1,
          token: write
        })
      ).status
    ).toBe(200)
    /** Bad source uploads. */
    const foreign = await call(catalog.url, `/p/orders/snapshots/${hash}/sources`, {
      method: 'PUT',
      token: write,
      body: JSON.stringify({ modules: [{ name: 'other.ts', source: '' }] })
    })
    const traversal = await call(catalog.url, `/p/orders/snapshots/${hash}/sources`, {
      method: 'PUT',
      token: write,
      body: JSON.stringify({ modules: [{ name: '../x.ts', source: '' }] })
    })
    expect([foreign.status, traversal.status]).toEqual([422, 422])
    expect((await publish(catalog.url, write, 'dev', hash)).status).toBe(200)
    /** Delivered snapshot. */
    const delivered = await call(catalog.url, '/p/orders/env/dev/snapshot', { token: write })
    expect(new Uint8Array(await delivered.arrayBuffer())).toEqual(v1)
    expect(delivered.headers.get('etag')).toBe(`"${sha256(v1)}"`)
    expect(
      (
        await call(catalog.url, '/p/orders/env/dev/snapshot', {
          token: write,
          headers: { 'if-none-match': `"${hash}"` }
        })
      ).status
    ).toBe(304)
    /** Public module bytes. */
    const module = new Uint8Array(
      await (await call(catalog.url, `/p/orders/${notify.ref.url}`)).arrayBuffer()
    )
    expect(`sha384-${createHash('sha384').update(module).digest('base64')}`).toBe(
      notify.ref.integrity
    )
  })
})
