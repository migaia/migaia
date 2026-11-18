import { formatAddress } from '@migaia/part-contract'
import type { IStyleRule } from '@migaia/part-host'
import { PartDomErrorCode } from './error-code.ts'
import { PartDomErrorText } from './error-text.ts'
import { createPartDomError } from './errors.ts'
import { ADDRESS_ATTRIBUTE, STYLE_LAYERS, type IStyleLayer } from './layer-constants.ts'
import { LayoutAttribute } from './layout/constants.ts'

/** One stored rule with the property names it currently sets. */
type IRuleEntry = {
  rule: CSSStyleRule
  readonly names: Set<string>
  readonly layer: IStyleLayer
  readonly selector: string
}

/**
 * One rule of the `layout` layer. `target` names the layout root, the skip link, or a region,
 * separator or toggle by region name; `state: 'focus-visible'` applies the rule only while that
 * element shows keyboard focus. Selectors are generated here; callers never write selector text.
 */
export type ILayoutRule = {
  readonly target: 'root' | 'skip' | `region:${string}` | `separator:${string}` | `toggle:${string}`
  readonly state?: 'focus-visible'
  readonly declarations: Readonly<Record<string, string>>
}

/** Child attribute per target kind of a layout rule; three kinds, fixed. */
const LAYOUT_TARGET_ATTRIBUTE = {
  region: LayoutAttribute.region,
  separator: LayoutAttribute.separator,
  toggle: LayoutAttribute.toggle
} as const

/** Selector of exactly one address, without template-row instances. */
function exactSelector(address: string): string {
  return `[${ADDRESS_ATTRIBUTE}="${CSS.escape(address)}"]`
}

/**
 * Selector of a layout rule target. Region, separator, toggle and skip elements are direct children
 * of the layout root, so a nested layout's elements never match.
 */
function layoutSelector(address: string, rule: ILayoutRule): string {
  /** Root selector. */
  const root = exactSelector(address)
  /** Pseudo-class suffix for the optional state. */
  const state = rule.state === 'focus-visible' ? ':focus-visible' : ''
  if (rule.target === 'root') return `${root}${state}`
  if (rule.target === 'skip') return `${root} > [${LayoutAttribute.skip}]${state}`
  /** Position of the kind separator. */
  const colon = rule.target.indexOf(':')
  /** Target kind. */
  const kind = rule.target.slice(0, colon) as keyof typeof LAYOUT_TARGET_ATTRIBUTE
  return `${root} > [${LAYOUT_TARGET_ATTRIBUTE[kind]}="${CSS.escape(rule.target.slice(colon + 1))}"]${state}`
}

/**
 * Selector of one address, escaped for attribute values. It also matches every template-row
 * instance of the address (`<address>@row:<key>`), so one rule styles all rows.
 */
function selectorOf(address: string): string {
  /** Row-instance prefix of the address: the address followed by the empty-key row marker. */
  const rowPrefix = formatAddress({ segments: address.split('/'), rowKey: '' })
  return `[${ADDRESS_ATTRIBUTE}="${CSS.escape(address)}"], [${ADDRESS_ATTRIBUTE}^="${CSS.escape(rowPrefix)}"]`
}

/**
 * One constructable style sheet per host. Rules are kept per (layer, address) and updated in place
 * through CSSOM; removal empties rules and compacts when more than half are empty.
 */
export class StyleSheetWriter {
  /** The host's sheet, created on first use so installing the plugin touches no DOM global. */
  #created: CSSStyleSheet | undefined
  /** Rules by layer and address. */
  readonly #entries = new Map<string, IRuleEntry>()
  /** Layout-layer entry keys per layout address, so a new rule set can clear the old one. */
  readonly #layoutKeys = new Map<string, Set<string>>()
  /** Number of emptied entries awaiting compaction. */
  #empty = 0
  /** Whether the sheet is attached to the document. */
  #attached = false

  /**
   * The sheet, created with the fixed layer order on first use. Throws `STYLESHEET_UNSUPPORTED`
   * when the environment has no constructable style sheets.
   */
  get #sheet(): CSSStyleSheet {
    if (this.#created !== undefined) return this.#created
    try {
      this.#created = new CSSStyleSheet()
    } catch (cause) {
      throw createPartDomError(
        PartDomErrorCode.stylesheetUnsupported,
        PartDomErrorText.stylesheetUnsupported,
        cause
      )
    }
    this.#created.replaceSync(`@layer ${STYLE_LAYERS.join(', ')};`)
    return this.#created
  }

