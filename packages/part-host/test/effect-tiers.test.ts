import { defineFeature } from '@migaia/plugin-host/features'
import { describe, expect, it } from 'vitest'
import {
  createPartHost,
  defineEffect,
  definePart,
  definePartPlugin,
  defineResource,
  partCorePlugin,
  type IIsolatedEffectContext
} from '../src/index.ts'

/** Outcomes recorded by the restricted effect. */
const outcomes: string[] = []

/** Code of a caught error, or `ok`. */
async function attempt(work: () => unknown): Promise<string> {
  try {
    await work()
    return 'ok'
  } catch (error) {
    return String((error as { code?: unknown }).code)
  }
}

/** Plugin with a resource, a restricted effect and an isolated effect. */
const app = definePartPlugin({
  name: 'app',
  parts: [definePart({ id: 'button@1' })],
  resources: [
    defineResource({
      id: 'orders@1',
      load: async () => [],
      commands: { create: { run: async () => 'created' }, delete: { run: async () => 'deleted' } }
    })
  ],
  effects: [
    defineEffect({
      id: 'restricted@1',
      tier: 'restricted',
      deps: {
        state: partCorePlugin.getFeature('state'),
        runtime: partCorePlugin.getFeature('runtime')
      },
      meta: { 'part.grants': { resources: ['orders@1:create'], state: ['page.form'] } },
      run: async (_event, ctx) => {
        outcomes.push(await attempt(() => ctx.resources.run('orders@1', 'delete', undefined)))
        outcomes.push(await attempt(() => ctx.state.write('page.other', 1)))
        outcomes.push(await attempt(() => ctx.dispatch('other', 'click', undefined)))
        outcomes.push(
          String(Object.keys(ctx.features).length),
          String(Object.keys(ctx.models).length)
        )
        outcomes.push(await attempt(() => ctx.resources.run('orders@1', 'create', undefined)))
        outcomes.push(await attempt(() => ctx.state.write('page.form.name', 'x')))
      }
    }),
    defineEffect({ id: 'isolated@1', tier: 'isolated', run: () => outcomes.push('page-run') })
  ]
})

/** Two blueprints: the triggering one and another one. */
const blueprints = [
  {
    id: 'bp',
    version: 1,
    root: {
      tag: 'button@1',
      id: 'b',
      facets: { events: { click: { handler: 'restricted@1' }, focus: { handler: 'isolated@1' } } }
    }
  },
  { id: 'bp2', version: 1, root: { tag: 'button@1', id: 'other' } }
]

describe('effect tiers', () => {
  it('refuses operations outside the grants and runs isolated effects only through a runner', async () => {
    /** Reported errors. */
    const reported: unknown[] = []
    /** Host under test. */
    const host = await createPartHost({ plugins: [app], onError: (error) => reported.push(error) })
    for (const blueprint of blueprints) await host.blueprint.load(blueprint)
    await host.dispatch('b', 'click', undefined)
    expect(outcomes).toEqual([
      'EFFECT_FORBIDDEN',
      'EFFECT_FORBIDDEN',
      'EFFECT_FORBIDDEN',
      '0',
      '0',
      'ok',
      'ok'
    ])
    expect(
      reported.filter((error) => (error as { code?: string }).code === 'EFFECT_FORBIDDEN')
    ).toHaveLength(3)
    expect(host.state.read('page.form.name')).toBe('x')

    await expect(host.dispatch('b', 'focus', undefined)).rejects.toMatchObject({
      code: 'EFFECT_ISOLATION_UNAVAILABLE'
    })
    /** Calls the recording runner received. */
    const received: { id: string; keys: string[]; cloned: unknown }[] = []
    /** Effect Feature of the core plugin, reached through a plugin. */
    let effectFeature: { setIsolatedRunner(runner: unknown): void } | undefined
    await host.use(
      definePartPlugin({
        name: 'isolation',
        features: {
          probe: defineFeature((_core, deps: { readonly effect: object }) => deps.effect, {
            effect: partCorePlugin.getFeature('effect')
          } as never)
        },
        onInstall: (features) => void (effectFeature = features.probe as never)
      })
    )
    effectFeature?.setIsolatedRunner(
      async (id: string, _event: unknown, ctx: IIsolatedEffectContext) => {
        received.push({
          id,
          keys: Object.keys(ctx).sort(),
          cloned: structuredClone(ctx.state.read('page.form.name'))
        })
      }
    )
    await host.dispatch('b', 'focus', undefined)
    expect(received).toEqual([
      { id: 'isolated@1', keys: ['dispatch', 'resources', 'state'], cloned: 'x' }
    ])
    expect(outcomes).not.toContain('page-run')
  })
})
