import type { ILayoutRegion } from '@migaia/part-contract'
import { SEPARATOR_STEP, SEPARATOR_STEP_LARGE } from './constants.ts'

/** What a separator needs from its layout attachment. */
export type ISeparatorOwner = {
  /** Current width of a resizable region. */
  sizeOf(region: string): number
  /** Applies a width (clamped by the owner) and optionally saves it. */
  resize(region: string, size: number, save: boolean): void
  /** Whether the layout root is laid out right to left. */
  isRtl(): boolean
}

/** Pointer drag in progress. */
type IDrag = { readonly pointerId: number; readonly start: number; readonly startSize: number }

/** Event types a separator listens to; fixed set of five. */
const SEPARATOR_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'lostpointercapture',
  'keydown'
] as const

/**
 * Drives one separator: pointer drags with pointer capture and arrow, Home and End keys. Screen
 * movement maps to region width through `#widthSign`: moving toward main widens the region.
 */
export class SeparatorControl {
  /** Separator element. */
  readonly #element: HTMLElement
  /** Region the separator resizes. */
  readonly #region: ILayoutRegion
  /** +1 when the region comes before main, -1 when after. */
  readonly #order: 1 | -1
  /** Whether the layout runs along columns. */
  readonly #row: boolean
  /** Attachment that owns sizes. */
  readonly #owner: ISeparatorOwner
  /** Active pointer drag, if any. */
  #drag: IDrag | undefined

  /** Writes the separator attributes and installs its listeners. */
  constructor(
    element: HTMLElement,
    region: ILayoutRegion,
    order: 1 | -1,
    row: boolean,
    regionId: string,
    owner: ISeparatorOwner
  ) {
    this.#element = element
    this.#region = region
    this.#order = order
    this.#row = row
    this.#owner = owner
    element.setAttribute('role', 'separator')
    element.setAttribute('aria-orientation', row ? 'vertical' : 'horizontal')
    element.setAttribute('aria-controls', regionId)
    element.setAttribute('aria-valuemin', String(region.size?.min))
    element.setAttribute('aria-valuemax', String(region.size?.max))
    element.tabIndex = 0
    for (const type of SEPARATOR_EVENTS) element.addEventListener(type, this)
  }

  /** Updates `aria-valuenow` after the owner applied a width. */
  show(size: number): void {
    this.#element.setAttribute('aria-valuenow', String(size))
  }

  /** Releases pointer capture and removes the listeners; safe to call twice. */
  release(): void {
    if (this.#drag !== undefined && this.#element.hasPointerCapture(this.#drag.pointerId))
      this.#element.releasePointerCapture(this.#drag.pointerId)
    this.#drag = undefined
    for (const type of SEPARATOR_EVENTS) this.#element.removeEventListener(type, this)
  }

  /** Dispatches pointer and keyboard events. */
  handleEvent(event: Event): void {
    if (event.type === 'keydown') this.#onKey(event as KeyboardEvent)
    else if (event.type === 'pointerdown') this.#onDown(event as PointerEvent)
    else if (event.type === 'pointermove') this.#onMove(event as PointerEvent)
    else this.#onEnd()
  }

  /** Width change per pixel of screen movement toward the right or bottom. */
  get #widthSign(): number {
    return this.#row && this.#owner.isRtl() ? -this.#order : this.#order
  }

  /** Screen coordinate along the layout axis. */
  #coordinate(event: PointerEvent): number {
    return this.#row ? event.clientX : event.clientY
  }

  /** Starts a drag and captures the pointer. */
  #onDown(event: PointerEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    this.#element.setPointerCapture(event.pointerId)
    this.#drag = {
      pointerId: event.pointerId,
      start: this.#coordinate(event),
      startSize: this.#owner.sizeOf(this.#region.name)
    }
  }

  /** Follows the pointer while dragging. */
  #onMove(event: PointerEvent): void {
    if (this.#drag === undefined || event.pointerId !== this.#drag.pointerId) return
    /** Screen movement since the drag started. */
    const moved = this.#coordinate(event) - this.#drag.start
    this.#owner.resize(this.#region.name, this.#drag.startSize + moved * this.#widthSign, false)
  }

  /** Ends a drag and saves the width. */
  #onEnd(): void {
    if (this.#drag === undefined) return
    this.#drag = undefined
    this.#owner.resize(this.#region.name, this.#owner.sizeOf(this.#region.name), true)
  }

  /** Moves the separator by arrow keys, or to the range ends by Home and End. */
  #onKey(event: KeyboardEvent): void {
    /** Region name. */
    const name = this.#region.name
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      /** Range end selected by the key. */
      const end = event.key === 'Home' ? this.#region.size?.min : this.#region.size?.max
      this.#owner.resize(name, end ?? this.#owner.sizeOf(name), true)
      return
    }
    /** Screen direction of the key: +1 right or down, -1 left or up, 0 for other keys. */
    const direction = screenDirection(event.key, this.#row)
    if (direction === 0) return
    event.preventDefault()
    /** Pixels per press. */
    const step = event.shiftKey ? SEPARATOR_STEP_LARGE : SEPARATOR_STEP
    this.#owner.resize(name, this.#owner.sizeOf(name) + direction * step * this.#widthSign, true)
  }
}

/** Screen direction of an arrow key along the layout axis. */
function screenDirection(key: string, row: boolean): number {
  if (row) return key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  return key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
}
