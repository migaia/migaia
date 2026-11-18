import type { IBehavior } from '@migaia/part-contract'
import { LAYER_Z_INDEX } from './layer-constants.ts'
import type { StyleSheetWriter } from './stylesheet.ts'

/** How an open part is displayed. */
const LayerMode = { modal: 'modal', popover: 'popover', stacked: 'stacked' } as const

/** One display mode. */
type LayerMode = keyof typeof LayerMode

/** One open part on the layer stack. */
type ILayerEntry = {
  readonly address: string
  readonly element: HTMLElement
  readonly mode: LayerMode
  readonly behavior: IBehavior
  readonly onDismiss: (address: string) => void
}

/**
 * Page-level layer manager for host-managed parts. Modal top-layer parts use `showModal`, parts
 * opened above any top-layer element use popovers, others get a semantic z-index through the style
 * sheet. Escape closes only the top of the stack.
 */
export class LayerManager {
  /** Open parts in opening order. */
  readonly #stack: ILayerEntry[] = []
  /** Style writer used for stacked z-index rules. */
  readonly #styles: StyleSheetWriter
  /** Whether the document listeners (Escape keydown, outside pointerdown) are installed. */
  #listening = false

  /** Binds the manager to the host style writer. */
  constructor(styles: StyleSheetWriter) {
    this.#styles = styles
  }

  /** Opens a part; opening an open address again does nothing. */
  open(
    address: string,
    element: HTMLElement,
    behavior: IBehavior,
    onDismiss: (address: string) => void
  ): void {
    if (this.#stack.some((entry) => entry.address === address)) return
    /** Display mode for this part. */
    const mode = this.#modeOf(element, behavior)
    if (mode === LayerMode.modal) {
      ;(element as HTMLDialogElement).showModal()
      element.addEventListener('cancel', this)
    } else if (mode === LayerMode.popover) {
      element.popover = 'manual'
      element.showPopover()
    } else {
      /** Semantic level; parts without one use the dropdown level. */
      const level =
        behavior.layer === undefined || behavior.layer === 'top' ? 'dropdown' : behavior.layer
      this.#styles.setStacking(address, LAYER_Z_INDEX[level] + this.#stack.length)
    }
    this.#stack.push({ address, element, mode, behavior, onDismiss })
    this.#listen()
  }

  /** Closes a part; an address that is not open is ignored. */
  close(address: string): void {
    /** Position of the address on the stack. */
    const position = this.#stack.findIndex((entry) => entry.address === address)
    if (position === -1) return
    /** Entry being closed. */
    const [entry] = this.#stack.splice(position, 1) as [ILayerEntry]
    if (entry.mode === LayerMode.modal) {
      entry.element.removeEventListener('cancel', this)
      if ((entry.element as HTMLDialogElement).open) (entry.element as HTMLDialogElement).close()
    } else if (entry.mode === LayerMode.popover) {
      if (entry.element.matches(':popover-open')) entry.element.hidePopover()
    } else this.#styles.setStacking(address, undefined)
  }

  /** Address on top of the stack. */
  top(): string | undefined {
    return this.#stack[this.#stack.length - 1]?.address
  }

  /** Closes every open part in reverse order and removes the document listener. */
  closeAll(): void {
    while (this.#stack.length > 0)
      this.close((this.#stack[this.#stack.length - 1] as ILayerEntry).address)
    if (this.#listening) {
      document.removeEventListener('keydown', this, true)
      document.removeEventListener('pointerdown', this, true)
    }
    this.#listening = false
  }

  /** Handles Escape keydown, outside pointerdown and the native dialog cancel event. */
  handleEvent(event: Event): void {
    if (event.type === 'pointerdown') {
      this.#dismissOutside(event as PointerEvent)
      return
    }
    if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return
    /** Top entry. */
    const top = this.#stack[this.#stack.length - 1]
    if (top === undefined || top.behavior.dismiss?.escape === false) return
    event.preventDefault()
    event.stopPropagation()
    this.close(top.address)
    top.onDismiss(top.address)
  }

  /**
   * Closes the top part when `dismiss.outside` is set and the pointer went down outside it. Only
   * the top closes, like Escape. The event is not cancelled, so the outside click still reaches its
   * target.
   */
  #dismissOutside(event: PointerEvent): void {
    /** Top entry. */
    const top = this.#stack[this.#stack.length - 1]
    if (top === undefined || top.behavior.dismiss?.outside !== true) return
    if (!isOutside(top, event)) return
    this.close(top.address)
    top.onDismiss(top.address)
  }

  /** Chooses the display mode of a part. */
  #modeOf(element: HTMLElement, behavior: IBehavior): LayerMode {
    if (behavior.layer === 'top' && element instanceof HTMLDialogElement) return LayerMode.modal
    if (behavior.layer === 'top' || this.#stack.some((entry) => entry.mode !== LayerMode.stacked))
      return LayerMode.popover
    return LayerMode.stacked
  }

  /** Installs the capturing Escape listener once. */
  #listen(): void {
    if (this.#listening) return
    document.addEventListener('keydown', this, true)
    document.addEventListener('pointerdown', this, true)
    this.#listening = true
  }
}

/**
 * Whether a pointer event lies outside an open part. A modal dialog receives clicks on its own
 * `::backdrop`, so for modal entries a hit on the dialog itself is tested against its box.
 */
function isOutside(entry: ILayerEntry, event: PointerEvent): boolean {
  if (!event.composedPath().includes(entry.element)) return true
  if (entry.mode !== LayerMode.modal || event.target !== entry.element) return false
  /** Box of the dialog. */
  const box = entry.element.getBoundingClientRect()
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
}
