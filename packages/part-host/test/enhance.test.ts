import { describe, expect, it } from 'vitest'
import {
  createPartHost,
  defineEnhancer,
  definePart,
  definePartPlugin,
  PartHostErrorCode
} from '../src/index.ts'

/** Order in which enhancers ran. */
const order: string[] = []

/** Enhancer recording its id. */
function recorder(id: string, after?: readonly string[]) {
  return defineEnhancer({
    id,
    targets: ['combobox'],
    ...(after === undefined ? {} : { after }),
    transform: (config) => {
      order.push(id)
      return { ...config }
    }
  })
}

/** Blueprint with one combobox and one other node. */
const blueprint = {
  id: 'bp',
  version: 1,
  root: { tag: 'page@1', id: 'p', children: [{ tag: 'combobox@1', id: 'c' }] }
}

describe('enhancement', () => {
  it('orders by after then registration, rejects cycles, and re-runs only the affected tag', async () => {
    const host = await createPartHost({
      plugins: [
        definePartPlugin({
          name: 'parts',
          parts: [definePart({ id: 'page@1' }), definePart({ id: 'combobox@1' })]
        })
      ]
    })
    await host.use(definePartPlugin({ name: 'c', enhancers: [recorder('c@1', ['a@1'])] }))
    await host.use(definePartPlugin({ name: 'a', enhancers: [recorder('a@1')] }))
    await host.use(definePartPlugin({ name: 'b', enhancers: [recorder('b@1')] }))
    order.length = 0
    await host.blueprint.load(blueprint)
    expect(order).toEqual(['a@1', 'c@1', 'b@1'])

    await expect(
      host.use(
        definePartPlugin({
          name: 'loop',
          enhancers: [recorder('l1@1', ['l2@1']), recorder('l2@1', ['l1@1'])]
        })
      )
    ).rejects.toMatchObject({
      cause: { code: PartHostErrorCode.enhancerCycle }
    })

    order.length = 0
    await host.unUse('b')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['a@1', 'c@1'])
    await host.dispose()
  })

  it('rejects an enhancer that mutates its input', async () => {
    const host = await createPartHost({
      plugins: [
        definePartPlugin({
          name: 'parts',
          parts: [definePart({ id: 'page@1' }), definePart({ id: 'combobox@1' })],
          enhancers: [
            defineEnhancer({
              id: 'mutate@1',
              targets: ['combobox'],
              transform: (config) => {
                ;(config as { props?: unknown }).props = {}
                return config
              }
            })
          ]
        })
      ]
    })
    const failure = await host.blueprint.load(blueprint).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: PartHostErrorCode.enhancerMutatedInput })
    expect((failure as Error).cause).toBeInstanceOf(TypeError)
    await host.dispose()
  })
})
