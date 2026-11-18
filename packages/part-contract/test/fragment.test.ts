import { describe, expect, it } from 'vitest'
import {
  createAddressIndex,
  expandFragments,
  parseBlueprint,
  validateDescriptor,
  type ICatalogView,
  type IDescriptor,
  type IPartNode
} from '../src/index.ts'
import { createTestCatalog, ruleDescriptors } from './fixtures/catalog.ts'

/** Card fragment: a section with a heading bound to `title` and a `body` slot after it. */
const card: IDescriptor = {
  kind: 'fragment',
  id: 'card@1',
  args: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
  fragment: {
    slots: ['body'],
    node: {
      tag: 'box@1',
      id: 'inner',
      children: [
        { tag: 'chip@1', id: 'heading', facets: { props: { text: { $param: 'title' } } } },
        { $slot: 'body' } as unknown as IPartNode
      ]
    }
  }
}

/** Outer fragment nesting a card that misses its title. */
const outer: IDescriptor = {
  kind: 'fragment',
  id: 'outer@1',
  fragment: { node: { tag: 'box@1', children: [{ tag: 'card@1', id: 'nested' }] } }
}

/** Builds a catalog with the given extra descriptors. */
function catalogWith(...extra: IDescriptor[]): ICatalogView {
  return createTestCatalog([...ruleDescriptors, ...extra])
}

/** Blueprint whose root box holds the given children. */
function blueprintOf(children: IPartNode[]) {
  return parseBlueprint({ id: 'bp', version: 1, root: { tag: 'box@1', id: 'root', children } })
}

/** Usage of the card with a title and a slot fill. */
const usage: IPartNode = {
  tag: 'card@1',
  id: 'summary',
  facets: { props: { title: 'A' }, slots: { body: [{ tag: 'chip@1', id: 'text' }] } }
}

/** Address of every node of an expansion, in document order. */
function addresses(nodes: ReturnType<typeof expandFragments>): string[] {
  return [...nodes.index.entries()].map((entry) => entry.address)
}

