import type { IStyleRule } from '@migaia/part-host'
import { PartDomErrorCode } from './error-code.ts'
import { PartDomErrorText } from './error-text.ts'
import { createPartDomError } from './errors.ts'
import { ADDRESS_ATTRIBUTE, STYLE_LAYERS, type IStyleLayer } from './layer-constants.ts'

/** One stored rule with the property names it currently sets. */
type IRuleEntry = {
  rule: CSSStyleRule
  readonly names: Set<string>
  readonly layer: IStyleLayer
  readonly address: string
}

/** Selector of one address, escaped for attribute values. */
function selectorOf(address: string): string {
  return `[${ADDRESS_ATTRIBUTE}="${CSS.escape(address)}"]`
}

/**
 * One constructable style sheet per host. Rules are kept per (layer, address) and updated in place
 * through CSSOM; removal empties rules and compacts when more than half are empty.
 */
export class StyleSheetWriter {
  /** The host's sheet. */
  readonly #sheet: CSSStyleSheet
  /** Rules by layer and address. */
  readonly #entries = new Map<string, IRuleEntry>()
  /** Number of emptied entries awaiting compaction. */
  #empty = 0
  /** Whether the sheet is attached to the document. */
  #attached = false

  /** Creates the sheet with the fixed layer order. */
  constructor() {
    try {
      this.#sheet = new CSSStyleSheet()
    } catch (cause) {
      throw createPartDomError(
        PartDomErrorCode.stylesheetUnsupported,
        PartDomErrorText.stylesheetUnsupported,
        cause
      )
    }
    this.#sheet.replaceSync(`@layer ${STYLE_LAYERS.join(', ')};`)
  }

  /** Replaces the declarations of each rule's (layer, address). */
  apply(rules: readonly IStyleRule[]): void {
    for (const rule of rules) this.#set(rule.layer, rule.address, rule.declarations)
  }

  /** Sets or clears the layer-manager z-index of an address. */
  setStacking(address: string, zIndex: number | undefined): void {
    this.#set('stacking', address, zIndex === undefined ? {} : { 'z-index': String(zIndex) })
  }

  /** Empties every layer of an address. */
  remove(address: string): void {
    for (const layer of STYLE_LAYERS) this.#set(layer, address, {})
  }

  /** Detaches the sheet from the document. */
  detach(): void {
    if (!this.#attached) return
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => sheet !== this.#sheet
    )
    this.#attached = false
  }

  /** Writes one (layer, address) rule; an empty declaration map empties it. */
  #set(layer: IStyleLayer, address: string, declarations: Readonly<Record<string, string>>): void {
    /** Entry key. */
    const key = `${layer}\u0000${address}`
    /** Existing entry. */
    let entry = this.#entries.get(key)
    /** Whether the new declarations are empty. */
    const empty = Object.keys(declarations).length === 0
    if (entry === undefined) {
      if (empty) return
      entry = { rule: this.#insert(layer, address), names: new Set(), layer, address }
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
  #insert(layer: IStyleLayer, address: string): CSSStyleRule {
    this.#attach()
    /** Index of the new layer block. */
    const index = this.#sheet.insertRule(
      `@layer ${layer} { ${selectorOf(address)} {} }`,
      this.#sheet.cssRules.length
    )
    return (this.#sheet.cssRules[index] as CSSLayerBlockRule).cssRules[0] as CSSStyleRule
  }

  /** Rebuilds the sheet without empty rules. */
  #compact(): void {
    /** Entries that still set properties. */
    const live = [...this.#entries.values()].filter((entry) => entry.names.size > 0)
    this.#sheet.replaceSync(`@layer ${STYLE_LAYERS.join(', ')};`)
    this.#entries.clear()
    this.#empty = 0
    for (const entry of live) {
      /** Declarations to restore. */
      const declarations: Record<string, string> = {}
      for (const name of entry.names) declarations[name] = entry.rule.style.getPropertyValue(name)
      entry.rule = this.#insert(entry.layer, entry.address)
      entry.names.clear()
      for (const [name, value] of Object.entries(declarations)) {
        entry.rule.style.setProperty(name, value)
        entry.names.add(name)
      }
      this.#entries.set(`${entry.layer}\u0000${entry.address}`, entry)
    }
  }

  /** Adds the sheet to the document once. */
  #attach(): void {
    if (this.#attached) return
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.#sheet]
    this.#attached = true
  }
}
