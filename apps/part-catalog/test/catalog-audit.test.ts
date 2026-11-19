import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildModule,
  call,
  ordersPage,
  PROJECT,
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
/** Write token. */
let write: string

beforeAll(async () => {
  catalog = await startCatalog(['--project-dir', PROJECT])
  write = token(catalog.data, 'dev', 'write', 'alice')
  /** Built modules. */
  const notify = buildModule('effects/notify.ts')
  await publish(
    catalog.url,
    write,
    'dev',
    await upload(catalog.url, write, snapshotBytes('v1', [ordersPage()], [notify]), [notify])
  )
})

afterAll(async () => {
  await catalog.stop()
  removeData(catalog)
})

describe('catalog query and audit', () => {
  it('filters descriptors with ETag, adds draft exports and audits without values', async () => {
    /** Draft hash. */
    const draft = (await (
      await call(catalog.url, '/p/orders/drafts', { token: write })
    ).json()) as { blueprints: { hash: string }[] }
    /** Label artifact. */
    const patch = [
      { op: 'replace', path: '/root/children/0/facets/props/label', value: 'New order' }
    ]
    /** Label module. */
    const source = buildModule('enhancers/label.ts').source
    await call(catalog.url, '/p/orders/drafts/changesets', {
      method: 'POST',
      token: write,
      body: JSON.stringify({
        project: 'orders',
        provenance: { authorKind: 'human' },
        artifacts: [
          { kind: 'blueprint', id: 'orders-page', base: draft.blueprints[0]?.hash, patch },
          { kind: 'module', name: 'enhancers/label.ts', base: null, source }
        ]
      })
    })
    await call(catalog.url, '/p/orders/drafts/changesets', {
      method: 'POST',
      token: write,
      body: JSON.stringify({
        project: 'orders',
        provenance: { authorKind: 'human' },
        artifacts: [{ kind: 'blueprint', id: 'orders-page', base: 'sha256-stale', patch }]
      })
    })
    /** Id query. */
    const byId = await call(catalog.url, '/p/orders/catalog?ids=button@1', { token: write })
    expect(((await byId.json()) as { id: string }[]).map((entry) => entry.id)).toEqual(['button@1'])
    /** Tag query and its ETag. */
    const byTag = await call(catalog.url, '/p/orders/catalog?tags=button', { token: write })
    expect(((await byTag.json()) as { id: string }[]).map((entry) => entry.id)).toEqual([
      'button@1'
    ])
    expect(
      (
        await call(catalog.url, '/p/orders/catalog?tags=button', {
          token: write,
          headers: { 'if-none-match': byTag.headers.get('etag') as string }
        })
      ).status
    ).toBe(304)
    /** Draft query. */
    const withDraft = (await (
      await call(catalog.url, '/p/orders/catalog?draft=1', { token: write })
    ).json()) as { id: string }[]
    expect(withDraft.map((entry) => entry.id)).toContain('label@1')
    /** Audit response. */
    const response = await call(catalog.url, '/p/orders/audit', { token: write })
    /** Audit text. */
    const text = await response.text()
    /** Audit records. */
    const audit = JSON.parse(text) as {
      action: string
      actor: string
      outcome: string
      targets: { address?: string; facet?: string }[]
    }[]
    expect(audit.map((record) => record.action)).toEqual(
      expect.arrayContaining(['upload', 'publish', 'changeset'])
    )
    expect(audit.every((record) => record.actor === 'alice')).toBe(true)
    /** Changeset records. */
    const changesets = audit.filter((record) => record.action === 'changeset')
    expect(changesets[0]?.outcome).toBe('ok')
    expect(changesets[0]?.targets).toEqual(
      expect.arrayContaining([expect.objectContaining({ address: 'page/create', facet: 'props' })])
    )
    expect(changesets[1]?.outcome).toBe('rejected')
    expect(text).not.toContain(write)
    expect(text).not.toContain('New order')
    expect(text).not.toContain('defineEnhancer')
  })
})
