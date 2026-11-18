import { describe, expect, it } from 'vitest'
import {
  createPartHost,
  defineDerive,
  defineEffect,
  definePart,
  definePartPlugin,
  PartHostErrorCode,
  type IResolvedNode
} from '../src/index.ts'

/** Runs recorded by the ordered effect. */
const runs: number[] = []
/** Number of derive evaluations. */
let computes = 0

/** Plugin with a button, a derive and three effects. */
const plugin = definePartPlugin({
  name: 'app',
  parts: [definePart({ id: 'button@1' })],
  derives: [
    defineDerive({
      id: 'orders.query@1',
      compute: (state) => {
        computes += 1
        return `status=${String(state.read('page.filter.status'))}`
      }
    }),
    defineDerive({ id: 'bad.write@1', compute: (state) => state.write('page.x', 1) })
  ],
  effects: [
    defineEffect({
      id: 'ordered@1',
      run: async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 3 - Number(event.detail)))
        runs.push(Number(event.detail))
      }
    }),
    defineEffect({
      id: 'self@1',
      run: (event, context) => {
        runs.push(Number(event.detail))
        if (event.detail === 1) context.dispatch('b', 'self', 2)
      }
    }),
    defineEffect({
      id: 'fails@1',
      run: (event) => {
        if (event.detail === 'boom') throw new Error('boom')
        runs.push(99)
      }
    })
  ]
})

/** Blueprint subscribing the three effects. */
const blueprint = {
  id: 'bp',
  version: 1,
  root: {
    tag: 'button@1',
    id: 'b',
    facets: {
      events: {
        click: { handler: 'ordered@1' },
        self: { handler: 'self@1' },
        fail: { handler: 'fails@1' }
      }
    }
  }
}

/** Placeholder resolved node for `state.resolve`. */
const anyNode = {} as IResolvedNode

describe('state, derive and effects', () => {
  it('recomputes a derive once per batch and forbids derive writes', async () => {
    const host = await createPartHost({ plugins: [plugin] })
    let seen: unknown
    const reader = host.state.runtime.effect(() => {
      seen = host.state.resolve(anyNode, { $derive: 'orders.query@1' })
    })
    computes = 0
    host.state.write('page.filter.status', 'paid')
    host.state.write('page.filter.status', 'open')
    await Promise.resolve()
    expect(computes).toBe(1)
    expect(seen).toBe('status=open')
    expect(() => host.state.resolve(anyNode, { $derive: 'bad.write@1' })).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.deriveWrite })
    )
    reader.dispose()
    await host.dispose()
  })

  it('runs effects in arrival order, queues self dispatch, reports failures once', async () => {
    const errors: unknown[] = []
    const host = await createPartHost({ plugins: [plugin], onError: (error) => errors.push(error) })
    await host.blueprint.load(blueprint)
    runs.length = 0
    await Promise.all([
      host.dispatch('b', 'click', 1),
      host.dispatch('b', 'click', 2),
      host.dispatch('b', 'click', 3)
    ])
    expect(runs).toEqual([1, 2, 3])

    runs.length = 0
    await host.dispatch('b', 'self', 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runs).toEqual([1, 2])

    await expect(host.dispatch('b', 'nothing', 1)).resolves.toBeUndefined()
    const failure = await host.dispatch('b', 'fail', 'boom').catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: PartHostErrorCode.effectFailed,
      cause: new Error('boom')
    })
    expect(errors).toEqual([failure])
    runs.length = 0
    await host.dispatch('b', 'fail', 'ok')
    expect(runs).toEqual([99])

    await host.dispose()
    await expect(host.dispatch('b', 'click', 1)).rejects.toMatchObject({
      code: PartHostErrorCode.hostDisposed
    })
  })
})
