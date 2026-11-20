import { describe, expect, it } from 'vitest'
import {
  checkDelivery,
  collectStores,
  createRuleEngine,
  descriptorView,
  parseBlueprint,
  type ICatalogView,
  type IPartNode,
  type IPartSnapshot
} from '../src/index.ts'
import { builtinRules } from '../src/doctor/index.ts'
import { createTestCatalog, ruleDescriptors } from './fixtures/catalog.ts'

/** Bound paths of the A6 blueprint, one prop each. */
const paths = [
  'cart.items',
  'wish.items',
  'cart',
  'global.x',
  'page.a',
  'cart..x',
  'cart.a b',
  'Page.x',
  'my-store.x'
] as const

/** Blueprint root binding every path in `paths` under prop `p<i>`. */
const root: IPartNode = {
  tag: 'box@1',
  id: 'root',
  facets: { props: Object.fromEntries(paths.map((path, index) => [`p${index}`, { $state: path }])) }
}

/** Parsed A6 blueprint. */
const blueprint = parseBlueprint({ id: 'bp', version: 1, root })

/**
 * Host-style view: the fixture descriptors plus `stores()` listing the default namespaces and a
 * `cart` store with a JSON Schema, as a part host catalog reports them.
 */
function hostView(): ICatalogView {
  return {
    ...createTestCatalog(ruleDescriptors),
    stores: () => [
      { namespace: 'page' },
      { namespace: 'section' },
      { namespace: 'part' },
      { namespace: 'cart', schema: { type: 'object' } }
    ]
  }
}

/** Props whose binding `flow.bind-path` reported on a view, as bound paths. */
function reportedPaths(view: ICatalogView): string[] {
  /** Engine with the built-in rules over the view. */
  const engine = createRuleEngine({ rules: builtinRules, catalog: view })
  return engine
    .run('authored', blueprint)
    .filter((issue) => issue.rule === 'flow.bind-path')
    .map((issue) => paths[Number(issue.path.slice(1))] as string)
}

/** Snapshot carrying the A6 blueprint and no definitions. */
const snapshot: IPartSnapshot = {
  lock: { format: 1, project: 'p', tag: 'v1', blueprints: [], definitions: [], modules: [] },
  blueprints: [blueprint],
  descriptors: []
}

describe('state namespaces in the contract (A6)', () => {
  it('checks syntax everywhere and registration only on a host view', () => {
    expect(reportedPaths(hostView()).sort()).toEqual(
      ['wish.items', 'cart', 'global.x', 'cart..x', 'cart.a b', 'Page.x', 'my-store.x'].sort()
    )
    /** Syntax-only refusals (BC1: unknown namespaces pass offline). */
    const syntax = ['cart', 'cart..x', 'cart.a b', 'Page.x', 'my-store.x'].sort()
    expect(reportedPaths(descriptorView(ruleDescriptors)).sort()).toEqual(syntax)
    expect(reportedPaths(createTestCatalog(ruleDescriptors)).sort()).toEqual(syntax)
    expect(descriptorView([]).stores).toBeUndefined()
  })

  it('collects bound namespaces once each, in first-binding order', () => {
    expect(collectStores([blueprint])).toEqual(['cart', 'wish', 'global', 'Page', 'my-store'])
  })

  it('refuses delivery for namespaces the manifest does not register', () => {
    expect(
      checkDelivery(snapshot, {
        format: 1,
        build: 'b',
        definitions: [],
        renderers: [],
        stores: ['misc']
      })
    ).toEqual({
      ok: false,
      missing: [],
      missingStores: ['cart', 'wish', 'global', 'Page', 'my-store']
    })
    expect(
      checkDelivery(snapshot, {
        format: 1,
        build: 'b',
        definitions: [],
        renderers: [],
        stores: ['cart', 'wish', 'global', 'Page', 'my-store']
      })
    ).toEqual({ ok: true })
  })
})
