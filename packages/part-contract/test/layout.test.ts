import { describe, expect, it } from 'vitest'
import {
  createRuleEngine,
  LandmarkElement,
  LayoutProp,
  parseBlueprint,
  PartContractErrorCode,
  validateDescriptor,
  type IDescriptor,
  type ILayoutRegion,
  type IPartNode
} from '../src/index.ts'
import { builtinRules } from '../src/doctor/index.ts'
import { createTestCatalog } from './fixtures/catalog.ts'

/** Matcher for a DESCRIPTOR_INVALID throw. */
const descriptorInvalid = expect.objectContaining({
  code: PartContractErrorCode.descriptorInvalid,
  source: 'part.contract'
})

/** Resizable navigation region of a nav-content layout. */
const nav: ILayoutRegion = {
  name: 'nav',
  landmark: 'navigation',
  label: 'Main navigation',
  resizable: true,
  size: { default: 240, min: 160, max: 480 },
  collapseBelow: 720
}

/** Main region. */
const content: ILayoutRegion = { name: 'content', landmark: 'main' }

/** Part descriptor with the given regions. */
function layoutPart(regions: readonly ILayoutRegion[]): IDescriptor {
  return { kind: 'part', id: 'shell@1', behavior: { layout: { direction: 'row', regions } } }
}

describe('layout descriptor validation', () => {
  it('accepts a nav-content layout', () => {
    expect(validateDescriptor(layoutPart([nav, content])).id).toBe('shell@1')
  })

  it.each([
    ['duplicate names', [nav, { ...nav }, content]],
    ['no main', [nav]],
    ['two main', [nav, content, { name: 'other', landmark: 'main' }]],
    [
      'resizable with auto default',
      [{ ...nav, size: { default: 'auto', min: 160, max: 480 } }, content]
    ],
    ['min greater than max', [{ ...nav, size: { default: 400, min: 500, max: 300 } }, content]],
    ['default below min', [{ ...nav, size: { default: 100, min: 160 } }, content]],
    ['main collapses', [nav, { ...content, collapseBelow: 600 }]],
    ['repeated landmark without label', [nav, { name: 'tree', landmark: 'navigation' }, content]],
    [
      'collapsible without label',
      [{ name: 'side', landmark: 'complementary', collapseBelow: 600 }, content]
    ]
  ] as const)('rejects %s', (_name, regions) => {
    expect(() => validateDescriptor(layoutPart(regions as readonly ILayoutRegion[]))).toThrow(
      descriptorInvalid
    )
  })

  it('rejects mistyped region fields', () => {
    expect(() =>
      validateDescriptor(layoutPart([{ ...nav, resizable: 'yes' as unknown as boolean }, content]))
    ).toThrow(descriptorInvalid)
    expect(() =>
      validateDescriptor(
        layoutPart([{ ...nav, collapseBelow: '720' as unknown as number }, content])
      )
    ).toThrow(/collapseBelow must be a number/)
    expect(() => validateDescriptor(layoutPart([nav]))).toThrow(/^layout is invalid: /)
  })

  it('declares the landmark table and layout props once', () => {
    expect(LandmarkElement.complementary).toBe('aside')
    expect(Object.keys(LandmarkElement)).toHaveLength(6)
    expect(Object.keys(LayoutProp).sort()).toEqual(['labels', 'sizes', 'skipLabel'])
  })
})

describe('layout rules', () => {
  /** Catalog with one layout part and a plain box. */
  const catalog = createTestCatalog([
    layoutPart([{ ...nav, collapseBelow: undefined, label: undefined }, content]),
    { kind: 'part', id: 'box@1' }
  ])
  /** Engine over every built-in rule. */
  const engine = createRuleEngine({ rules: builtinRules, catalog })

  /** Issues of one rule for a root node. */
  function issuesOf(rule: string, root: IPartNode): readonly { address: string }[] {
    return engine
      .run('authored', parseBlueprint({ id: 'b', version: 1, root }))
      .filter((issue) => issue.rule === rule)
  }

  it('counts only outermost layouts for layout.single-main', () => {
    /** Layout nested inside the content region of another layout. */
    const nested: IPartNode = {
      tag: 'shell@1',
      id: 'outer',
      facets: { slots: { content: [{ tag: 'shell@1', id: 'inner' }] } }
    }
    expect(issuesOf('layout.single-main', nested)).toHaveLength(0)
    /** Plain root with two sibling layouts. */
    const siblings: IPartNode = {
      tag: 'box@1',
      id: 'root',
      children: [
        { tag: 'shell@1', id: 'a' },
        { tag: 'shell@1', id: 'b' }
      ]
    }
    expect(issuesOf('layout.single-main', siblings)).toEqual([
      expect.objectContaining({ address: 'root/b' })
    ])
  })

  it('reports unknown regions', () => {
    /** Layout filling a region it does not have. */
    const root: IPartNode = {
      tag: 'shell@1',
      id: 'shell',
      facets: { slots: { footer: [{ tag: 'box@1' }] } }
    }
    expect(issuesOf('layout.region-unknown', root)).toHaveLength(1)
  })

  it('checks initial sizes against resizable ranges', () => {
    /** Layout root with the given sizes prop. */
    const withSizes = (sizes: Record<string, number>): IPartNode => ({
      tag: 'shell@1',
      id: 'shell',
      facets: { props: { [LayoutProp.sizes]: sizes } }
    })
    expect(issuesOf('layout.size-range', withSizes({ nav: 600 }))).toHaveLength(1)
    expect(issuesOf('layout.size-range', withSizes({ content: 300 }))).toHaveLength(1)
    expect(
      engine.run('authored', parseBlueprint({ id: 'b', version: 1, root: withSizes({ nav: 300 }) }))
    ).toEqual([])
  })

  it('has thirty-seven built-in rules', () => {
    expect(builtinRules).toHaveLength(37)
  })
})