  /** Replaces the declarations of each rule's (layer, address). */
  apply(rules: readonly IStyleRule[]): void {
    for (const rule of rules) this.#setAddress(rule.layer, rule.address, rule.declarations)
  }

  /** Sets or clears the layer-manager z-index of an address. */
  setStacking(address: string, zIndex: number | undefined): void {
    this.#setAddress('stacking', address, zIndex === undefined ? {} : { 'z-index': String(zIndex) })
  }

  /**
   * Replaces the `layout` layer rules of a layout address. Targets missing from `rules` are
   * emptied; an empty list clears the address. Only the `layout` layer is written.
   */
  setLayout(address: string, rules: readonly ILayoutRule[]): void {
    /** Keys written by this call. */
    const next = new Set<string>()
    for (const rule of rules) {
      /** Selector of the rule. */
      const selector = layoutSelector(address, rule)
      /** Entry key. */
      const key = `layout\u0000${selector}`
      next.add(key)
      this.#set('layout', key, selector, rule.declarations)
    }
    for (const key of this.#layoutKeys.get(address) ?? [])
      if (!next.has(key)) this.#set('layout', key, key.slice(key.indexOf('\u0000') + 1), {})
    if (next.size === 0) this.#layoutKeys.delete(address)
    else this.#layoutKeys.set(address, next)
  }

  /** Empties every layer of an address, including its layout rules. */
  remove(address: string): void {
    for (const layer of STYLE_LAYERS) this.#setAddress(layer, address, {})
    this.setLayout(address, [])
  }

  /** Detaches the sheet from the document. */
  detach(): void {
    if (!this.#attached) return
    /** Sheet being detached; attached implies created. */
    const own = this.#created
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== own)
    this.#attached = false
  }

  /** Writes the (layer, address) rule that also matches template-row instances. */
  #setAddress(
    layer: IStyleLayer,
    address: string,
    declarations: Readonly<Record<string, string>>
  ): void {
    this.#set(layer, `${layer}\u0000${address}`, selectorOf(address), declarations)
  }

  /** Writes one keyed rule; an empty declaration map empties it. */
  #set(
    layer: IStyleLayer,
    key: string,
    selector: string,
    declarations: Readonly<Record<string, string>>
  ): void {
    /** Existing entry. */
    let entry = this.#entries.get(key)
    /** Whether the new declarations are empty. */
    const empty = Object.keys(declarations).length === 0
    if (entry === undefined) {
      if (empty) return
      entry = { rule: this.#insert(layer, selector), names: new Set(), layer, selector }
      this.#entries.set(key, entry)
    }
    /** Whether the entry was empty before this write. */
    const wasEmpty = entry.names.size === 0
    for (const name of entry.names)
      if (!(name in declarations)) entry.rule.style.removeProperty(name)
    entry.names.clear()
    for (const [name, value] of Object.entries(declarations)) {
      entry.rule.style.setProperty(name, value)
      entry.names.add(name)
    }
    if (empty && !wasEmpty) this.#empty += 1
    if (!empty && wasEmpty) this.#empty -= 1
    if (this.#empty * 2 > this.#entries.size) this.#compact()
  }

  /** Appends a rule inside its cascade layer and returns the style rule. */
  #insert(layer: IStyleLayer, selector: string): CSSStyleRule {
    this.#attach()
    /** Index of the new layer block. */
    const index = this.#sheet.insertRule(
      `@layer ${layer} { ${selector} {} }`,
      this.#sheet.cssRules.length
    )
    return (this.#sheet.cssRules[index] as CSSLayerBlockRule).cssRules[0] as CSSStyleRule
  }

  /** Rebuilds the sheet without empty rules. */
  #compact(): void {
    /** Entries that still set properties, with their keys. */
    const live = [...this.#entries].filter(([, entry]) => entry.names.size > 0)
    this.#sheet.replaceSync(`@layer ${STYLE_LAYERS.join(', ')};`)
    this.#entries.clear()
    this.#empty = 0
    for (const [key, entry] of live) {
      /** Declarations to restore. */
      const declarations: Record<string, string> = {}
      for (const name of entry.names) declarations[name] = entry.rule.style.getPropertyValue(name)
      entry.rule = this.#insert(entry.layer, entry.selector)
      entry.names.clear()
      for (const [name, value] of Object.entries(declarations)) {
        entry.rule.style.setProperty(name, value)
        entry.names.add(name)
      }
      this.#entries.set(key, entry)
    }
  }

  /** Adds the sheet to the document once. */
  #attach(): void {
    if (this.#attached) return
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.#sheet]
    this.#attached = true
  }
}
