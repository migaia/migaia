import { LayoutProp, type ILayoutBehavior, type ILayoutRegion } from '@migaia/part-contract'
import type { IResolvedNode } from '@migaia/part-host'
import type { StyleSheetWriter } from '../stylesheet.ts'
import { CollapseControl } from './collapse.ts'
import { LayoutAttribute } from './constants.ts'
import { releaseRegionCycle, retainRegionCycle } from './focus-cycle.ts'
import { layoutRegionId } from './ids.ts'
import { layoutRules, mainIndexOf } from './regions.ts'
import { SeparatorControl, type ISeparatorOwner } from './separator.ts'
import { readSavedSize, saveSize, sizeKey } from './storage.ts'

/**
 * Elements a renderer hands to `layout.attach` at commit time. Records are keyed by region name;
 * `separators` holds one element per resizable region and `toggles` one per collapsible region.
 */
export type ILayoutHandle = {
  readonly blueprintId: string
  readonly node: IResolvedNode
  readonly element: HTMLElement
  readonly regions: Readonly<Record<string, HTMLElement>>
  readonly separators: Readonly<Record<string, HTMLElement>>
  readonly toggles: Readonly<Record<string, HTMLElement>>
  readonly skip?: HTMLElement
}

/** A plain string record from a layout prop, or an empty record for bindings and other values. */
function recordProp(node: IResolvedNode, name: string): Readonly<Record<string, unknown>> {
  /** Raw prop value. */
  const value = node.config.props?.[name]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Clamps a width to a resizable region's range. */
function clamp(region: ILayoutRegion, size: number): number {
  return Math.min(region.size?.max ?? size, Math.max(region.size?.min ?? size, size))
}

/**
 * One attached layout: writes region attributes, keeps resizable widths and collapse state, and
 * rewrites the address's `layout` layer rules whenever either changes.
 */
export class LayoutAttachment implements ISeparatorOwner {
  /** Elements of the layout. */
  readonly #handle: ILayoutHandle
  /** Layout behaviour group. */
  readonly #layout: ILayoutBehavior
  /** Host style writer. */
  readonly #styles: StyleSheetWriter
  /** Regions by name. */
  readonly #regions = new Map<string, ILayoutRegion>()
  /** Current widths of resizable regions. */
  readonly #sizes = new Map<string, number>()
  /** Separator controls by region name. */
  readonly #separators = new Map<string, SeparatorControl>()
  /** Collapse controls by region name. */
  readonly #collapses = new Map<string, CollapseControl>()
  /** Names of collapsed regions; mirrors the collapse controls for rule building. */
  readonly #collapsed = new Set<string>()
  /** Width observer of the layout root. */
  readonly #observer: ResizeObserver | undefined
  /** Main region made focusable for the skip link by this attachment; reset on release. */
  #focusableMain: HTMLElement | undefined
  /** Whether `release` ran. */
  #released = false

  /** Prepares the elements, applies initial widths and collapse state, and starts observing. */
  constructor(handle: ILayoutHandle, layout: ILayoutBehavior, styles: StyleSheetWriter) {
    this.#handle = handle
    this.#layout = layout
    this.#styles = styles
    /** Label overrides from the blueprint. */
    const labels = recordProp(handle.node, LayoutProp.labels)
    /** Initial widths from the blueprint. */
    const initial = recordProp(handle.node, LayoutProp.sizes)
    /** Position of main. */
    const main = mainIndexOf(layout)
    layout.regions.forEach((region, index) =>
      this.#prepare(region, index < main ? 1 : -1, labels[region.name], initial[region.name])
    )
    if (handle.skip !== undefined) {
      /** Main region element, focused by the skip link. */
      const mainElement = handle.regions[(layout.regions[main] as ILayoutRegion).name]
      if (mainElement !== undefined && !mainElement.hasAttribute('tabindex')) {
        mainElement.tabIndex = -1
        this.#focusableMain = mainElement
      }
    }
    this.#applyWidth(handle.element.clientWidth, true)
    this.#observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => this.#applyWidth(handle.element.clientWidth))
        : undefined
    this.#observer?.observe(handle.element)
    retainRegionCycle(handle.element.ownerDocument)
  }

  /** Current width of a resizable region. */
  sizeOf(region: string): number {
    return this.#sizes.get(region) ?? 0
  }

  /** Clamps and applies a width, updates the separator, and saves it when asked. */
  resize(name: string, size: number, save: boolean): void {
    /** Region being resized. */
    const region = this.#regions.get(name)
    if (region === undefined || this.#released) return
    /** Width inside the range. */
    const width = clamp(region, size)
    this.#sizes.set(name, width)
    this.#separators.get(name)?.show(width)
    this.#write()
    if (save) saveSize(sizeKey(this.#handle.blueprintId, this.#handle.node.address, name), width)
  }

  /** Whether the layout root is laid out right to left. */
  isRtl(): boolean {
    return getComputedStyle(this.#handle.element).direction === 'rtl'
  }

  /** Stops observing, releases controls, closes drawers and clears the rules; idempotent. */
  release(): void {
    if (this.#released) return
    this.#released = true
    this.#observer?.disconnect()
    for (const separator of this.#separators.values()) separator.release()
    for (const collapse of this.#collapses.values()) collapse.release()
    this.#styles.setLayout(this.#handle.node.address, [])
    this.#focusableMain?.removeAttribute('tabindex')
    releaseRegionCycle(this.#handle.element.ownerDocument)
  }

  /** Writes one region's attributes and sets up its separator and collapse control. */
  #prepare(region: ILayoutRegion, order: 1 | -1, labelOverride: unknown, initial: unknown): void {
    /** Region element. */
    const element = this.#handle.regions[region.name]
    if (element === undefined) return
    this.#regions.set(region.name, region)
    /** Region id shared with the renderer. */
    const id = layoutRegionId(this.#handle.node.address, region.name)
    if (element.id === '') element.id = id
    element.setAttribute(LayoutAttribute.region, region.name)
    /** Effective label. */
    const label = typeof labelOverride === 'string' ? labelOverride : region.label
    if (label !== undefined) element.setAttribute('aria-label', label)
    if (region.resizable === true) this.#prepareSeparator(region, order, initial, element.id)
    /** Toggle element of a collapsible region. */
    const toggle = this.#handle.toggles[region.name]
    if (toggle !== undefined) toggle.setAttribute(LayoutAttribute.toggle, region.name)
    if (region.collapseBelow !== undefined && toggle !== undefined && label !== undefined)
      this.#collapses.set(region.name, new CollapseControl(element, toggle, label))
  }

  /** Chooses the initial width (saved, then blueprint, then default) and wires the separator. */
  #prepareSeparator(region: ILayoutRegion, order: 1 | -1, initial: unknown, id: string): void {
    /** Range of the region; validation guarantees both ends. */
    const min = region.size?.min ?? 0
    /** Upper end of the range. */
    const max = region.size?.max ?? Number.MAX_SAFE_INTEGER
    /** Saved width, if valid. */
    const saved = readSavedSize(
      sizeKey(this.#handle.blueprintId, this.#handle.node.address, region.name),
      min,
      max
    )
    /** Blueprint width, if valid. */
    const authored =
      typeof initial === 'number' && initial >= min && initial <= max ? initial : undefined
    /** Declared default. */
    const fallback = typeof region.size?.default === 'number' ? region.size.default : min
    this.#sizes.set(region.name, saved ?? authored ?? fallback)
    /** Separator element. */
    const element = this.#handle.separators[region.name]
    if (element === undefined) return
    element.setAttribute(LayoutAttribute.separator, region.name)
    /** Control driving the separator. */
    const control = new SeparatorControl(
      element,
      region,
      order,
      this.#layout.direction === 'row',
      id,
      this
    )
    control.show(this.sizeOf(region.name))
    this.#separators.set(region.name, control)
  }

  /**
   * Collapses or expands regions for a root width and rewrites the rules when a region changed
   * state (always when `force`). A width of 0 means the root is not laid out (detached or hidden);
   * collapse state is then left alone until the observer reports a real width.
   */
  #applyWidth(width: number, force = false): void {
    if (this.#released) return
    /** Whether any region changed collapse state. */
    let changed = false
    for (const [name, collapse] of this.#collapses) {
      if (width === 0) break
      /** Whether the region should be collapsed at this width. */
      const shouldCollapse = width < (this.#regions.get(name)?.collapseBelow ?? 0)
      if (shouldCollapse === collapse.collapsed) continue
      changed = true
      if (shouldCollapse) {
        collapse.collapse()
        this.#collapsed.add(name)
      } else {
        collapse.expand()
        this.#collapsed.delete(name)
      }
    }
    if (changed || force) this.#write()
  }

  /** Rewrites every `layout` layer rule of this layout. */
  #write(): void {
    this.#styles.setLayout(
      this.#handle.node.address,
      layoutRules(this.#layout, {
        sizes: this.#sizes,
        collapsed: this.#collapsed,
        skip: this.#handle.skip !== undefined
      })
    )
  }
}

/** Attached layouts of one host, by layout address. */
export class LayoutManager {
  /** Host style writer. */
  readonly #styles: StyleSheetWriter
  /** Live attachments by address. */
  readonly #attached = new Map<string, LayoutAttachment>()

  /** Binds the manager to the host style writer. */
  constructor(styles: StyleSheetWriter) {
    this.#styles = styles
  }

  /**
   * Attaches layout behaviour to rendered elements and returns the undo function. Attaching an
   * address again releases the previous attachment first. A node without a layout group attaches
   * nothing.
   */
  attach(handle: ILayoutHandle): () => void {
    /** Address of the layout. */
    const address = handle.node.address
    this.#attached.get(address)?.release()
    /** Layout group of the node. */
    const layout = handle.node.behavior.layout
    if (layout === undefined) {
      this.#attached.delete(address)
      return () => undefined
    }
    /** New attachment. */
    const attachment = new LayoutAttachment(handle, layout, this.#styles)
    this.#attached.set(address, attachment)
    return () => this.#detach(address, attachment)
  }

  /** Releases every attachment. */
  releaseAll(): void {
    for (const attachment of this.#attached.values()) attachment.release()
    this.#attached.clear()
  }

  /** Releases one attachment and forgets it when it is still the current one. */
  #detach(address: string, attachment: LayoutAttachment): void {
    attachment.release()
    if (this.#attached.get(address) === attachment) this.#attached.delete(address)
  }
}
