/**
 * Pointer focus of the home page's link cards. One delegated listener reports which card link the
 * pointer is over, so the ambient field can thicken its light and particles behind that card and
 * the card's edge light can speed up and flicker. Decorative only: it never changes navigation.
 */

/** Link cards that react to the pointer (`language.tsx` journey and library cards). */
export const CARD_LINK_SELECTOR = 'a.journey-item, a.library-item'

/** Edge-light playback rate while a card is focused; the idle comet runs at 1. */
const FOCUSED_EDGE_RATE = 1.3
/** Half period of the focused edge flicker, in milliseconds. */
const EDGE_FLICKER_MS = 650

/**
 * Calls `listener` with the card link under the pointer, or null when the pointer leaves every card
 * or the window. Only changes are reported. Returns a disposer that removes the listeners.
 */
export function trackCardFocus(listener: (card: HTMLElement | null) => void): () => void {
  /** Card reported last, so repeated events inside one card stay silent. */
  let current: HTMLElement | null = null
  /** Reports `card` when it differs from the current one. */
  const report = (card: HTMLElement | null) => {
    if (card === current) return
    current = card
    listener(card)
  }
  /** Pointer moved onto an element: find the enclosing card link, if any. */
  const over = (event: PointerEvent) =>
    report((event.target as Element | null)?.closest<HTMLElement>(CARD_LINK_SELECTOR) ?? null)
  /** Pointer left the document entirely. */
  const out = (event: PointerEvent) => {
    if (!event.relatedTarget) report(null)
  }
  document.addEventListener('pointerover', over)
  document.addEventListener('pointerout', out)
  return () => {
    document.removeEventListener('pointerover', over)
    document.removeEventListener('pointerout', out)
  }
}

/**
 * Speeds up a card's edge comet and makes it flicker while the card is focused, and restores it
 * afterwards. The speed change goes through `updatePlaybackRate`, which keeps the comet's current
 * position, so the light never jumps. Returns the restore function for the focused card.
 */
export function energizeCardEdge(card: HTMLElement): () => void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}
  /** The CSS `card-edge-trace` animation running on the card's `::after` ring. */
  const trace = card
    .getAnimations({ subtree: true })
    .find(
      (animation) =>
        animation instanceof CSSAnimation &&
        animation.animationName === 'card-edge-trace' &&
        (animation.effect as KeyframeEffect | null)?.pseudoElement === '::after'
    )
  trace?.updatePlaybackRate(FOCUSED_EDGE_RATE)
  /** Opacity flicker layered on the ring while focused. */
  const flicker = card.animate([{ opacity: 0.6 }, { opacity: 1 }], {
    direction: 'alternate',
    duration: EDGE_FLICKER_MS,
    easing: 'ease-in-out',
    iterations: Infinity,
    pseudoElement: '::after'
  })
  return () => {
    trace?.updatePlaybackRate(1)
    flicker.cancel()
  }
}
