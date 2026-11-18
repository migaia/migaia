import { focusInto } from './collapse.ts'
import { LayoutAttribute } from './constants.ts'

/** Selector of regions F6 visits: every region that is not collapsed. */
const CYCLE_SELECTOR = `[${LayoutAttribute.region}]:not([${LayoutAttribute.collapsed}="true"])`

/**
 * Number of attached layouts per document. Deliberately private module state: one capturing keydown
 * listener per document is shared by every host and layout attached in it.
 */
const attachedCount = new WeakMap<Document, number>()

/** Moves focus between regions on F6 and Shift+F6. */
class RegionCycler {
  /** Handles one capturing keydown on a document. */
  handleEvent(event: Event): void {
    /** Keyboard event. */
    const key = event as KeyboardEvent
    if (key.key !== 'F6' || key.ctrlKey || key.altKey || key.metaKey) return
    /** Document the listener sits on. */
    const document = event.currentTarget as Document
    /** Regions in document order. */
    const regions = Array.from(document.querySelectorAll<HTMLElement>(CYCLE_SELECTOR))
    if (regions.length === 0) return
    event.preventDefault()
    /** Innermost region holding focus, by position. */
    const current = currentRegion(regions, document.activeElement)
    /** Step direction. */
    const step = key.shiftKey ? -1 : 1
    /** Position of the target region. */
    const next =
      current === -1
        ? step === 1
          ? 0
          : regions.length - 1
        : (current + step + regions.length) % regions.length
    focusInto(regions[next] as HTMLElement)
  }
}

/** The single listener object shared by every document. */
const CYCLER = new RegionCycler()

/** Position of the last (innermost) region containing the active element, or -1. */
function currentRegion(regions: readonly HTMLElement[], active: Element | null): number {
  /** Last match found. */
  let found = -1
  if (active === null) return found
  regions.forEach((region, index) => {
    if (region.contains(active)) found = index
  })
  return found
}

/** Counts one attached layout; the first one in a document installs the listener. */
export function retainRegionCycle(document: Document): void {
  /** Layouts attached before this one. */
  const count = attachedCount.get(document) ?? 0
  if (count === 0) document.addEventListener('keydown', CYCLER, true)
  attachedCount.set(document, count + 1)
}

/** Uncounts one attached layout; the last one removes the listener. */
export function releaseRegionCycle(document: Document): void {
  /** Layouts attached including this one. */
  const count = attachedCount.get(document) ?? 0
  if (count <= 1) {
    document.removeEventListener('keydown', CYCLER, true)
    attachedCount.delete(document)
    return
  }
  attachedCount.set(document, count - 1)
}
