import type { IPartDefinition } from '@migaia/part-host'
import { describe, expect, it } from 'vitest'
import {
  headerContentFooterLayout,
  navContentLayout,
  navTreeContentLayout,
  singleLayout
} from '../src/index.ts'

/** Expected regions per built-in layout: name, landmark, size and collapse width. */
const expected: readonly (readonly [IPartDefinition<unknown>, string, readonly unknown[]])[] = [
  [singleLayout, 'single@1', [{ name: 'content', landmark: 'main' }]],
  [
    navContentLayout,
    'nav-content@1',
    [
      {
        name: 'nav',
        landmark: 'navigation',
        label: 'Main navigation',
        resizable: true,
        size: { default: 240, min: 160, max: 480 },
        collapseBelow: 720
      },
      { name: 'content', landmark: 'main' }
    ]
  ],
  [
    navTreeContentLayout,
    'nav-tree-content@1',
    [
      {
        name: 'nav',
        landmark: 'navigation',
        label: 'Main navigation',
        size: { default: 64 },
        collapseBelow: 960
      },
      {
        name: 'tree',
        landmark: 'navigation',
        label: 'Contents',
        resizable: true,
        size: { default: 280, min: 200, max: 520 },
        collapseBelow: 720
      },
      { name: 'content', landmark: 'main' }
    ]
  ],
  [
    headerContentFooterLayout,
    'header-content-footer@1',
    [
      { name: 'header', landmark: 'banner', size: { default: 'auto' }, scroll: false },
      { name: 'content', landmark: 'main' },
      { name: 'footer', landmark: 'contentinfo', size: { default: 'auto' }, scroll: false }
    ]
  ]
]

describe('built-in layouts', () => {
  it.each(expected)('%#: declares the documented regions', (layout, id, regions) => {
    expect(layout.descriptor.id).toBe(id)
    expect(layout.descriptor.behavior?.layout?.regions).toEqual(regions)
    expect(
      layout.descriptor.behavior?.layout?.regions.filter((region) => region.landmark === 'main')
    ).toHaveLength(1)
  })
})
