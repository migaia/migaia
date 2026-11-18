import { isValidName } from './address.ts'
import { PartContractErrorCode } from './error-code.ts'
import { LayoutInvalidReason, PartContractErrorText } from './error-text.ts'
import { createPartContractError } from './errors.ts'
import { isRecord } from './record.ts'
import type { ILandmark } from './types.ts'

/**
 * HTML element each landmark renders as. The single declaration of this mapping: the React renderer
 * creates region elements from it and the DOM plugin reads it back. Six keys, fixed.
 */
export const LandmarkElement = {
  banner: 'header',
  navigation: 'nav',
  main: 'main',
  complementary: 'aside',
  contentinfo: 'footer',
  region: 'section'
} as const satisfies Record<ILandmark, string>

/**
 * Prop names a layout node accepts in a blueprint. `sizes` gives initial pixel sizes of resizable
 * regions, `labels` overrides region labels (localisation), `skipLabel` is the skip link text. The
 * DOM plugin, the renderer and the layout rules read the names from here only.
 */
export const LayoutProp = {
  sizes: 'sizes',
  labels: 'labels',
  skipLabel: 'skipLabel'
} as const

/** Props a layout node accepts; keys are the values of `LayoutProp`. */
export type ILayoutProps = {
  readonly sizes?: Readonly<Record<string, number>>
  readonly labels?: Readonly<Record<string, string>>
  readonly skipLabel?: string
}

/** Grammar of a fractional track size such as `1fr` or `2.5fr`. */
const FR_PATTERN = /^\d+(\.\d+)?fr$/

/** Throws `DESCRIPTOR_INVALID` naming the region and the reason. */
function layoutInvalid(region: string, reason: string): never {
  throw createPartContractError(
    PartContractErrorCode.descriptorInvalid,
    PartContractErrorText.layoutInvalid(region, reason)
  )
}

/** True when a value is a finite number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** True when a size default is pixels, `auto` or `<n>fr`. */
function isSizeDefault(value: unknown): boolean {
  return (
    isFiniteNumber(value) ||
    value === 'auto' ||
    (typeof value === 'string' && FR_PATTERN.test(value))
  )
}

/** Validates one region's size, resizability and collapse settings. */
function checkRegionSize(name: string, region: Record<string, unknown>): void {
  /** Declared size, when present. */
  const size = region.size
  if (size !== undefined) {
    if (
      !isRecord(size) ||
      !isSizeDefault(size.default) ||
      (size.min !== undefined && !isFiniteNumber(size.min)) ||
      (size.max !== undefined && !isFiniteNumber(size.max))
    )
      layoutInvalid(name, LayoutInvalidReason.size)
    if (isFiniteNumber(size.min) && isFiniteNumber(size.max) && size.min > size.max)
      layoutInvalid(name, LayoutInvalidReason.range)
    if (
      isFiniteNumber(size.default) &&
      ((isFiniteNumber(size.min) && size.default < size.min) ||
        (isFiniteNumber(size.max) && size.default > size.max))
    )
      layoutInvalid(name, LayoutInvalidReason.defaultRange)
  }
  if (
    region.resizable === true &&
    (!isRecord(size) ||
      !isFiniteNumber(size.default) ||
      !isFiniteNumber(size.min) ||
      !isFiniteNumber(size.max))
  )
    layoutInvalid(name, LayoutInvalidReason.resizable)
  if (region.collapseBelow === undefined) return
  if (!isFiniteNumber(region.collapseBelow)) layoutInvalid(name, LayoutInvalidReason.collapseBelow)
  if (region.landmark === 'main') layoutInvalid(name, LayoutInvalidReason.mainCollapse)
  if (typeof region.label !== 'string' || region.label === '')
    layoutInvalid(name, LayoutInvalidReason.collapseLabel)
}

/** True when a value names one of the six landmarks. */
function isLandmark(value: unknown): value is ILandmark {
  return typeof value === 'string' && Object.hasOwn(LandmarkElement, value)
}

/**
 * Validates a `behavior.layout` group: shape, unique region names, exactly one `main`, sizes,
 * resizability, collapse rules and labels on repeated landmarks. Throws `DESCRIPTOR_INVALID`. One
 * pass over the regions plus one pass over the landmark counts; O(regions).
 */
export function checkLayoutBehavior(layout: unknown): void {
  if (
    !isRecord(layout) ||
    (layout.direction !== 'row' && layout.direction !== 'column') ||
    !Array.isArray(layout.regions) ||
    layout.regions.length === 0 ||
    (layout.skipLink !== undefined && typeof layout.skipLink !== 'boolean')
  )
    layoutInvalid('', LayoutInvalidReason.shape)
  /** Region names seen so far. */
  const names = new Set<string>()
  /** Number of regions per landmark. */
  const landmarks = new Map<ILandmark, number>()
  for (const region of layout.regions as unknown[]) {
    if (!isRecord(region) || typeof region.name !== 'string' || !isLandmark(region.landmark))
      layoutInvalid(isRecord(region) ? String(region.name) : '', LayoutInvalidReason.region)
    if (!isValidName(region.name)) layoutInvalid(region.name, LayoutInvalidReason.region)
    if (
      (region.label !== undefined && typeof region.label !== 'string') ||
      (region.resizable !== undefined && typeof region.resizable !== 'boolean') ||
      (region.scroll !== undefined && typeof region.scroll !== 'boolean')
    )
      layoutInvalid(region.name, LayoutInvalidReason.fieldType)
    if (names.has(region.name)) layoutInvalid(region.name, LayoutInvalidReason.duplicate)
    names.add(region.name)
    landmarks.set(region.landmark, (landmarks.get(region.landmark) ?? 0) + 1)
    checkRegionSize(region.name, region)
  }
  if (landmarks.get('main') !== 1) layoutInvalid('', LayoutInvalidReason.mainCount)
  for (const region of layout.regions as Record<string, unknown>[])
    if (
      (landmarks.get(region.landmark as ILandmark) ?? 0) > 1 &&
      (typeof region.label !== 'string' || region.label === '')
    )
      layoutInvalid(String(region.name), LayoutInvalidReason.landmarkLabel)
}
