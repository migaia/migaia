import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createPartHost,
  defineEffect,
  defineEnhancer,
  defineFragment,
  defineModifier,
  definePart,
  definePartPlugin
} from '../src/index.ts'
import type { IPartNode } from '@migaia/part-contract'
import { RenderLog, rendererPlugin } from './fixtures.ts'

/** Debounce-like modifier with a required numeric argument. */
const debounce = defineModifier<{ readonly ms: number }>({
  id: 'debounce@1',
  eventKinds: ['dom'],
  placement: false,
  args: z.object({ ms: z.number() }),
  create: () => ({ handle: (_event, next) => next() })
})

/** Enhancer calls per address, to observe incremental re-runs. */
const calls = new Map<string, number>()

/** Card fragment: a box whose heading text comes from `title`, with a `body` slot. */
const card = defineFragment({
  id: 'card@1',
  args: z.object({ title: z.string() }),
  slots: ['body'],
  node: {
    tag: 'box@1',
    children: [
      { tag: 'text@1', id: 'heading', facets: { props: { text: { $param: 'title' } } } },
      { $slot: 'body' } as unknown as IPartNode
    ]
  }
})

/** Base plugin: parts, an effect and a counting enhancer. */
const base = definePartPlugin({
  name: 'ui',
  parts: [definePart({ id: 'page@1' }), definePart({ id: 'box@1' }), definePart({ id: 'text@1' })],
  effects: [defineEffect({ id: 'noop@1', run: () => undefined })],
  enhancers: [
    defineEnhancer({
      id: 'count@1',
      targets: ['text', 'box'],
      transform: (config, context) => {
        calls.set(context.address, (calls.get(context.address) ?? 0) + 1)
        return { ...config }
      }
    })
  ]
})

/** Blueprint whose page subscribes click with the given modifier references. */
function withModifiers(modifiers: unknown[], key = 'click') {
  return {
    id: 'mods',
    version: 1,
    root: {
      tag: 'page@1',
      id: 'p',
      facets: { events: { [key]: { handler: 'noop@1', modifiers } } }
    }
  }
}

/** Blueprint using the card fragment. */
function withCard(title: unknown) {
  return {
    id: 'cards',
    version: 1,
    root: {
      tag: 'page@1',
      id: 'p',
      children: [
        {
          tag: 'card@1',
          id: 'summary',
          facets: { props: { title }, slots: { body: [{ tag: 'text@1', id: 'note' }] } }
        },
        { tag: 'text@1', id: 'other' }
      ]
    }
  }
}

describe('defineModifier', () => {
  it('registers, validates arguments and reports unavailability after removal', async () => {
    /** Host with the modifier plugin. */
    const host = await createPartHost({
      plugins: [base, definePartPlugin({ name: 'mods', modifiers: [debounce] })]
    })
    expect(host.catalog.get('debounce@1')?.descriptor.kind).toBe('modifier')
    expect(
      (await host.blueprint.load(withModifiers([{ id: 'debounce@1', args: { ms: 10 } }]))).issues
    ).toEqual([])
    /** Load with a bad argument. */
    const bad = await host.blueprint.load(withModifiers([{ id: 'debounce@1', args: { ms: 'x' } }]))
    expect(bad.tree).toBeUndefined()
    expect(bad.issues).toMatchObject([
      { rule: 'event.modifier-args', code: 'ARGS_INVALID', path: 'click/modifiers/0' }
    ])
    /** String form validates `undefined` against the required schema. */
    const bare = await host.blueprint.load(withModifiers(['debounce@1']))
    expect(bare.issues.map((issue) => issue.rule)).toEqual(['event.modifier-args'])
    /** Shorthand key with a modifier segment. */
    const shorthand = await host.blueprint.load(withModifiers([], 'click.debounce'))
    expect(shorthand.issues.map((issue) => issue.path)).toEqual(['click.debounce/modifiers/0'])
    await expect(
      host.use(definePartPlugin({ name: 'other', modifiers: [debounce] }))
    ).rejects.toMatchObject({
      cause: { code: 'CATALOG_CONFLICT' }
    })
    await host.unUse('mods')
    /** Load after the provider was removed. */
    const missing = await host.blueprint.load(
      withModifiers([{ id: 'debounce@1', args: { ms: 10 } }])
    )
    expect(missing.issues.map((issue) => issue.rule)).toEqual(['event.modifier-exists'])
    await host.dispose()
  })

  it('requires place exactly when placement is set', () => {
    expect(() =>
      defineModifier({
        id: 'edge@1',
        eventKinds: ['dom'],
        placement: true,
        create: () => ({ handle: () => undefined })
      })
    ).toThrow(expect.objectContaining({ code: 'MODIFIER_PLACEMENT_MISMATCH' }))
  })
})

