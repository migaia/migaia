import { FOCUSABLE } from '../layer-constants.ts'
import { LayoutAttribute } from './constants.ts'

/**
 * Turns one collapsible region into a drawer and back. The drawer is the browser Popover API:
 * `popover="auto"` on the region and `popovertarget` on the toggle give top-layer display,
 * toggle-to-close, Escape and outside-click dismissal. Opening moves focus into the region; closing
 * while focus is inside returns it to the toggle.
 */
export class CollapseControl {
  /** Region element. */
  readonly #region: HTMLElement
  /** Toggle button. */
  readonly #toggle: HTMLElement
  /** Whether the region is currently collapsed. */
  #collapsed = false

  /** Writes the toggle label and starts listening to drawer toggles. */
  constructor(region: HTMLElement, toggle: HTMLElement, label: string) {
    this.#region = region
    this.#toggle = toggle
    // A renderer usually writes the label itself; only fill an empty toggle so text nodes the
    // renderer owns are never replaced.
    if (toggle.childNodes.length === 0) toggle.textContent = label
    toggle.setAttribute('aria-label', label)
    if (toggle instanceof HTMLButtonElement) toggle.type = 'button'
    region.addEventListener('toggle', this)
  }

  /** Whether the region is collapsed. */
  get collapsed(): boolean {
    return this.#collapsed
  }

  /** Collapses the region into a closed drawer. */
  collapse(): void {
    if (this.#collapsed) return
    this.#collapsed = true
    this.#region.setAttribute(LayoutAttribute.collapsed, 'true')
    this.#region.popover = 'auto'
    this.#toggle.setAttribute('popovertarget', this.#region.id)
    this.#toggle.setAttribute('aria-expanded', 'false')
  }

  /** Restores the region; an open drawer is closed first. */
  expand(): void {
    if (!this.#collapsed) return
    this.#collapsed = false
    if (this.#region.matches(':popover-open')) this.#region.hidePopover()
    this.#region.removeAttribute('popover')
    this.#region.removeAttribute(LayoutAttribute.collapsed)
    this.#toggle.removeAttribute('popovertarget')
    this.#toggle.removeAttribute('aria-expanded')
  }

  /** Expands and stops listening; safe to call twice. */
  release(): void {
    this.expand()
    this.#region.removeEventListener('toggle', this)
  }

  /** Reacts to the drawer opening or closing. */
  handleEvent(event: Event): void {
    // A close that follows `expand()` arrives after the region left drawer mode; nothing to do.
    if (!this.#collapsed) return
    /** New drawer state. */
    const open = (event as ToggleEvent).newState === 'open'
    this.#toggle.setAttribute('aria-expanded', String(open))
    if (open) {
      focusInto(this.#region)
      return
    }
    /** Element holding focus when the drawer closed. */
    const active = this.#region.ownerDocument.activeElement
    if (
      active === null ||
      active === this.#region.ownerDocument.body ||
      this.#region.contains(active)
    )
      this.#toggle.focus()
  }
}

/** Focuses the first focusable element of a container, or the container itself. */
export function focusInto(container: HTMLElement): void {
  /** First focusable descendant. */
  const target = container.querySelector<HTMLElement>(FOCUSABLE)
  if (target !== null) {
    target.focus()
    return
  }
  container.tabIndex = -1
  container.focus()
}