describe('expandFragments', () => {
  it('expands a usage in place and keeps authored slot addresses', () => {
    /** Authored blueprint. */
    const blueprint = blueprintOf([usage])
    /** Expansion result. */
    const result = expandFragments(blueprint, catalogWith(card))
    expect(result.blueprint).not.toBe(blueprint)
    expect(blueprint.root.children?.[0]?.tag).toBe('card@1')
    expect(addresses(result)).toEqual([
      'root',
      'root/summary',
      'root/summary/heading',
      'root/summary/slot.body/text'
    ])
    /** Expanded heading node. */
    const heading = result.index.get('root/summary/heading')?.node
    expect(heading?.facets?.props?.text).toBe('A')
    expect(result.blueprint.root.children?.[0]?.children?.map((node) => node.id)).toEqual([
      'heading',
      'text'
    ])
    expect(createAddressIndex(blueprint).get('root/summary/slot.body/text')).toBeDefined()
    expect(result.usages).toEqual([
      { address: 'root/summary', fragmentId: 'card@1', props: { title: 'A' } }
    ])
    expect(result.issues).toEqual([])
  })

  it('does not collide when a slot node shares an id with a body node', () => {
    /** Usage whose slot fill is named like the body heading. */
    const clash: IPartNode = {
      ...usage,
      facets: { props: { title: 'A' }, slots: { body: [{ tag: 'chip@1', id: 'heading' }] } }
    }
    expect(addresses(expandFragments(blueprintOf([clash]), catalogWith(card)))).toContain(
      'root/summary/slot.body/heading'
    )
  })

  it('names an id-less usage after the fragment', () => {
    /** Usage without id. */
    const anonymous: IPartNode = { tag: 'card@1', facets: { props: { title: 'A' } } }
    expect(addresses(expandFragments(blueprintOf([anonymous]), catalogWith(card)))).toContain(
      'root/card/heading'
    )
  })

  it('reports missing parameters and unknown slots, nested usages included', () => {
    /** Usage without title that fills an undeclared slot. */
    const bad: IPartNode = {
      tag: 'card@1',
      id: 'summary',
      facets: { slots: { footer: [{ tag: 'chip@1' }] } }
    }
    /** Expansion result. */
    const result = expandFragments(blueprintOf([bad]), catalogWith(card))
    expect(result.issues.map((issue) => `${issue.rule} ${issue.address} ${issue.path}`)).toEqual([
      'fragment.param-missing root/summary title',
      'fragment.slot-unknown root/summary footer'
    ])
    /** Expansion of a usage whose fragment nests a card without title. */
    const nested = expandFragments(
      blueprintOf([{ tag: 'outer@1', id: 'wrap' }]),
      catalogWith(card, outer)
    )
    expect(nested.issues.map((issue) => `${issue.rule} ${issue.address}`)).toEqual([
      'fragment.param-missing root/wrap/nested'
    ])
    expect(nested.usages.map((entry) => entry.address)).toEqual(['root/wrap/nested', 'root/wrap'])
  })

  it('throws on cycles, depth and size limits', () => {
    /** Fragment a nests b. */
    const a: IDescriptor = {
      kind: 'fragment',
      id: 'a@1',
      fragment: { node: { tag: 'box@1', children: [{ tag: 'b@1' }] } }
    }
    /** Fragment b nests a. */
    const b: IDescriptor = {
      kind: 'fragment',
      id: 'b@1',
      fragment: { node: { tag: 'box@1', children: [{ tag: 'a@1' }] } }
    }
    expect(() => expandFragments(blueprintOf([{ tag: 'a@1' }]), catalogWith(a, b))).toThrow(
      expect.objectContaining({ code: 'FRAGMENT_CYCLE', cause: ['a@1', 'b@1', 'a@1'] })
    )
    /** Chain of seventeen nested fragments. */
    const chain: IDescriptor[] = Array.from({ length: 17 }, (_unused, level) => ({
      kind: 'fragment',
      id: `l${level}@1`,
      fragment: { node: { tag: 'box@1', children: level < 16 ? [{ tag: `l${level + 1}@1` }] : [] } }
    }))
    expect(() => expandFragments(blueprintOf([{ tag: 'l0@1' }]), catalogWith(...chain))).toThrow(
      expect.objectContaining({ code: 'FRAGMENT_TOO_DEEP' })
    )
    /** Six levels of ten children each: about a million nodes when fully expanded. */
    const wide: IDescriptor[] = Array.from({ length: 6 }, (_unused, level) => ({
      kind: 'fragment',
      id: `w${level}@1`,
      fragment: {
        node: {
          tag: 'box@1',
          children: level < 5 ? Array.from({ length: 10 }, () => ({ tag: `w${level + 1}@1` })) : []
        }
      }
    }))
    /** Catalog view counting lookups. */
    const base = catalogWith(...wide)
    /** Lookup count. */
    let lookups = 0
    /** Counting view. */
    const counting: ICatalogView = { ...base, get: (id) => ((lookups += 1), base.get(id)) }
    expect(() => expandFragments(blueprintOf([{ tag: 'w0@1' }]), counting)).toThrow(
      expect.objectContaining({ code: 'FRAGMENT_TOO_LARGE' })
    )
    // Two authored nodes (root and usage) plus at most 10000 nodes produced by fragments.
    expect(lookups).toBeLessThanOrEqual(10002)
  })

  it('rejects usages with other content and malformed fragment bodies', () => {
    expect(() =>
      expandFragments(blueprintOf([{ ...usage, children: [{ tag: 'chip@1' }] }]), catalogWith(card))
    ).toThrow(expect.objectContaining({ code: 'BLUEPRINT_INVALID' }))
    expect(() =>
      validateDescriptor({
        kind: 'fragment',
        id: 'f@1',
        fragment: { node: { tag: 'box@1', id: { $param: 'x' } } }
      })
    ).toThrow(expect.objectContaining({ code: 'DESCRIPTOR_INVALID' }))
  })
})

describe('expansion limits', () => {
  it('does not count authored nodes outside fragments', () => {
    /** Ten thousand and one plain children, no fragment usage. */
    const children: IPartNode[] = Array.from({ length: 10001 }, () => ({ tag: 'chip@1' }))
    expect(
      expandFragments(blueprintOf(children), catalogWith(card)).index.get('root')
    ).toBeDefined()
  })
})