describe('defineFragment', () => {
  it('expands usages, validates parameters and re-runs only usages', async () => {
    calls.clear()
    /** Change log of the test renderer. */
    const log = new RenderLog()
    /** Host with the fragment and a renderer. */
    const host = await createPartHost({
      plugins: [
        base,
        definePartPlugin({ name: 'frag', fragments: [card] }),
        rendererPlugin('r', log.factory())
      ]
    })
    /** Successful load. */
    const loaded = await host.blueprint.load(withCard('A'))
    expect(loaded.issues).toEqual([])
    /** Expanded usage root. */
    const summary = loaded.tree?.root.children[0]
    expect(summary?.address).toBe('p/summary')
    expect(summary?.children.map((node) => node.address)).toEqual([
      'p/summary/heading',
      'p/summary/slot.body/note'
    ])
    expect(summary?.children[0]?.config.props?.text).toBe('A')
    /** Wrong parameter type. */
    const wrong = await host.blueprint.load({ ...withCard(3), id: 'cards-bad' })
    expect(wrong.issues).toMatchObject([
      { rule: 'fragment.args', code: 'ARGS_INVALID', address: 'p/summary' }
    ])
    host.mount({}, 'cards')
    calls.clear()
    await host.blueprint.patch('cards', [
      { op: 'replace', path: '/root/children/0/facets/props/title', value: 'B' }
    ])
    expect(log.updates[0]?.at(-1)?.changed.map((node) => node.address)).toEqual([
      'p/summary',
      'p/summary/heading',
      'p/summary/slot.body/note'
    ])
    expect(calls.has('p/other')).toBe(false)
    expect(calls.get('p/summary/heading')).toBe(1)
    await host.dispose()
  })

  it('throws expansion errors from load', async () => {
    /** Self-nesting fragment. */
    const loop = defineFragment({
      id: 'loop@1',
      node: { tag: 'box@1', children: [{ tag: 'loop@1' }] }
    })
    /** Host with the looping fragment. */
    const host = await createPartHost({
      plugins: [base, definePartPlugin({ name: 'loop', fragments: [loop] })]
    })
    await expect(
      host.blueprint.load({
        id: 'l',
        version: 1,
        root: { tag: 'page@1', children: [{ tag: 'loop@1' }] }
      })
    ).rejects.toMatchObject({ code: 'FRAGMENT_CYCLE' })
    await host.dispose()
  })
})

describe('onInstall', () => {
  it('runs after registration with the plugin features and aborts on removal', async () => {
    /** Observations of the hook. */
    const seen: { aborted?: boolean; features?: string[] } = {}
    /** Host to observe. */
    const host = await createPartHost({
      plugins: [
        base,
        definePartPlugin({
          name: 'hooked',
          modifiers: [debounce],
          onInstall: (features, signal) => {
            seen.features = Object.keys(features)
            signal.addEventListener('abort', () => void (seen.aborted = true), { once: true })
          }
        })
      ]
    })
    expect(seen.features).toContain('partRegistration')
    expect(host.catalog.get('debounce@1')).toBeDefined()
    expect(seen.aborted).toBeUndefined()
    await host.unUse('hooked')
    expect(seen.aborted).toBe(true)
    await host.dispose()
  })
})

describe('incremental argument validation', () => {
  it('keeps unaffected argument issues and revalidates patched nodes', async () => {
    /** Host with the modifier. */
    const host = await createPartHost({
      plugins: [base, definePartPlugin({ name: 'mods', modifiers: [debounce] })]
    })
    /** Blueprint whose page has a bad argument and whose text child is unrelated. */
    const blueprint = {
      id: 'inc',
      version: 1,
      root: {
        tag: 'page@1',
        id: 'p',
        facets: {
          events: {
            click: { handler: 'noop@1', modifiers: [{ id: 'debounce@1', args: { ms: 'x' } }] }
          }
        },
        children: [{ tag: 'text@1', id: 't', facets: { props: { text: 'a' } } }]
      }
    }
    expect((await host.blueprint.load(blueprint)).issues.map((issue) => issue.rule)).toEqual([
      'event.modifier-args'
    ])
    /** Patch of the unrelated child. */
    const unrelated = await host.blueprint.patch('inc', [
      { op: 'replace', path: '/root/children/0/facets/props/text', value: 'b' }
    ])
    expect(unrelated.issues.map((issue) => `${issue.rule} ${issue.address}`)).toEqual([
      'event.modifier-args p'
    ])
    /** Patch fixing the argument. */
    const fixed = await host.blueprint.patch('inc', [
      { op: 'replace', path: '/root/facets/events/click/modifiers/0/args/ms', value: 5 }
    ])
    expect(fixed.issues).toEqual([])
    await host.dispose()
  })
})
