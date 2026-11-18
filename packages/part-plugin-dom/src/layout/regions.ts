import type { ILayoutBehavior, ILayoutRegion } from '@migaia/part-contract'
import type { ILayoutRule } from '../stylesheet.ts'
import { DRAWER_FALLBACK_WIDTH, SEPARATOR_TRACK, TOGGLE_OFFSET } from './constants.ts'

/** Current state the layout rules are built from. */
export type ILayoutState = {
  /** Current pixel width of each resizable region. */
  readonly sizes: ReadonlyMap<string, number>
  /** Names of collapsed regions. */
  readonly collapsed: ReadonlySet<string>
  /** Whether a skip link is attached. */
  readonly skip: boolean
}

/** One grid track: a region or the separator of a region. */
type ITrack = { readonly kind: 'region' | 'separator'; readonly region: ILayoutRegion }

/** Position of the main region; layout validation guarantees exactly one. */
export function mainIndexOf(layout: ILayoutBehavior): number {
  return layout.regions.findIndex((region) => region.landmark === 'main')
}

/**
 * Tracks in display order. A resizable region's separator always sits between the region and main:
 * after the region when it comes before main, before it otherwise.
 */
export function tracksOf(layout: ILayoutBehavior): readonly ITrack[] {
  /** Position of main. */
  const main = mainIndexOf(layout)
  /** Tracks collected in order. */
  const tracks: ITrack[] = []
  layout.regions.forEach((region, index) => {
    if (region.resizable === true && index > main) tracks.push({ kind: 'separator', region })
    tracks.push({ kind: 'region', region })
    if (region.resizable === true && index < main) tracks.push({ kind: 'separator', region })
  })
  return tracks
}

/** Size of a region track. */
function regionTrack(region: ILayoutRegion, state: ILayoutState): string {
  if (state.collapsed.has(region.name)) return '0px'
  /** Current width of a resizable region. */
  const current = state.sizes.get(region.name)
  if (current !== undefined) return `${current}px`
  /** Declared default. */
  const size = region.size?.default
  if (typeof size === 'number') return `${size}px`
  if (size !== undefined) return size
  return region.landmark === 'main' ? 'minmax(0, 1fr)' : 'auto'
}

/** Drawer width of a collapsed region: its current or default pixel width, or the fallback. */
function drawerWidth(region: ILayoutRegion, state: ILayoutState): number {
  /** Declared default. */
  const size = region.size?.default
  return state.sizes.get(region.name) ?? (typeof size === 'number' ? size : DRAWER_FALLBACK_WIDTH)
}

/** Declarations of a region: grid placement, scrolling, and drawer geometry when collapsed. */
function regionDeclarations(
  region: ILayoutRegion,
  placement: Record<string, string>,
  state: ILayoutState
): Record<string, string> {
  /** Scrolling declarations unless the region opts out. */
  const scroll: Record<string, string> =
    region.scroll === false ? {} : { overflow: 'auto', 'min-width': '0', 'min-height': '0' }
  if (!state.collapsed.has(region.name)) return { ...placement, ...scroll }
  return {
    ...scroll,
    position: 'fixed',
    'inset-block': '0',
    'inset-inline-start': '0',
    'inset-inline-end': 'auto',
    margin: '0',
    height: 'auto',
    'max-height': 'none',
    width: `${drawerWidth(region, state)}px`,
    'max-width': '85vw'
  }
}

/** Rules of the skip link: clipped to one pixel until it shows keyboard focus. */
const SKIP_RULES: readonly ILayoutRule[] = [
  {
    target: 'skip',
    declarations: {
      position: 'absolute',
      'inset-block-start': '0',
      'inset-inline-start': '0',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      'clip-path': 'inset(50%)',
      'white-space': 'nowrap',
      'z-index': '1'
    }
  },
  {
    target: 'skip',
    state: 'focus-visible',
    declarations: { width: 'auto', height: 'auto', overflow: 'visible', 'clip-path': 'none' }
  }
]

/**
 * Builds every `layout` layer rule of one layout: root grid, region and separator placement, toggle
 * visibility and the skip link. O(regions).
 */
export function layoutRules(layout: ILayoutBehavior, state: ILayoutState): readonly ILayoutRule[] {
  /** Whether tracks run along columns. */
  const row = layout.direction === 'row'
  /** Placement property along the layout axis and across it. */
  const along = row ? 'grid-column' : 'grid-row'
  /** Placement property across the layout axis. */
  const across = row ? 'grid-row' : 'grid-column'
  /** Rules collected in order. */
  const rules: ILayoutRule[] = []
  /** Track sizes in order. */
  const sizes: string[] = []
  for (const track of tracksOf(layout)) {
    /** Placement of this track's element. */
    const placement = { [along]: String(sizes.length + 1), [across]: '1' }
    /** Whether the track's region is collapsed. */
    const collapsed = state.collapsed.has(track.region.name)
    if (track.kind === 'separator') {
      sizes.push(collapsed ? '0px' : SEPARATOR_TRACK)
      rules.push({
        target: `separator:${track.region.name}`,
        declarations: collapsed
          ? { display: 'none' }
          : { ...placement, cursor: row ? 'col-resize' : 'row-resize', 'touch-action': 'none' }
      })
      continue
    }
    sizes.push(regionTrack(track.region, state))
    rules.push({
      target: `region:${track.region.name}`,
      declarations: regionDeclarations(track.region, placement, state)
    })
  }
  rules.unshift({
    target: 'root',
    declarations: {
      display: 'grid',
      position: 'relative',
      [row ? 'grid-template-columns' : 'grid-template-rows']: sizes.join(' '),
      [row ? 'grid-template-rows' : 'grid-template-columns']: 'minmax(0, 1fr)'
    }
  })
  /**
   * Number of toggles shown so far. Visible toggles stack downwards from the top end corner, away
   * from drawers, which open from the start edge and would otherwise cover their own toggle.
   */
  let shown = 0
  for (const region of layout.regions) {
    if (region.collapseBelow === undefined) continue
    if (!state.collapsed.has(region.name)) {
      rules.push({ target: `toggle:${region.name}`, declarations: { display: 'none' } })
      continue
    }
    rules.push({
      target: `toggle:${region.name}`,
      declarations: {
        position: 'absolute',
        'inset-block-start': `calc(${shown} * ${TOGGLE_OFFSET})`,
        'inset-inline-end': '0',
        'z-index': '1'
      }
    })
    shown += 1
  }
  if (state.skip) rules.push(...SKIP_RULES)
  return rules
}
