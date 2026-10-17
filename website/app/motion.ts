/**
 * Single motion entry for the website. Every animated surface goes through this module so the
 * duration/ease vocabulary stays consistent and `prefers-reduced-motion` disables all of it in one
 * place.
 */

/** Duration tokens in seconds, mirrored by `--motion-*` in app.css for CSS-driven transitions. */
export const MotionDuration = {
  /** Micro feedback: copy confirmations, hover tints. */
  quick: 0.12,
  /** Default state change: route content, panel open. */
  base: 0.2,
  /** Larger composition entrances such as the docs home hero. */
  slow: 0.32
} as const

export type MotionDuration = keyof typeof MotionDuration

/** Returns true when the reader asked the platform to minimise motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Route content transition. The centre column fades out (opacity down, soft blur up) while the next
 * route loads, and the new route's content blocks then emerge one by one (`emergeRouteContent`), so
 * lazy route chunks and data loads hide behind the transition instead of popping in. Only CSS
 * `opacity` and `filter: blur()` change: both are composited on the GPU and change evenly, with no
 * noise or flicker. Progress `0` is hidden, `1` is the plain page with no inline styles.
 *
 * The driver is a plain `requestAnimationFrame` loop: the first hidden frame must be applied
 * synchronously in a layout effect, before the new route paints.
 */

/** Seconds to fade the old column out once a navigation starts loading. */
const DISSOLVE_SECONDS = 0.45
/** Seconds for an abandoned navigation's column to fade back (scaled by `settleRouteContent`). */
const EMERGE_SECONDS = 0.9
/** Blur (px) of the column at progress 0; clears to 0 as it fades in. */
const MAX_BLUR = 8

/** One running fade. */
type IEmergenceRun = { element: HTMLElement; frame: number }

/** The run in progress, if any; a new phase cancels it and continues from its progress. */
let current: IEmergenceRun | undefined
/** Last applied progress, so a fade-out interrupted by the new route continues smoothly. */
let progress = 1

/** Fade-in curve: quick to become readable, then a soft settle of the last blur. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/** Gentle start for the fade-out, so the old page lets go rather than snapping away. */
function easeInQuad(t: number): number {
  return t * t
}

/** Writes progress `p` as opacity and blur; at `1` the inline styles are removed. */
function applyProgress(element: HTMLElement, p: number): void {
  progress = p
  if (p >= 1) {
    element.style.opacity = ''
    element.style.filter = ''
    element.style.willChange = ''
    return
  }
  element.style.willChange = 'opacity, filter'
  element.style.opacity = p.toFixed(4)
  element.style.filter = `blur(${(MAX_BLUR * (1 - p)).toFixed(3)}px)`
}

/** Animates progress from its current value to `target` over `seconds` with `ease`. */
function run(element: HTMLElement, target: number, seconds: number, ease: (t: number) => number) {
  if (current) cancelAnimationFrame(current.frame)
  /** Progress at the start of this phase. */
  const from = progress
  /** Phase start time. */
  const start = performance.now()
  /** Advances one frame and schedules the next until the phase ends. */
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 1000 / seconds)
    applyProgress(element, from + (target - from) * ease(t))
    if (t < 1 && current) current.frame = requestAnimationFrame(step)
    else current = undefined
  }
  current = { element, frame: requestAnimationFrame(step) }
}

/** Finds the centre column of the current page; side rails stay outside the effect. */
export function routeContentColumn(): HTMLElement | null {
  // Two lookups: a combined selector would return `<main>` first, which contains the rails.
  return (
    document.querySelector<HTMLElement>('.article-column') ??
    document.querySelector<HTMLElement>('#main-content')
  )
}

/**
 * Fades the current centre column out while the next route loads. It stays hidden until
 * `emergeRouteContent` runs for the new route, or `settleRouteContent` restores it when the
 * navigation is abandoned.
 */
export function dissolveRouteContent(): void {
  const element = routeContentColumn()
  if (!element || prefersReducedMotion()) return
  run(element, 0, DISSOLVE_SECONDS * progress, easeInQuad)
}

/** Milliseconds between consecutive content blocks of the entrance. */
const EMERGE_STAGGER_MS = 70
/** Most blocks animated per entrance; later visible blocks share the last delay. */
const EMERGE_MAX_ITEMS = 18
/** Class carrying the per-block entrance animation (app.css `.route-emerge-item`). */
const EMERGE_ITEM_CLASS = 'route-emerge-item'
/** Wrapper tags that are opened up so their own blocks animate one by one. */
const EMERGE_CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'NAV', 'MAIN'])

/**
 * Lists the content blocks of `root` in reading order: a wrapper whose children stack on separate
 * lines is opened up (to a few levels), anything else is one block. Only blocks that start inside
 * the viewport are returned; blocks below it are already settled when the reader scrolls to them.
 */
function contentBlocks(root: HTMLElement): HTMLElement[] {
  /** Collected blocks, in document order. */
  const blocks: HTMLElement[] = []
  /** Bottom edge of the viewport; blocks starting below it are skipped. */
  const viewportBottom = window.innerHeight
  /** Adds `element` as one block, or descends into it when it only groups other blocks. */
  const visit = (element: HTMLElement, depth: number) => {
    if (element.getBoundingClientRect().top > viewportBottom) return
    const children = [...element.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    )
    /**
     * Children that share one line (inline text, or a flex row such as the breadcrumb, whose items
     * compute as `block`) read as one unit: keep them together instead of animating each piece.
     */
    const oneLine =
      children.some((child) => getComputedStyle(child).display.startsWith('inline')) ||
      new Set(children.map((child) => Math.round(child.getBoundingClientRect().top))).size === 1
    if (depth < 3 && EMERGE_CONTAINER_TAGS.has(element.tagName) && children.length > 1 && !oneLine)
      for (const child of children) visit(child, depth + 1)
    else blocks.push(element)
  }
  for (const child of root.children) if (child instanceof HTMLElement) visit(child, 0)
  return blocks
}

/**
 * Brings the new route in block by block: the centre column itself is shown at once, and each of
 * its visible content blocks fades, sharpens and settles in reading order. Call from a layout
 * effect so the blocks start hidden before the browser paints the new route.
 */
export function emergeRouteContent(): void {
  const element = routeContentColumn()
  if (!element || prefersReducedMotion()) return
  if (current) {
    cancelAnimationFrame(current.frame)
    current = undefined
  }
  applyProgress(element, 1)
  contentBlocks(element).forEach((block, index) => {
    block.style.setProperty(
      '--emerge-delay',
      `${Math.min(index, EMERGE_MAX_ITEMS) * EMERGE_STAGGER_MS}ms`
    )
    block.classList.add(EMERGE_ITEM_CLASS)
    // Remove the animation once it has played, so later style changes never replay it.
    block.addEventListener(
      'animationend',
      () => {
        block.classList.remove(EMERGE_ITEM_CLASS)
        block.style.removeProperty('--emerge-delay')
      },
      { once: true }
    )
  })
}

/** Restores the column when a navigation ends without changing the route. */
export function settleRouteContent(): void {
  const element = current?.element ?? routeContentColumn()
  if (!element || progress >= 1) return
  run(element, 1, EMERGE_SECONDS * 0.6, easeOutCubic)
}
