import {
  defineModifier,
  type IModifierContext,
  type IModifierDefinition,
  type IModifierInstance
} from '@migaia/part-host'
import { ModifierArgsSchema } from './args-schema.ts'

/** `next` callback of a modifier step. */
type INext = (detail?: unknown) => void

/** Event kinds that every DOM-listening modifier accepts. */
const DOM_AND_CUSTOM = ['dom', 'custom'] as const
/** Event kinds of modifiers that read pointer or keyboard state. */
const DOM_ONLY = ['dom'] as const
/** Default debounce and throttle window in milliseconds. */
const DEFAULT_WINDOW_MS = 300
/** Default long-press hold time in milliseconds. */
const DEFAULT_HOLD_MS = 500
/** Default pointer movement, in pixels, that cancels a long press. */
const DEFAULT_TOLERANCE_PX = 10
/** Default distance, in pixels, a swipe must travel. */
const DEFAULT_SWIPE_PX = 30
/** Default distance, in pixels, before a drag starts. */
const DEFAULT_DRAG_PX = 3

/** Mouse buttons by modifier name, per `MouseEvent.button`. Fixed table of three entries. */
const MOUSE_BUTTONS: Readonly<Record<string, number>> = { left: 0, middle: 1, right: 2 }

/**
 * System keys by modifier id and the `KeyboardEvent`/`MouseEvent` flag each requires. Fixed table
 * of four entries, so `exact` iterates a constant number of keys.
 */
const SYSTEM_KEYS: Readonly<Record<string, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>> = {
  'ctrl@1': 'ctrlKey',
  'shift@1': 'shiftKey',
  'alt@1': 'altKey',
  'meta@1': 'metaKey'
}

/** `stop`: stops propagation, then continues. */
class StopStep implements IModifierInstance {
  /** Stops propagation and continues. */
  handle(event: unknown, next: INext): void {
    ;(event as Event).stopPropagation()
    next()
  }
}

/** `prevent`: cancels the default action, then continues. */
class PreventStep implements IModifierInstance {
  /** Prevents the default and continues. */
  handle(event: unknown, next: INext): void {
    ;(event as Event).preventDefault()
    next()
  }
}

/** `self`: continues only when the event's target is the part element itself. */
class SelfStep implements IModifierInstance {
  /** Continues for events targeting the element. */
  handle(event: unknown, next: INext, element: unknown): void {
    if ((event as Event).target === element) next()
  }
}

/** `outside`: continues only when the event's path does not contain the part element. */
class OutsideStep implements IModifierInstance {
  /** Continues for events outside the element. */
  handle(event: unknown, next: INext, element: unknown): void {
    if (!(event as Event).composedPath().includes(element as EventTarget)) next()
  }
}

/** Continues only for keyboard events whose key is listed. */
class KeyStep implements IModifierInstance {
  /** Accepted `KeyboardEvent.key` values. */
  readonly #keys: readonly string[]

  /** Captures the keys. */
  constructor(keys: readonly string[]) {
    this.#keys = keys
  }

  /** Continues for a listed key. */
  handle(event: unknown, next: INext): void {
    if (event instanceof KeyboardEvent && this.#keys.includes(event.key)) next()
  }
}

/** Continues for an arrow key (keyboard events) or a mouse button (mouse events). */
class DirectionStep implements IModifierInstance {
  /** Arrow key value, or undefined for button-only modifiers. */
  readonly #arrow: string | undefined
  /** Mouse button number. */
  readonly #button: number

  /** Captures the arrow and button. */
  constructor(arrow: string | undefined, button: number) {
    this.#arrow = arrow
    this.#button = button
  }

