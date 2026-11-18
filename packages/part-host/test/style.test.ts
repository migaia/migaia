import { describe, expect, it } from 'vitest'
import { createPartHost, definePart, definePartPlugin } from '../src/index.ts'

/** Plugin with a combobox declaring one length hook. */
const plugin = definePartPlugin({
  name: 'ui',
  parts: [definePart({ id: 'combobox@1', styleHooks: { '--part-combobox-radius': 'length' } })]
})

/** Blueprint with one style assignment. */
function withStyle(style: Record<string, string>) {
  return { id: 'bp', version: 1, root: { tag: 'combobox@1', id: 'c', facets: { style } } }
}

describe('style rules', () => {
  it('emits blueprint-layer declarations for valid hook values only', async () => {
    const host = await createPartHost({ plugins: [plugin] })
    const valid = await host.blueprint.load(withStyle({ '--part-combobox-radius': '8px' }))
    expect(valid.tree?.root.styleRules).toEqual([
      { address: 'c', layer: 'blueprint', declarations: { '--part-combobox-radius': '8px' } }
    ])
    const injected = await host.blueprint.load(
      withStyle({ '--part-combobox-radius': '8px;}body{color:red' })
    )
    expect(injected.tree).toBeUndefined()
    expect(injected.issues.map((issue) => issue.rule)).toEqual(['style.hook-type'])
    const undeclared = await host.blueprint.load(withStyle({ '--other': '1px' }))
    expect(undeclared.tree).toBeUndefined()
    expect(undeclared.issues.map((issue) => issue.rule)).toEqual(['style.hook-type'])
    await host.dispose()
  })
})
