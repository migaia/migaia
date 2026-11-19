import { describe, expect, it } from 'vitest'
import {
  createPartHost,
  defineDerive,
  defineEffect,
  defineEnhancer,
  definePart,
  definePartPlugin
} from '../src/index.ts'

/** Calls of the first-generation derive compute. */
let oldComputes = 0
/** Addresses the enhancers ran on. */
const enhanced: string[] = []

/** Plugin generation whose derive, enhancer and effect use the given variant. */
function generation(variant: 'A' | 'B') {
  return definePartPlugin({
    name: 'p',
    derives: [
      defineDerive({
        id: 'total@1',
        compute: (state) => {
          if (variant === 'A') oldComputes += 1
          /** Inputs. */
          const a = Number(state.read('page.a'))
          const b = Number(state.read('page.b'))
          return variant === 'A' ? a + b : a * b
        }
      })
    ],
    enhancers: [
      defineEnhancer({
        id: 'label@1',
        targets: ['button'],
        transform: (config, context) => {
          enhanced.push(context.address)
          return { ...config, aria: { ...config.aria, label: variant } }
        }
      })
    ],
    effects: [
      defineEffect({ id: 'notify@1', run: (_event, ctx) => ctx.state.write('page.last', variant) })
    ]
  })
}

/** Page with a button using all three and an unrelated box. */
const page = {
  id: 'bp',
  version: 1,
  root: {
    tag: 'box@1',
    id: 'root',
    children: [
      {
        tag: 'button@1',
        id: 'go',
        facets: {
          props: { total: { $derive: 'total@1' } },
          events: { click: { handler: 'notify@1' } }
        }
      },
      { tag: 'box@1', id: 'other' }
    ]
  }
}

describe('definition replacement', () => {
  it('uses the new derive, enhancer and effect after replace, and nothing after unUse', async () => {
    /** Host with the parts and the first generation. */
    const host = await createPartHost({
      plugins: [
        definePartPlugin({
          name: 'parts',
          parts: [definePart({ id: 'box@1' }), definePart({ id: 'button@1' })]
        }),
        generation('A')
      ]
    })
    await host.blueprint.load(page)
    host.state.write('page.a', 2)
    host.state.write('page.b', 3)
    /** Reads the derive the way a renderer binding does. */
    const total = () => host.state.resolve({} as never, { $derive: 'total@1' })
    expect(total()).toBe(5)
    /** Old compute calls before replacement. */
    const before = oldComputes
    enhanced.length = 0
    await host.replace('p', generation('B'))
    expect(total()).toBe(6)
    host.state.write('page.a', 4)
    expect(total()).toBe(12)
    expect(oldComputes).toBe(before)
    await host.blueprint.update(page)
    expect(enhanced).toEqual(['root/go'])
    await host.dispatch('root/go', 'click', undefined)
    expect(host.state.read('page.last')).toBe('B')
    await host.unUse('p')
    expect(total()).toBeUndefined()
  })
})
