/**
 * Single motion entry for the website. Every animated surface goes through this module so the
 * duration/ease vocabulary stays consistent and `prefers-reduced-motion` disables all of it in one
 * place. GSAP core is loaded on first use only; pages that never animate never download it.
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

/** Shared deceleration curve; matches `--motion-ease` in app.css. */
const MOTION_EASE = 'power2.out'

/** Lazily resolved GSAP core module; shared so the import runs at most once per page. */
let gsapModule: Promise<typeof import('gsap')> | undefined

/** Returns true when the reader asked the platform to minimise motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Loads GSAP core on demand. Rejections propagate so callers can skip the animation. */
function loadGsap() {
  gsapModule ??= import('gsap')
  return gsapModule
}

/**
 * Fades route content in with a short rise after a client navigation. Reduced motion, missing
 * targets, or a failed GSAP load leave the content in its final static state.
 */
export async function revealRouteContent(target: Element | null): Promise<void> {
  if (!target || prefersReducedMotion()) return
  try {
    const { gsap } = await loadGsap()
    gsap.fromTo(
      target,
      { opacity: 0, y: 6 },
      {
        opacity: 1,
        y: 0,
        duration: MotionDuration.base,
        ease: MOTION_EASE,
        clearProps: 'opacity,transform'
      }
    )
  } catch (error) {
    // Animation is decorative; report the failed chunk load and keep the static page.
    console.error(error)
  }
}
