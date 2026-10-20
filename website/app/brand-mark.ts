/**
 * Geometry and motion of the brand mark (the Kotoamatsukami eye). The header `BrandMark` draws from
 * these values; `favicon.svg` repeats the blade path because a static asset cannot import it. The
 * tab icon does not spin from script: Chrome and Safari repaint favicons at their own low rate, so
 * swapping frames stutters however often the page updates them.
 */

/** One blade in the 20×20 mark box; the mark repeats it at 0°, 90°, 180° and 270°. */
export const BRAND_BLADE_PATH = 'M10 10C9.4 6.2 11.8 3.2 15.6 3.4 13 4.6 12.2 7.6 10 10Z'

/** Duration of the hover whirl, in milliseconds. */
const WHIRL_MS = 1100
/** Fast start, long smooth stop: the whirl decelerates to rest. */
const WHIRL_EASING = 'cubic-bezier(0.1, 0.75, 0.2, 1)'
/** Animation id that marks a running whirl, so repeated hovers do not restart it mid-turn. */
const WHIRL_ID = 'brand-mark-whirl'

/**
 * Spins the header mark one fast full turn. The mark rests between events: it turns once on page
 * load (CSS `brand-mark-arrive`), on hover, and when a route change starts. Uses the `rotate`
 * property, which composes with the load `transform` animation, so the mark ends where it started.
 * A whirl already running is left to finish; reduced motion skips it.
 */
export function whirlBrandMark(mark: Element | null): void {
  if (!mark || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  if (mark.getAnimations().some((animation) => animation.id === WHIRL_ID)) return
  mark.animate([{ rotate: '0deg' }, { rotate: '-360deg' }], {
    duration: WHIRL_MS,
    easing: WHIRL_EASING,
    id: WHIRL_ID
  })
}
