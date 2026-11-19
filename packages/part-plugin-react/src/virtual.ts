/** Rows rendered before and after the visible range when the template does not set `overscan`. */
export const DEFAULT_OVERSCAN = 3

/** Half-open range `[start, end)` of rendered row indexes. */
export type IVirtualRange = { readonly start: number; readonly end: number }

/** Inputs of one range computation, all in pixels except `overscan` and `count`. */
export type IRangeInput = {
  readonly scrollTop: number
  readonly viewportHeight: number
  readonly offset: number
  readonly rowHeight: number
  readonly overscan: number
  readonly count: number
}

/**
 * Rows to render: from `floor((scrollTop − offset) / rowHeight) − overscan` to `ceil((scrollTop −
 * offset + viewportHeight) / rowHeight) + overscan`, clamped to `[0, count)`. A zero-height
 * viewport renders the first `overscan` rows. Constant time, independent of `count`.
 */
export function visibleRange(input: IRangeInput): IVirtualRange {
  if (input.count === 0) return { start: 0, end: 0 }
  if (input.viewportHeight <= 0) return { start: 0, end: Math.min(input.count, input.overscan) }
  /** Scroll position relative to the host's top. */
  const top = input.scrollTop - input.offset
  /** Last row index, exclusive. */
  const end = Math.min(
    input.count,
    Math.max(0, Math.ceil((top + input.viewportHeight) / input.rowHeight) + input.overscan)
  )
  /** First row index. */
  const start = Math.min(end, Math.max(0, Math.floor(top / input.rowHeight) - input.overscan))
  return { start, end }
}

/** True when two ranges are equal, so an unchanged range does not re-render. */
export function sameRange(first: IVirtualRange, second: IVirtualRange): boolean {
  return first.start === second.start && first.end === second.end
}

/** Spacer element tag valid inside a host: `tr` in a table body, `li` in a list, `div` otherwise. */
export function spacerTag(hostTag: string): 'tr' | 'li' | 'div' {
  /** Lower-case host tag. */
  const tag = hostTag.toLowerCase()
  if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot' || tag === 'table') return 'tr'
  if (tag === 'ul' || tag === 'ol') return 'li'
  return 'div'
}

/**
 * Nearest ancestor of `element` whose computed `overflow-y` is `auto` or `scroll`; undefined means
 * the document scrolls. Walks the ancestor chain once.
 */
export function scrollContainer(element: HTMLElement): HTMLElement | undefined {
  /** Ancestor being inspected. */
  let current = element.parentElement
  while (current !== null) {
    /** Computed vertical overflow. */
    const overflow = getComputedStyle(current).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return current
    current = current.parentElement
  }
  return undefined
}

/** Scroll position, viewport height and host offset for a host inside a container or the document. */
export function measure(
  host: HTMLElement,
  container: HTMLElement | undefined
): Omit<IRangeInput, 'rowHeight' | 'overscan' | 'count'> {
  /** Host box. */
  const hostBox = host.getBoundingClientRect()
  if (container === undefined)
    return {
      scrollTop: window.scrollY,
      viewportHeight: window.innerHeight,
      offset: hostBox.top + window.scrollY
    }
  /** Container box. */
  const box = container.getBoundingClientRect()
  return {
    scrollTop: container.scrollTop,
    viewportHeight: container.clientHeight,
    offset: hostBox.top - box.top + container.scrollTop
  }
}
