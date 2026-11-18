import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPartHost, definePart, definePartPlugin } from '@migaia/part-host'
import { describe, expect, it } from 'vitest'
import { layoutsPlugin } from '../src/index.ts'

/** Plugin with one content part. */
const contentPlugin = definePartPlugin({ name: 'content', parts: [definePart({ id: 'box@1' })] })

/** Blueprint rooted at nav-content@1 with the given slots. */
function blueprint(slots: Record<string, unknown>): unknown {
  return { id: 'page', version: 1, root: { tag: 'nav-content@1', id: 'shell', facets: { slots } } }
}

describe('layoutsPlugin', () => {
  it('lets a blueprint fill the regions of a built-in layout', async () => {
    const host = await createPartHost({ plugins: [layoutsPlugin, contentPlugin] })
    const loaded = await host.blueprint.load(
      blueprint({ nav: [{ tag: 'box@1', id: 'menu' }], content: [{ tag: 'box@1', id: 'body' }] })
    )
    expect(loaded.issues).toEqual([])
    expect(Object.keys(loaded.tree?.root.slots ?? {})).toEqual(['nav', 'content'])
    const unknown = await host.blueprint.load(blueprint({ aside: [{ tag: 'box@1' }] }))
    expect(unknown.issues.filter((issue) => issue.rule === 'layout.region-unknown')).toHaveLength(1)
    await host.dispose()
  })

  it('references no DOM or React', () => {
    /** Source directory of this package. */
    const source = join(import.meta.dirname, '..', 'src')
    for (const file of readdirSync(source, { recursive: true, encoding: 'utf8' }).filter((name) =>
      name.endsWith('.ts')
    ))
      expect(readFileSync(join(source, file), 'utf8')).not.toMatch(
        /\b(document|window|react|React)\b/
      )
  })
})
