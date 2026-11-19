import { defineModel } from '@migaia/part-contract'
import { definePlugin, type IFeatureDependency } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createPartHost,
  defineEffect,
  definePart,
  definePartPlugin,
  defineResource,
  PartHostErrorCode,
  type IEffectContext,
  type IPartPlugin
} from '../src/index.ts'
import { settle } from './resource-support.ts'

/** Order model requiring a customer name. */
const order = defineModel({
  id: 'order@1',
  schema: z.object({ customer: z.string().min(1) }),
  key: ['customer']
})

describe('models, dependencies and effect context', () => {
  it('validates models, resolves resource dependencies and exposes part references', async () => {
    /** Plugin providing the clock Feature the resource depends on. */
    const clockPlugin = definePlugin({
      name: 'clock',
      features: { clock: defineFeature(() => ({ now: () => 42 })) },
      install: () => ({})
    }) as unknown as IPartPlugin & { getFeature(name: string): unknown }
    /** Reference to the clock Feature. */
    const clock = clockPlugin.getFeature('clock') as IFeatureDependency
    /** Dependency output seen by the load. */
    let seenClock: unknown
    /** Clock output the plugin resolved, seen by an effect with the same dependency. */
    let effectClock: unknown
    /** Context captured from the effect run. */
    let context: IEffectContext<Readonly<Record<string, unknown>>> | undefined
    const timed = defineResource({
      id: 'timed@1',
      deps: { clock },
      load: async (_params, { features }) => {
        seenClock = (features as Record<string, unknown>).clock
        return [1]
      }
    })
    const probe = defineEffect({
      id: 'probe@1',
      deps: { clock },
      run: (_event, ctx) => {
        effectClock = ctx.features.clock
        context = ctx
      }
    })
    /** Dialog part with an open state. */
    const dialog = definePart({
      id: 'dialog@1',
      events: { close: { kind: 'component' } },
      behavior: { states: { names: ['open'] } }
    })
    /** Dispatches seen by the close effect. */
    const closes: string[] = []
    const close = defineEffect({
      id: 'close@1',
      run: (event) => void closes.push(event.address)
    })
    const host = await createPartHost({
      plugins: [
        clockPlugin,
        definePartPlugin({
          name: 'app',
          models: [order],
          resources: [timed],
          effects: [probe, close],
          parts: [dialog]
        })
      ]
    })
    await host.blueprint.load({
      id: 'page',
      version: 1,
      root: {
        tag: 'dialog@1',
        id: 'dialog',
        facets: { events: { close: { handler: 'close@1' }, probe: { handler: 'probe@1' } } }
      }
    })
    expect(await host.models.validate('order@1', { customer: '' })).toMatchObject({
      ok: false,
      issues: [{ path: 'customer' }]
    })
    expect(await host.models.validate('order@1', { customer: 'A' })).toMatchObject({ ok: true })
    await expect(host.models.validate('missing@1', {})).rejects.toMatchObject({
      code: PartHostErrorCode.modelUnknown
    })
    expect([...host.catalog.view().all()].map((descriptor) => descriptor.id)).toEqual([
      'dialog@1',
      'probe@1',
      'close@1',
      'timed@1',
      'order@1'
    ])
    host.state.write('page.x', 2)
    host.state.seed('page.x', 1)
    host.state.read('page.y')
    host.state.seed('page.y', 1)
    expect([host.state.read('page.x'), host.state.read('page.y')]).toEqual([2, 1])

    await host.resources.query('timed@1', {})
    await host.dispatch('dialog', 'probe', undefined)
    expect(seenClock).toBe(effectClock)
    expect(seenClock).toMatchObject({ now: expect.any(Function) })
    expect(context?.resources).toBe(host.resources)
    expect(await context?.models.validate('order@1', { customer: '' })).toMatchObject({ ok: false })
    context?.part('dialog').dispatch('close', undefined)
    context?.dispatch('dialog', 'close', undefined)
    await settle(host)
    expect(closes).toEqual(['dialog', 'dialog'])
    await host.dispose()
  })
})
