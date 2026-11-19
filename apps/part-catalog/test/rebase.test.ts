import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  type ICatalog,
  type IBuiltModule
} from './support.ts'

/** Running catalog per case. */
let catalog: ICatalog
/** Write token. */
let write: string
/** Module of v1. */
let notify: IBuiltModule

/** Draft view used here. */
type IDraft = {
  base: { tag: string }
  conflicts: { address?: string; facet?: string; module?: string }[]
  blueprints: {
    id: string
    hash: string
    document: { root: { children: { id: string; facets?: { props?: { label?: string } } }[] } }
  }[]
  modules: { name: string; hash: string; source?: string }[]
}

/** Current draft. */
async function draft(): Promise<IDraft> {
  return (await (await call(catalog.url, '/p/orders/drafts', { token: write })).json()) as IDraft
}

/** Submits draft artifacts. */
async function submit(artifacts: unknown[]): Promise<void> {
  /** Result. */
  const result = (await (
    await call(catalog.url, '/p/orders/drafts/changesets', {
      method: 'POST',
      token: write,
      body: JSON.stringify({ project: 'orders', provenance: { authorKind: 'human' }, artifacts })
    })
  ).json()) as { ok: boolean }
  expect(result.ok).toBe(true)
}

/** Patch of one button label. */
const label = (index: number, value: string) => [
  { op: 'replace', path: `/root/children/${index}/facets/props/label`, value }
]

/** Publishes v2 built from blueprints and modules. */
async function publishV2(
  blueprints: Record<string, unknown>[],
  modules: IBuiltModule[] = [notify]
): Promise<void> {
  await publish(
    catalog.url,
    write,
    'dev',
    await upload(catalog.url, write, snapshotBytes('v2', blueprints, modules), modules)
  )
}

/** Page with the other button relabelled. */
function withOther(value: string, create = 'Create order'): Record<string, unknown> {
  /** Base page. */
  const page = ordersPage(create) as {
    root: { children: { facets: { props: { label: string } } }[] }
  }
  ;(page.root.children[1] as { facets: { props: { label: string } } }).facets.props.label = value
  return page
}

beforeEach(async () => {
  catalog = await startCatalog()
  write = token(catalog.data, 'dev', 'write')
  notify = buildModule('effects/notify.ts')
  await publish(
    catalog.url,
    write,
    'dev',
    await upload(catalog.url, write, snapshotBytes('v1', [ordersPage()], [notify]), [notify])
  )
})

afterEach(async () => {
  await catalog.stop()
  removeData(catalog)
})

describe('draft rebase on dev pointer changes', () => {
  it('(1) moves an untouched draft to v2', async () => {
    await draft()
    await publishV2([withOther('Changed')])
    /** Draft after the move. */
    const next = await draft()
    expect(next.base.tag).toBe('v2')
    expect(next.blueprints[0]?.document.root.children[1]?.facets?.props?.label).toBe('Changed')
  })

  it('(2) merges edits of different nodes and (4) accepts identical edits', async () => {
    await submit([
      {
        kind: 'blueprint',
        id: 'orders-page',
        base: (await draft()).blueprints[0]?.hash,
        patch: label(0, 'New order')
      }
    ])
    await publishV2([withOther('Changed', 'New order')])
    /** Draft after the move. */
    const next = await draft()
    expect(next.base.tag).toBe('v2')
    expect(next.conflicts).toEqual([])
    expect(
      next.blueprints[0]?.document.root.children.map((child) => child.facets?.props?.label)
    ).toEqual(['New order', 'Changed'])
  })

  it('(3) keeps the draft on v1 with a conflict for different values', async () => {
    await submit([
      {
        kind: 'blueprint',
        id: 'orders-page',
        base: (await draft()).blueprints[0]?.hash,
        patch: label(0, 'New order')
      }
    ])
    await publishV2([ordersPage('Add order')])
    /** Draft after the move. */
    const next = await draft()
    expect(next.base.tag).toBe('v1')
    expect(next.conflicts).toEqual([
      expect.objectContaining({ address: 'page/create', facet: 'props' })
    ])
  })

  it('(5) keeps draft blueprint edits while taking v2 modules and blueprints', async () => {
    await submit([
      {
        kind: 'blueprint',
        id: 'orders-page',
        base: (await draft()).blueprints[0]?.hash,
        patch: label(0, 'New order')
      }
    ])
    /** Changed module and an added blueprint. */
    const label2 = buildModule('enhancers/label.ts')
    await publishV2(
      [ordersPage(), { id: 'reports', version: 1, root: { tag: 'page@1', id: 'reports' } }],
      [notify, label2]
    )
    /** Draft after the move. */
    const next = await draft()
    expect(next.base.tag).toBe('v2')
    expect(next.blueprints.map((entry) => entry.id)).toEqual(['orders-page', 'reports'])
    expect(next.blueprints[0]?.document.root.children[0]?.facets?.props?.label).toBe('New order')
    expect(next.modules.map((module) => module.name)).toEqual([
      'effects/notify.ts',
      'enhancers/label.ts'
    ])
  })

  it('(6) reports a module deleted in the draft and changed in v2', async () => {
    /** Seeded draft. */
    const seeded = await draft()
    await submit([
      { kind: 'remove', target: 'module', key: 'effects/notify.ts', base: seeded.modules[0]?.hash }
    ])
    /** Module with a different source under the same name. */
    const changed = { ...buildModule('enhancers/label.ts'), source: 'changed' }
    changed.ref.name = 'effects/notify.ts'
    await publishV2([ordersPage()], [changed])
    /** Draft after the move. */
    const next = await draft()
    expect(next.base.tag).toBe('v1')
    expect(next.conflicts).toEqual([{ module: 'effects/notify.ts' }])
  })
})