  /** Continues for the matching key or button. */
  handle(event: unknown, next: INext): void {
    if (event instanceof KeyboardEvent) {
      if (event.key === this.#arrow) next()
      return
    }
    if (event instanceof MouseEvent && event.button === this.#button) next()
  }
}

/** Continues only while a system key is held. */
class SystemKeyStep implements IModifierInstance {
  /** Event flag of the key. */
  readonly #flag: 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'

  /** Captures the flag. */
  constructor(flag: 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey') {
    this.#flag = flag
  }

  /** Continues when the key is held. */
  handle(event: unknown, next: INext): void {
    if ((event as KeyboardEvent)[this.#flag] === true) next()
  }
}

/** `exact`: continues only when exactly the system keys named in the subscription are held. */
class ExactStep implements IModifierInstance {
  /** Ids of the subscription's modifiers. */
  readonly #siblings: readonly string[]

  /** Captures the sibling ids. */
  constructor(siblings: readonly string[]) {
    this.#siblings = siblings
  }

  /** Continues when the held system keys match. */
  handle(event: unknown, next: INext): void {
    // SYSTEM_KEYS has four fixed entries.
    for (const [id, flag] of Object.entries(SYSTEM_KEYS))
      if ((event as KeyboardEvent)[flag] !== this.#siblings.includes(id)) return
    next()
  }
}

/** Places a listener on the element's document in the capture phase. */
function placeOnDocument(element: unknown): {
  readonly target: unknown
  readonly capture: boolean
} {
  return { target: (element as Node).ownerDocument ?? document, capture: true }
}

/** Defines a modifier that continues only for keyboard events with one of the listed keys. */
function keyModifier(name: string, keys: readonly string[]): IModifierDefinition<unknown> {
  return defineModifier({
    id: `${name}@1`,
    title: name,
    eventKinds: DOM_ONLY,
    placement: false,
    create: () => new KeyStep(keys)
  }) as IModifierDefinition<unknown>
}

/** Defines `left`/`right`: an arrow key for keyboard events, a mouse button for mouse events. */
function directionModifier(name: 'left' | 'right', arrow: string): IModifierDefinition<unknown> {
  return defineModifier({
    id: `${name}@1`,
    title: name,
    eventKinds: DOM_ONLY,
    placement: false,
    create: () => new DirectionStep(arrow, MOUSE_BUTTONS[name] as number)
  }) as IModifierDefinition<unknown>
}

/** Defines a modifier requiring one system key to be held. */
function systemKeyModifier(id: string): IModifierDefinition<unknown> {
  /** Event flag of the key. */
  const flag = SYSTEM_KEYS[id] as 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'
  return defineModifier({
    id,
    title: id,
    eventKinds: DOM_ONLY,
    placement: false,
    create: () => new SystemKeyStep(flag)
  }) as IModifierDefinition<unknown>
}

/** Delays `next` until no event arrived for the window; only the latest event continues. */
class DebounceStep implements IModifierInstance {
  /** Window in milliseconds. */
  readonly #ms: number
  /** Pending timer. */
  #timer: ReturnType<typeof setTimeout> | undefined

  /** Captures the window. */
  constructor(ms: number) {
    this.#ms = ms
  }

  /** Restarts the window; the latest event continues when it elapses. */
  handle(_event: unknown, next: INext): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => next(), this.#ms)
  }

  /** Cancels a pending event. */
  dispose(): void {
    clearTimeout(this.#timer)
  }
}

/** Lets one event through per window; the first event of a window continues at once. */
class ThrottleStep implements IModifierInstance {
  /** Window in milliseconds. */
  readonly #ms: number
  /** Time of the last event let through. */
  #last = Number.NEGATIVE_INFINITY

  /** Captures the window. */
  constructor(ms: number) {
    this.#ms = ms
  }

  /** Continues when the window since the last passed event elapsed. */
  handle(event: unknown, next: INext): void {
    /** Event time. */
    const now = (event as Event).timeStamp
    if (now - this.#last < this.#ms) return
    this.#last = now
    next()
  }
}

/** Reads the pointer position of a pointer or mouse event. */
function pointOf(event: Event): { readonly x: number; readonly y: number } {
  return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }
}

/**
 * Long press: on `pointerdown`, continues with `{ x, y, duration }` after the hold time unless the
 * pointer is released or moves beyond the tolerance first.
 */
class LongPressStep implements IModifierInstance {
  /** Hold time in milliseconds. */
  readonly #ms: number
  /** Movement that cancels, in pixels. */
  readonly #tolerance: number
  /** Pending press: start point, timer and the document listening for cancellation. */
  #press:
    | {
        readonly x: number
        readonly y: number
        readonly timer: ReturnType<typeof setTimeout>
        readonly document: Document
      }
    | undefined

  /** Captures hold time and tolerance. */
  constructor(ms: number, tolerance: number) {
    this.#ms = ms
    this.#tolerance = tolerance
  }

  /** Starts a press. */
  handle(event: unknown, next: INext, element: unknown): void {
    this.#cancel()
    /** Start point. */
    const start = pointOf(event as Event)
    /** Document receiving release and move events. */
    const owner = (element as Node).ownerDocument ?? document
    this.#press = {
      ...start,
      document: owner,
      timer: setTimeout(() => this.#fire(next, start), this.#ms)
    }
    for (const type of ['pointerup', 'pointercancel', 'pointermove'] as const)
      owner.addEventListener(type, this, true)
  }

  /** Cancels on release, or on movement beyond the tolerance. */
  handleEvent(event: Event): void {
    /** Current press. */
    const press = this.#press
    if (press === undefined) return
    /** Pointer position. */
    const point = pointOf(event)
    if (
      event.type !== 'pointermove' ||
      Math.hypot(point.x - press.x, point.y - press.y) > this.#tolerance
    )
      this.#cancel()
  }

  /** Continues with the press detail. */
  #fire(next: INext, start: { readonly x: number; readonly y: number }): void {
    this.#cancel()
    next({ ...start, duration: this.#ms })
  }

  /** Clears the pending press and its listeners. */
  #cancel(): void {
    /** Current press. */
    const press = this.#press
    if (press === undefined) return
    clearTimeout(press.timer)
    for (const type of ['pointerup', 'pointercancel', 'pointermove'] as const)
      press.document.removeEventListener(type, this, true)
    this.#press = undefined
  }

  /** Drops a pending press. */
  dispose(): void {
    this.#cancel()
  }
}

/** Direction of a swipe from its displacement. */
function swipeDirection(dx: number, dy: number): 'left' | 'right' | 'up' | 'down' {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

/**
 * Swipe: on `pointerdown`, continues at release with `{ direction, dx, dy }` when the pointer
 * travelled at least the distance, in the required direction when one is given.
 */
class SwipeStep implements IModifierInstance {
  /** Minimum distance in pixels. */
  readonly #distance: number
  /** Required direction, or any. */
  readonly #direction: string | undefined
  /** Pending swipe: start point, continuation and the listening document. */
  #pending:
    | { readonly x: number; readonly y: number; readonly next: INext; readonly document: Document }
    | undefined

  /** Captures distance and direction. */
  constructor(distance: number, direction: string | undefined) {
    this.#distance = distance
    this.#direction = direction
  }

  /** Starts tracking a swipe. */
  handle(event: unknown, next: INext, element: unknown): void {
    this.#stop()
    /** Document receiving the release. */
    const owner = (element as Node).ownerDocument ?? document
    this.#pending = { ...pointOf(event as Event), next, document: owner }
    owner.addEventListener('pointerup', this, true)
    owner.addEventListener('pointercancel', this, true)
  }

  /** Evaluates the swipe at release. */
  handleEvent(event: Event): void {
    /** Pending swipe. */
    const pending = this.#pending
    this.#stop()
    if (pending === undefined || event.type !== 'pointerup') return
    /** Release point. */
    const end = pointOf(event)
    /** Displacement. */
    const dx = end.x - pending.x
    /** Vertical displacement. */
    const dy = end.y - pending.y
    /** Direction travelled. */
    const direction = swipeDirection(dx, dy)
    if (Math.hypot(dx, dy) < this.#distance) return
    if (this.#direction !== undefined && this.#direction !== direction) return
    pending.next({ direction, dx, dy })
  }

  /** Stops tracking. */
  #stop(): void {
    /** Pending swipe. */
    const pending = this.#pending
    if (pending === undefined) return
    pending.document.removeEventListener('pointerup', this, true)
    pending.document.removeEventListener('pointercancel', this, true)
    this.#pending = undefined
  }

  /** Drops a pending swipe. */
  dispose(): void {
    this.#stop()
  }
}

/**
 * Drag: on `pointerdown`, captures the pointer and emits `{ phase, x, y, dx, dy }` events through
 * the rest of the chain: `start` once the pointer moved past the threshold, `move` for each move,
 * and `end` at release. The `pointerdown` itself does not continue.
 */
class DragStep implements IModifierInstance {
  /** Movement before the drag starts, in pixels. */
  readonly #threshold: number
  /** Context used to emit drag events. */
  readonly #context: IModifierContext
  /** Active drag: start point, capturing element and whether it started. */
  #drag:
    | { readonly x: number; readonly y: number; readonly element: Element; started: boolean }
    | undefined

  /** Captures the threshold and context. */
  constructor(threshold: number, context: IModifierContext) {
    this.#threshold = threshold
    this.#context = context
  }

  /** Begins tracking and captures the pointer on the part element. */
  handle(event: unknown, _next: INext, element: unknown): void {
    this.#stop()
    /** Element that captures the pointer. */
    const target = element as Element
    /** Pointer event. */
    const pointer = event as PointerEvent
    target.setPointerCapture?.(pointer.pointerId)
    this.#drag = { ...pointOf(pointer), element: target, started: false }
    for (const type of ['pointermove', 'pointerup', 'pointercancel'] as const)
      target.addEventListener(type, this)
  }

  /** Emits drag phases from captured pointer events. */
  handleEvent(event: Event): void {
    /** Active drag. */
    const drag = this.#drag
    if (drag === undefined) return
    /** Pointer position. */
    const point = pointOf(event)
    /** Detail of this phase. */
    const detail = { ...point, dx: point.x - drag.x, dy: point.y - drag.y }
    if (event.type !== 'pointermove') {
      this.#stop()
      if (drag.started) this.#context.emit(event, { phase: 'end', ...detail })
      return
    }
    if (!drag.started && Math.hypot(detail.dx, detail.dy) < this.#threshold) return
    /** Phase of this move. */
    const phase = drag.started ? 'move' : 'start'
    drag.started = true
    this.#context.emit(event, { phase, ...detail })
  }

  /** Stops tracking. */
  #stop(): void {
    /** Active drag. */
    const drag = this.#drag
    if (drag === undefined) return
    for (const type of ['pointermove', 'pointerup', 'pointercancel'] as const)
      drag.element.removeEventListener(type, this)
    this.#drag = undefined
  }

  /** Drops an active drag. */
  dispose(): void {
    this.#stop()
  }
}

/** Arguments of the timing modifiers. */
type IWindowArgs = { readonly ms?: number } | undefined
/** Arguments of `key@1`. */
type IKeyArgs = { readonly keys?: readonly string[] } | undefined
/** Arguments of `longpress@1`. */
type ILongPressArgs = { readonly ms?: number; readonly tolerance?: number } | undefined
/** Arguments of `swipe@1`. */
type ISwipeArgs = { readonly distance?: number; readonly direction?: string } | undefined
/** Arguments of `drag@1`. */
type IDragArgs = { readonly threshold?: number } | undefined

/** Every built-in modifier the DOM plugin registers. */
export const BUILTIN_MODIFIERS: readonly IModifierDefinition<unknown>[] = [
  defineModifier({
    id: 'stop@1',
    title: 'stop',
    eventKinds: DOM_AND_CUSTOM,
    placement: false,
    create: () => new StopStep()
  }),
  defineModifier({
    id: 'prevent@1',
    title: 'prevent',
    eventKinds: DOM_AND_CUSTOM,
    placement: false,
    create: () => new PreventStep()
  }),
  defineModifier({
    id: 'self@1',
    title: 'self',
    eventKinds: DOM_AND_CUSTOM,
    placement: false,
    create: () => new SelfStep()
  }),
  defineModifier({
    id: 'outside@1',
    title: 'outside',
    eventKinds: DOM_ONLY,
    placement: true,
    place: placeOnDocument,
    create: () => new OutsideStep()
  }),
  keyModifier('enter', ['Enter']),
  keyModifier('esc', ['Escape']),
  keyModifier('tab', ['Tab']),
  keyModifier('space', [' ']),
  keyModifier('up', ['ArrowUp']),
  keyModifier('down', ['ArrowDown']),
  keyModifier('delete', ['Delete', 'Backspace']),
  directionModifier('left', 'ArrowLeft'),
  directionModifier('right', 'ArrowRight'),
  defineModifier({
    id: 'middle@1',
    title: 'middle',
    eventKinds: DOM_ONLY,
    placement: false,
    create: () => new DirectionStep(undefined, MOUSE_BUTTONS.middle as number)
  }),
  defineModifier<IKeyArgs>({
    id: 'key@1',
    title: 'key',
    eventKinds: DOM_ONLY,
    placement: false,
    args: new ModifierArgsSchema({ keys: 'string[]' }),
    create: (args) => new KeyStep(args?.keys ?? [])
  }),
  systemKeyModifier('ctrl@1'),
  systemKeyModifier('shift@1'),
  systemKeyModifier('alt@1'),
  systemKeyModifier('meta@1'),
  defineModifier({
    id: 'exact@1',
    title: 'exact',
    eventKinds: DOM_ONLY,
    placement: false,
    create: (_args, context) => new ExactStep(context.siblings)
  }),
  defineModifier<IWindowArgs>({
    id: 'debounce@1',
    title: 'debounce',
    eventKinds: DOM_AND_CUSTOM,
    placement: false,
    args: new ModifierArgsSchema({ ms: 'number' }),
    create: (args) => new DebounceStep(args?.ms ?? DEFAULT_WINDOW_MS)
  }),
  defineModifier<IWindowArgs>({
    id: 'throttle@1',
    title: 'throttle',
    eventKinds: DOM_AND_CUSTOM,
    placement: false,
    args: new ModifierArgsSchema({ ms: 'number' }),
    create: (args) => new ThrottleStep(args?.ms ?? DEFAULT_WINDOW_MS)
  }),
  defineModifier<ILongPressArgs>({
    id: 'longpress@1',
    title: 'longpress',
    eventKinds: DOM_ONLY,
    placement: false,
    args: new ModifierArgsSchema({ ms: 'number', tolerance: 'number' }),
    create: (args) =>
      new LongPressStep(args?.ms ?? DEFAULT_HOLD_MS, args?.tolerance ?? DEFAULT_TOLERANCE_PX)
  }),
  defineModifier<ISwipeArgs>({
    id: 'swipe@1',
    title: 'swipe',
    eventKinds: DOM_ONLY,
    placement: false,
    args: new ModifierArgsSchema({ distance: 'number', direction: 'string' }),
    create: (args) => new SwipeStep(args?.distance ?? DEFAULT_SWIPE_PX, args?.direction)
  }),
  defineModifier<IDragArgs>({
    id: 'drag@1',
    title: 'drag',
    eventKinds: DOM_ONLY,
    placement: false,
    args: new ModifierArgsSchema({ threshold: 'number' }),
    create: (args, context) => new DragStep(args?.threshold ?? DEFAULT_DRAG_PX, context)
  })
] as readonly IModifierDefinition<unknown>[]
