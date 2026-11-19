import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** Running catalog with the fixture project for builds. */
let catalog: ICatalog
/** Write token. */
let write: string

/** Draft view shape used here. */
type IDraft = {
  base: { tag: string }
  blueprints: {
    id: string
    hash: string
    document: { root: { children: { facets?: { props?: { label?: string } } }[] } }
  }[]
  modules: { name: string; hash: string; source?: string; built: { url: string } }[]
}

/** Current draft. */
async function draft(): Promise<IDraft> {
  return (await (await call(catalog.url, '/p/orders/drafts', { token: write })).json()) as IDraft
}

/** Posts a changeset. */
async function submit(artifacts: unknown[]): Promise<{
  ok: boolean
  artifacts: { key: string; status: string; issues: { rule: string }[] }[]
}> {
  return (await (
    await call(catalog.url, '/p/orders/drafts/changesets', {
      method: 'POST',
      token: write,
      body: JSON.stringify({ project: 'orders', provenance: { authorKind: 'human' }, artifacts })
    })
  ).json()) as never
}

/** Label patch of the create button. */
const label = (value: string) => [
  { op: 'replace', path: '/root/children/0/facets/props/label', value }
]

beforeAll(async () => {
  catalog = await startCatalog(['--project-dir', PROJECT])
  write = token(catalog.data, 'dev', 'write')
  /** Built module. */
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

describe('drafts and changesets', () => {
  it('applies atomic changesets, rejects bad modules, names and ops, and cleans up', async () => {
    /** Seeded draft. */
    const seeded = await draft()
    expect(seeded.modules[0]?.source).toContain('defineEffect')
    /** Hashes of the seeded items. */
    const bpHash = seeded.blueprints[0]?.hash as string
    const moduleHash = seeded.modules[0]?.hash as string
    /** Edited module source. */
    const source = String(seeded.modules[0]?.source).replace("'created'", "'saved'")
    /** (a) label patch plus module edit. */
    const a = await submit([
      { kind: 'blueprint', id: 'orders-page', base: bpHash, patch: label('New order') },
      { kind: 'module', name: 'effects/notify.ts', base: moduleHash, source }
    ])
    expect(a.artifacts.map((entry) => entry.status)).toEqual(['accepted', 'accepted'])
    /** Draft after (a). */
    const afterA = await draft()
    expect(afterA.blueprints[0]?.document.root.children[0]?.facets?.props?.label).toBe('New order')
    expect(afterA.modules[0]?.built.url).toMatch(/^drafts\/m\//)
    expect(
      (await call(catalog.url, `/p/orders/${afterA.modules[0]?.built.url}`, { token: write }))
        .status
    ).toBe(200)
    /** (b) stale base. */
    const b = await submit([
      { kind: 'blueprint', id: 'orders-page', base: bpHash, patch: label('Stale') },
      { kind: 'module', name: 'effects/extra.ts', base: null, source }
    ])
    expect(b.artifacts.map((entry) => entry.status)).toEqual(['conflict', 'skipped'])
    /** Current hash. */
    const hash = afterA.blueprints[0]?.hash as string
    /** (c) module with top-level let. */
    const c = await submit([
      { kind: 'blueprint', id: 'orders-page', base: hash, patch: label('C') },
      {
        kind: 'module',
        name: 'effects/bad.ts',
        base: null,
        source: readFileSync(join(PROJECT, 'remote', 'bad-state.ts'), 'utf8')
      }
    ])
    expect(c.artifacts.map((entry) => entry.status)).toEqual(['skipped', 'rejected'])
    expect(c.artifacts[1]?.issues.map((issue) => issue.rule)).toContain('remote.module-state')
    /** (d) traversal name. */
    const d = await submit([
      { kind: 'blueprint', id: 'orders-page', base: hash, patch: label('D') },
      { kind: 'module', name: '../../src/evil.ts', base: null, source }
    ])
    expect(d.artifacts[1]?.issues.map((issue) => issue.rule)).toEqual(['changeset.module-name'])
    expect(existsSync(join(PROJECT, '..', 'src', 'evil.ts'))).toBe(false)
    /** (e) unsupported op. */
    const e = await submit([
      {
        kind: 'blueprint',
        id: 'orders-page',
        base: hash,
        patch: [{ op: 'copy', from: '/root', path: '/x' }]
      }
    ])
    expect(e.artifacts[0]?.issues.map((issue) => issue.rule)).toEqual(['changeset.patch-op'])
    expect((await draft()).blueprints[0]?.hash).toBe(hash)
    /** Leftover temporary directories. */
    const temp = join(PROJECT, '.partom-tmp', 'drafts')
    expect(existsSync(temp) ? readdirSync(temp) : []).toEqual([])
  })
})
