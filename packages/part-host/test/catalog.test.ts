import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createPartHost,
  defineEnhancer,
  definePart,
  definePartPlugin,
  PartHostErrorCode,
  type IPartPlugin
} from '../src/index.ts'
import { RenderLog, rendererPlugin } from './fixtures.ts'

/** Blueprint with one node of the given tag. */
function single(tag: string) {
  return { id: 'bp', version: 1, root: { tag, id: 'n' } }
}

describe('definitions', () => {
  it('rejects transforming argument schemas through the contract code', () => {
    expect(() =>
      defineEnhancer({
        id: 'e@1',
        targets: ['x'],
        args: z.string().transform((v) => v.length),
        transform: (c) => c
      })
    ).toThrow(expect.objectContaining({ code: 'SCHEMA_TRANSFORMS', source: 'part.contract' }))
  })
})

describe('catalog', () => {
  it('handles conflicts, overrides, replacement, majors, suspension and implementations', async () => {
    const comboA = definePart({ id: 'combobox@1', title: 'a' })
    const comboB = definePart({ id: 'combobox@1', title: 'b' })
    const host = await createPartHost({
      plugins: [definePartPlugin({ name: 'a', parts: [comboA] })]
    })
    await expect(host.use(definePartPlugin({ name: 'b', parts: [comboB] }))).rejects.toMatchObject({
      cause: { code: PartHostErrorCode.catalogConflict }
    })
    expect(host.catalog.get('combobox@1')?.descriptor.title).toBe('a')
    await host.use(definePartPlugin({ name: 'b', parts: [comboB], override: ['combobox@1'] }))
    expect(host.catalog.get('combobox@1')?.descriptor.title).toBe('b')
    await host.unUse('b')

    const comboA2 = definePart({ id: 'combobox@1', title: 'a2' })
    await host.replace('a', definePartPlugin({ name: 'a', parts: [comboA2] }))
    expect(host.catalog.get('combobox@1')?.descriptor.title).toBe('a2')

    const major = await host.blueprint.load(single('combobox@2'))
    expect(major.issues.map((issue) => issue.rule)).toEqual(['catalog.major-exists'])

    let installs = 0
    const provider = definePlugin({
      name: 'p',
      features: { pf: defineFeature(() => ({})) },
      install: () => ({})
    })
    const chipImplementation = { component: 'Chip' }
    const dependent = definePartPlugin({
      name: 'c',
      parts: [definePart({ id: 'chip@1' })],
      implementations: [{ renderer: 'react', partId: 'chip@1', value: chipImplementation }],
      features: {
        link: defineFeature(
          () => {
            installs += 1
            return {}
          },
          { pf: provider.getFeature('pf') } as never
        )
      }
    })
    await host.use(provider as unknown as IPartPlugin)
    await host.use(dependent)
    expect(host.catalog.implementation('react', 'chip@1')).toBe(chipImplementation)
    await host.unUse('p', { policy: 'suspend' })
    expect((await host.blueprint.load(single('chip@1'))).issues.map((issue) => issue.rule)).toEqual(
      ['catalog.id-exists']
    )
    expect(host.catalog.implementation('react', 'chip@1')).toBeUndefined()
    await host.use(provider as unknown as IPartPlugin)
    expect((await host.blueprint.load(single('chip@1'))).issues).toEqual([])
    expect(installs).toBe(2)

    await expect(
      host.use(
        definePartPlugin({
          name: 'd',
          implementations: [{ renderer: 'react', partId: 'chip@1', value: {} }]
        })
      )
    ).rejects.toMatchObject({ cause: { code: PartHostErrorCode.catalogConflict } })
    expect(new Set(host.catalog.manifest()).size).toBe(host.catalog.manifest().length)

    const log = new RenderLog()
    await host.use(rendererPlugin('r', log.factory()))
    await expect(
      host.replace('r', rendererPlugin('r', new RenderLog().factory()))
    ).resolves.toBeUndefined()
    await host.dispose()
  })
})
