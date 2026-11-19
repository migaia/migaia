import { describe, expect, it } from 'vitest'
import { createPartHost, defineEnhancer, definePart, definePartPlugin } from '../src/index.ts'
import { RenderLog, rendererPlugin } from './fixtures.ts'

/** Enhancer calls per address. */
const calls: string[] = []

/** Plugin with the parts and a counting enhancer on buttons. */
const app = definePartPlugin({
  name: 'app',
  parts: [
    definePart({ id: 'page@1' }),
    definePart({ id: 'button@1' }),
    definePart({ id: 'box@1' })
  ],
  enhancers: [
    defineEnhancer({
      id: 'count@1',
      targets: ['button'],
      transform: (config, context) => {
        calls.push(context.address)
        return config
      }
    })
  ]
})

/** Ten-node page: root plus nine buttons. */
function page(label: string, removeLast = false, rootTag = 'page@1') {
  /** Children ids. */
  const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'].slice(0, removeLast ? 8 : 9)
  return {
    id: 'bp',
    version: 1,
    root: {
      tag: rootTag,
      id: 'root',
      children: ids.map((id) => ({
        tag: 'button@1',
        id,
        facets: { props: { label: id === 'b1' ? label : id } }
      }))
    }
  }
}

describe('host.blueprint.update', () => {
  it('reprocesses only the changed and removed addresses', async () => {
    /** Renderer log. */
    const log = new RenderLog()
    /** Host under test. */
    const host = await createPartHost({ plugins: [app, rendererPlugin('render', log.factory())] })
    await host.blueprint.load(page('Create'))
    host.mount({}, 'bp')
    calls.length = 0
    /** Result of the update. */
    const result = await host.blueprint.update(page('New order', true))
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    /** Last delivered change set. */
    const changes = log.updates[0]?.at(-1)
    expect(changes?.changed.map((node) => node.address)).toEqual(['root', 'root/b1'])
    expect(changes?.removed).toEqual(['root/b9'])
    expect(calls).toEqual(['root/b1'])
  })

  it('reprocesses everything when the root tag changes and keeps the version on error', async () => {
    /** Host under test. */
    const host = await createPartHost({ plugins: [app] })
    await host.blueprint.load(page('Create'))
    calls.length = 0
    await host.blueprint.update(page('Create', false, 'box@1'))
    expect(calls).toHaveLength(9)
    /** Version with an unknown part. */
    const broken = page('Create')
    ;(broken.root.children[0] as { tag: string }).tag = 'missing@1'
    /** Result of the broken update. */
    const result = await host.blueprint.update(broken)
    expect(result.tree).toBeUndefined()
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true)
    calls.length = 0
    await host.blueprint.patch('bp', [
      { op: 'replace', path: '/root/children/0/facets/props/label', value: 'x' }
    ])
    expect(calls).toEqual(['root/b1'])
  })

  it('loads an unknown id like load', async () => {
    /** Host under test. */
    const host = await createPartHost({ plugins: [app] })
    expect((await host.blueprint.update(page('Create'))).tree?.root.address).toBe('root')
  })
})

describe('host.catalog.manifest', () => {
  it('lists available definitions and renderers, not those of a suspended plugin', async () => {
    /** Host with a dependent plugin that gets suspended. */
    const host = await createPartHost({
      plugins: [
        app,
        definePartPlugin({
          name: 'react-impl',
          parts: [definePart({ id: 'card@1' })],
          implementations: [{ renderer: 'react', partId: 'card@1', value: {} }]
        })
      ]
    })
    /** Manifest before removal. */
    const before = host.catalog.manifest('b1')
    expect(before).toMatchObject({ format: 1, build: 'b1', renderers: ['react'] })
    expect(before.definitions).toEqual(['page@1', 'button@1', 'box@1', 'count@1', 'card@1'])
    await host.unUse('react-impl')
    expect(host.catalog.manifest('b1')).toMatchObject({
      definitions: ['page@1', 'button@1', 'box@1', 'count@1'],
      renderers: []
    })
  })
})
