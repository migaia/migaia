import { describe, expect, it } from 'vitest'
import {
  createPartHost,
  defineEnhancer,
  definePart,
  definePartPlugin,
  PartHostErrorCode
} from '../src/index.ts'
import { RenderLog, rendererPlugin } from './fixtures.ts'

/** Enhancer calls per address. */
const calls = new Map<string, number>()

/** Plugin with a page, items counted by an enhancer, and a dialog with an open state. */
const plugin = definePartPlugin({
  name: 'ui',
  parts: [
    definePart({ id: 'page@1' }),
    definePart({ id: 'item@1' }),
    definePart({ id: 'dialog@1', behavior: { states: { names: ['open'], openState: 'open' } } })
  ],
  enhancers: [
    defineEnhancer({
      id: 'count@1',
      targets: ['item'],
      transform: (config, context) => {
        calls.set(context.address, (calls.get(context.address) ?? 0) + 1)
        return { ...config }
      }
    })
  ]
})

/** Blueprint with items x and y, x controlling y. */
const blueprint = {
  id: 'bp',
  version: 1,
  root: {
    tag: 'page@1',
    id: 'p',
    children: [
      { tag: 'item@1', id: 'x', facets: { aria: { controls: 'p/y' }, props: { label: 'a' } } },
      { tag: 'item@1', id: 'y' },
      { tag: 'dialog@1', id: 'd1', facets: { props: { open: true } } },
      { tag: 'dialog@1', id: 'd2', facets: { props: { open: { $state: 'page.dialog' } } } }
    ]
  }
}

describe('blueprint load, patch and mount', () => {
  it('reports missing definitions as issues and patches incrementally', async () => {
    calls.clear()
    const log = new RenderLog()
    const host = await createPartHost({ plugins: [plugin] })
    const missing = await host.blueprint.load({ id: 'm', version: 1, root: { tag: 'missing@1' } })
    expect(missing.tree).toBeUndefined()
    expect(missing.issues.map((issue) => issue.rule)).toEqual(['catalog.id-exists'])

    const loaded = await host.blueprint.load(blueprint)
    expect(loaded.tree).toBeDefined()
    expect(() => host.mount({}, 'bp')).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.rendererMissing })
    )
    await host.use(rendererPlugin('r', log.factory()))
    const first = host.mount({}, 'bp')
    host.mount({}, 'bp')

    const d1 = loaded.tree?.root.children[2]
    expect(d1?.openStatePath).toBe('part.p/d1.open')
    expect(host.state.read('part.p/d1.open')).toBe(true)
    expect(loaded.tree?.root.children[3]?.openStatePath).toBe('page.dialog')

    calls.clear()
    await host.blueprint.patch('bp', [
      { op: 'replace', path: '/root/children/0/facets/props/label', value: 'b' }
    ])
    expect(calls.get('p/x')).toBe(1)
    expect(calls.get('p/y')).toBeUndefined()
    expect(log.updates[0]?.[0]?.changed.map((node) => node.address)).toEqual(['p/x'])
    expect(log.updates[1]).toHaveLength(1)

    first.unmount()
    first.unmount()
    await host.blueprint.patch('bp', [
      { op: 'replace', path: '/root/children/0/facets/props/label', value: 'c' }
    ])
    expect(log.updates[0]).toHaveLength(1)
    expect(log.updates[1]).toHaveLength(2)

    const removed = await host.blueprint.patch('bp', [{ op: 'remove', path: '/root/children/1' }])
    expect(removed.issues.map((issue) => issue.rule)).toContain('aria.idref-exists')
    await host.dispose()
  })

  it('reports a derive-bound open state', async () => {
    const host = await createPartHost({ plugins: [plugin] })
    const result = await host.blueprint.load({
      id: 'o',
      version: 1,
      root: { tag: 'dialog@1', id: 'd', facets: { props: { open: { $derive: 'x@1' } } } }
    })
    expect(result.issues.map((issue) => issue.rule)).toContain('behavior.open-state-binding')
    await host.dispose()
  })
})
