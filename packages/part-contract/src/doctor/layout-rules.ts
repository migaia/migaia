import { LayoutProp } from '../layout.ts'
import { isRecord } from '../record.ts'
import { defineRule, type IRuleContext } from '../rules.ts'
import type { ILayoutBehavior, IPartAddress, IPartNode } from '../types.ts'
import { isDeriveBinding, isStateBinding, partOf, target } from './shared.ts'

/** Both built-in phases; layout structure holds before and after enhancement. */
const BOTH = ['authored', 'resolved'] as const

/** Layout behaviour group of a node's part definition, when it has one. */
function layoutOf(context: IRuleContext<unknown>, node: IPartNode): ILayoutBehavior | undefined {
  return partOf(context, node)?.behavior?.layout
}

/**
 * Reports every outermost layout after the first. A layout is outermost when no ancestor is a
 * layout. Index entries come in document order, so a parent is classified before its children; one
 * pass with a map, O(n).
 */
function checkSingleMain(context: IRuleContext<unknown>): void {
  /** Per address: whether the node is a layout or sits inside one. */
  const insideLayout = new Map<IPartAddress, boolean>()
  /** Whether an outermost layout has been seen already. */
  let seen = false
  for (const entry of context.index.entries()) {
    /** Whether an ancestor is a layout. */
    const nested = entry.parent !== undefined && insideLayout.get(entry.parent) === true
    /** Whether this node is a layout. */
    const isLayout = layoutOf(context, entry.node) !== undefined
    insideLayout.set(entry.address, nested || isLayout)
    if (!isLayout || nested) continue
    if (seen)
      context.report({
        address: entry.address,
        facet: 'tag',
        path: '',
        messageKey: 'layout.single-main'
      })
    seen = true
  }
}

/** Reports slot names on a layout node that are not regions of the layout. */
function checkRegionUnknown(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Layout of the node's definition. */
  const layout = layoutOf(context, node)
  if (layout === undefined) return
  /** Region names of the layout. */
  const names = new Set(layout.regions.map((region) => region.name))
  for (const slot of Object.keys(node.facets?.slots ?? {}))
    if (!names.has(slot))
      context.report({ address, facet: 'slots', path: slot, messageKey: 'layout.region-unknown' })
}

/**
 * Checks `props.sizes` of a layout node: each key names a resizable region and each value is a
 * number inside that region's `[min, max]`. Binding values are left to runtime.
 */
function checkSizeRange(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  /** Layout of the node's definition. */
  const layout = layoutOf(context, node)
  /** Authored initial sizes. */
  const sizes = node.facets?.props?.[LayoutProp.sizes]
  if (
    layout === undefined ||
    sizes === undefined ||
    isStateBinding(sizes) ||
    isDeriveBinding(sizes)
  )
    return
  if (!isRecord(sizes)) {
    context.report({
      address,
      facet: 'props',
      path: LayoutProp.sizes,
      messageKey: 'layout.size-range'
    })
    return
  }
  /** Regions by name. */
  const regions = new Map(layout.regions.map((region) => [region.name, region]))
  for (const [name, value] of Object.entries(sizes)) {
    /** Region the size targets. */
    const region = regions.get(name)
    /** Declared range of the region. */
    const size = region?.size
    if (
      region?.resizable === true &&
      typeof value === 'number' &&
      size?.min !== undefined &&
      size.max !== undefined &&
      value >= size.min &&
      value <= size.max
    )
      continue
    context.report({
      address,
      facet: 'props',
      path: `${LayoutProp.sizes}.${name}`,
      messageKey: 'layout.size-range'
    })
  }
}

/** Layout rules; three rules in total. */
export const layoutRules = [
  defineRule({
    id: 'layout.single-main',
    scope: 'blueprint',
    phase: BOTH,
    severity: 'error',
    check: checkSingleMain
  }),
  defineRule({
    id: 'layout.region-unknown',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkRegionUnknown
  }),
  defineRule({
    id: 'layout.size-range',
    scope: 'part',
    phase: BOTH,
    severity: 'error',
    check: checkSizeRange
  })
]
