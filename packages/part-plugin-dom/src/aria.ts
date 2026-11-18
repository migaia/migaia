import type { IResolvedNode } from '@migaia/part-host'
import { ADDRESS_ATTRIBUTE } from './layer-constants.ts'

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET = 0x811c9dc5
/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193

/** Stable element id for an address: `part-` plus the FNV-1a hash of the address. */
export function idForAddress(address: string): string {
  /** Running hash. */
  let hash = FNV_OFFSET
  for (let index = 0; index < address.length; index += 1) {
    hash ^= address.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return `part-${hash.toString(16).padStart(8, '0')}`
}

/** Element rendered for an address, if present. */
function elementAt(address: string): Element | null {
  return document.querySelector(`[${ADDRESS_ATTRIBUTE}="${CSS.escape(address)}"]`)
}

/**
 * Writes derived aria and tab index onto rendered elements. Relations resolve to the target's id,
 * or to the id the target will receive when it renders later, so application order does not
 * matter.
 */
export class AriaWriter {
  /** Applies address, id, relation aria and tab index of a resolved node to its element. */
  apply(element: Element, node: IResolvedNode): void {
    element.setAttribute(ADDRESS_ATTRIBUTE, node.address)
    if (element.id === '') element.id = idForAddress(node.address)
    for (const [name, target] of Object.entries(node.derivedAria)) {
      /** Target element if already rendered. */
      const rendered = elementAt(target)
      element.setAttribute(
        `aria-${name}`,
        rendered !== null && rendered.id !== '' ? rendered.id : idForAddress(target)
      )
    }
    if (node.tabIndex !== undefined) element.setAttribute('tabindex', String(node.tabIndex))
  }
}
