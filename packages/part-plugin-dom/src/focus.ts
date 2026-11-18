import type { IBehavior } from '@migaia/part-contract'
import { ADDRESS_ATTRIBUTE, FOCUSABLE } from './layer-constants.ts'

/** Saved state of one open part. */
type IOpenFocus = {
  readonly previous: Element | null
  readonly previousAddress: string | undefined
  readonly inert: readonly (readonly [HTMLElement, boolean])[]
}

/** Address carried by an element or its nearest addressed ancestor. */
function addressOf(element: Element | null): string | undefined {
  return element?.closest(`[${ADDRESS_ATTRIBUTE}]`)?.getAttribute(ADDRESS_ATTRIBUTE) ?? undefined
}

/** Element rendered for an address. */
function elementAt(address: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${ADDRESS_ATTRIBUTE}="${CSS.escape(address)}"]`)
}

/** True for a layer value that makes a part modal. */
function isModal(behavior: IBehavior): boolean {
  return behavior.layer === 'top' || behavior.layer === 'modal'
}

/**
 * Page-level focus manager for host-managed parts: restore stack, inert background for modal parts,
 * initial focus, and a fallback that never leaves focus on the body.
 */
export class FocusManager {
  /** Open parts by address. */
  readonly #open = new Map<string, IOpenFocus>()

  /** Records the restore target, makes the background inert for modal parts, and moves focus in. */
  open(address: string, element: HTMLElement, behavior: IBehavior): void {
    if (this.#open.has(address)) return
    /** Element focused before opening. */
    const previous = behavior.focus?.restore === true ? document.activeElement : null
    /** Top-level siblings made inert, with their previous value. */
    const inert: (readonly [HTMLElement, boolean])[] = []
    if (isModal(behavior))
      for (const child of Array.from(document.body.children))
        if (child instanceof HTMLElement && !child.contains(element) && !element.contains(child)) {
          inert.push([child, child.inert])
          child.inert = true
        }
    this.#open.set(address, { previous, previousAddress: addressOf(previous), inert })
    this.#focusInside(element, behavior.focus?.initial)
  }

  /** Restores inert values and focus; a removed target falls back to a nearby focusable element. */
  close(address: string): void {
    /** State saved at open. */
    const state = this.#open.get(address)
    if (state === undefined) return
    this.#open.delete(address)
    for (const [element, value] of state.inert) element.inert = value
    if (state.previous instanceof HTMLElement && state.previous.isConnected) {
      state.previous.focus()
      return
    }
    if (state.previous !== null) this.#fallback(state.previousAddress)
  }

  /** Focuses the element of an address. */
  setInitial(address: string): void {
    elementAt(address)?.focus()
  }

  /** Focuses the initial target or the first focusable descendant. */
  #focusInside(element: HTMLElement, initial: string | undefined): void {
    /** Requested initial element. */
    const target =
      (initial !== undefined ? elementAt(initial) : null) ??
      element.querySelector<HTMLElement>(FOCUSABLE) ??
      element
    target.focus()
  }

  /** Focuses the closest still-present element along the removed target's address, never the body. */
  #fallback(address: string | undefined): void {
    /** Address segments walked from the removed element toward the root. */
    const segments = address?.split('/') ?? []
    while (segments.length > 0) {
      segments.pop()
      /** Ancestor container at this depth. */
      const container = segments.length === 0 ? null : elementAt(segments.join('/'))
      /** First focusable element inside it. */
      const candidate = container?.querySelector<HTMLElement>(FOCUSABLE)
      if (candidate !== null && candidate !== undefined) {
        candidate.focus()
        return
      }
    }
    document.body.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }
}
