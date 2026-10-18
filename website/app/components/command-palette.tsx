import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { interfaceCopyFor } from '../copy.js'
import { LIBRARY_INDEX, libraryReferenceDescription } from '../library-descriptions.js'
import { domainPath, type ILocale } from '../route-contract.js'
import { loadSearchIndex } from '../search.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle
} from './ui/dialog.js'

/** One selectable palette row: a library jump or a Pagefind page hit. */
type IPaletteItem = {
  readonly key: string
  readonly group: 'libraries' | 'pages'
  readonly title: string
  readonly detail: string
  /** Basename-relative route passed to React Router. */
  readonly to: string
}

/** Resolved data of one Pagefind result. */
type IPagefindHit = {
  readonly url: string
  readonly excerpt: string
  readonly meta: { readonly title?: string }
}

/** Subset of the Pagefind runtime this palette calls. */
type IPagefind = {
  /** Sets init options; `language` picks the per-locale index before the next search loads it. */
  readonly options: (options: { readonly language: ILocale }) => Promise<void>
  /** Drops the loaded index so the next `options` + `search` loads another language. */
  readonly destroy: () => Promise<void>
  readonly search: (query: string) => Promise<{
    readonly results: readonly { readonly data: () => Promise<IPagefindHit> }[]
  } | null>
}

/** Maximum Pagefind hits rendered; more would push the keyboard target off-screen. */
const MAX_PAGE_RESULTS = 8

/** Maximum library rows shown for a non-empty query. */
const MAX_LIBRARY_RESULTS = 5

/** Delay before querying Pagefind so each keystroke does not start a search. */
const SEARCH_DEBOUNCE_MS = 120

/** Converts a Pagefind result URL into the basename-relative route React Router expects. */
function routeFromSearchUrl(url: string): string {
  /** Vite base for sub-path deployments, without its trailing slash. */
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const withoutBase = base && url.startsWith(base) ? url.slice(base.length) : url
  return withoutBase.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/'
}

/** Strips Pagefind's highlight markup so excerpts render as plain, safe text. */
function plainExcerpt(excerpt: string): string {
  return excerpt.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ')
}

/**
 * ⌘K command palette: jumps to any library immediately and searches every prerendered page through
 * the local Pagefind index (loaded on first open, no remote service). Arrow keys move the active
 * row, Enter opens it, Escape closes the dialog.
 */
export default function CommandPalette({
  locale,
  onOpenChange,
  open
}: {
  readonly locale: ILocale
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
}) {
  const copy = interfaceCopyFor(locale)
  const navigate = useNavigate()
  /** Current input text. */
  const [query, setQuery] = useState('')
  /** Pagefind hits for the latest settled query. */
  const [pages, setPages] = useState<readonly IPaletteItem[]>([])
  /** True between a query change and its Pagefind response. */
  const [searching, setSearching] = useState(false)
  /** Index of the highlighted row across both groups. */
  const [active, setActive] = useState(0)
  /** Lazily loaded Pagefind module; null when the index is unavailable (local dev). */
  const pagefindRef = useRef<Promise<IPagefind | null> | undefined>(undefined)
  /**
   * Locale whose index the Pagefind singleton holds. Pagefind binds one language at first search,
   * so a client-side language switch must reload it or results stay in the previous language.
   */
  const indexLocaleRef = useRef<ILocale | undefined>(undefined)
  /** Scroll container used to keep the active row visible. */
  const listRef = useRef<HTMLDivElement>(null)

  /** Library rows match slug or description; an empty query lists every library. */
  const libraries = useMemo<readonly IPaletteItem[]>(() => {
    const needle = query.trim().toLowerCase()
    /** Slug form of the query, so `store light` still matches `store-light`. */
    const slugNeedle = needle.replace(/\s+/g, '-')
    const rows = LIBRARY_INDEX.map((library) => ({
      key: `library:${library.slug}`,
      group: 'libraries' as const,
      title: library.slug,
      detail: libraryReferenceDescription(locale, library.slug),
      to: domainPath(locale, library.slug)
    })).filter(
      (row) =>
        !needle || row.title.includes(slugNeedle) || row.detail.toLowerCase().includes(needle)
    )
    return needle ? rows.slice(0, MAX_LIBRARY_RESULTS) : rows
  }, [locale, query])

  useEffect(() => {
    const needle = query.trim()
    if (!open || !needle) {
      setPages([])
      setSearching(false)
      return
    }
    setSearching(true)
    /** Set when a newer query supersedes this one so its late response is dropped. */
    let stale = false
    const timer = window.setTimeout(async () => {
      if (!pagefindRef.current)
        pagefindRef.current = loadSearchIndex().then(
          (module) => module as IPagefind,
          (error: unknown) => {
            // The index exists only in built output; report and fall back to library rows.
            console.error(error)
            return null
          }
        )
      const pagefind = await pagefindRef.current
      /** Resolved hit data; a failed query reports and shows the empty state. */
      let hits: readonly IPagefindHit[] = []
      try {
        if (pagefind && indexLocaleRef.current !== locale) {
          await pagefind.destroy()
          await pagefind.options({ language: locale })
          indexLocaleRef.current = locale
        }
        const response = pagefind ? await pagefind.search(needle) : null
        hits = await Promise.all(
          (response?.results ?? []).slice(0, MAX_PAGE_RESULTS).map((result) => result.data())
        )
      } catch (error) {
        console.error(error)
      }
      if (stale) return
      setPages(
        hits.map((hit) => ({
          key: `page:${hit.url}`,
          group: 'pages',
          title: hit.meta.title?.replace(/ · migaia$/, '') ?? hit.url,
          detail: plainExcerpt(hit.excerpt),
          to: routeFromSearchUrl(hit.url)
        }))
      )
      setSearching(false)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [locale, open, query])

  /** Flat keyboard order: libraries first, then pages. */
  const items = useMemo(() => [...libraries, ...pages], [libraries, pages])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  /** Navigates to one row and closes the palette. */
  const choose = (item: IPaletteItem | undefined) => {
    if (!item) return
    onOpenChange(false)
    navigate(item.to)
  }

  /** Renders one group with its heading; rows keep their global keyboard index. */
  const renderGroup = (group: IPaletteItem['group'], rows: readonly IPaletteItem[]) =>
    rows.length === 0 ? null : (
      <div
        className="palette-group"
        role="group"
        aria-label={group === 'libraries' ? copy.paletteLibraries : copy.palettePages}
      >
        <p className="palette-group-label">
          {group === 'libraries' ? copy.paletteLibraries : copy.palettePages}
        </p>
        {rows.map((row) => {
          const index = items.indexOf(row)
          return (
            <button
              aria-selected={index === active}
              className="palette-item"
              data-group={group}
              data-index={index}
              key={row.key}
              onClick={() => choose(row)}
              onMouseMove={() => setActive(index)}
              role="option"
              type="button"
            >
              <span className="palette-item-title">{row.title}</span>
              <span className="palette-item-detail">{row.detail}</span>
            </button>
          )
        })}
      </div>
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent aria-describedby="palette-hint">
          <DialogTitle className="sr-only">{copy.paletteLabel}</DialogTitle>
          <div className="palette-field">
            <svg aria-hidden="true" className="palette-field-icon" viewBox="0 0 16 16">
              <circle cx="7" cy="7" r="4.75" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input
              aria-controls="palette-results"
              aria-label={copy.paletteLabel}
              autoComplete="off"
              autoFocus
              id="site-search"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive((current) => Math.min(current + 1, items.length - 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive((current) => Math.max(current - 1, 0))
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  choose(items[active])
                }
              }}
              placeholder={copy.paletteLabel}
              spellCheck={false}
              value={query}
            />
            <kbd>esc</kbd>
          </div>
          <div className="palette-results" id="palette-results" ref={listRef} role="listbox">
            {renderGroup('libraries', libraries)}
            {renderGroup('pages', pages)}
            {query.trim() && !searching && pages.length === 0 ? (
              <p className="palette-state">{copy.paletteEmpty}</p>
            ) : null}
            {searching && pages.length === 0 ? (
              <p className="palette-state">{copy.paletteSearching}</p>
            ) : null}
          </div>
          <DialogDescription className="palette-hint" id="palette-hint">
            {copy.paletteHint}
          </DialogDescription>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
