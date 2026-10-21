import { useResource, useStore } from '@migaia/store-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { interfaceCopyFor } from '../copy.js'
import { LIBRARY_INDEX, libraryReferenceDescription } from '../library-descriptions.js'
import { domainPath, type ILocale } from '../route-contract.js'
import { createSearchQuery } from '../search.js'
import { pageSearchHistory, type ISearchHistory } from '../search-history.js'
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

/** Maximum library rows shown for a non-empty query. */
const MAX_LIBRARY_RESULTS = 5

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
function PaletteSession({
  locale,
  onOpenChange,
  open,
  searchQuery,
  history
}: {
  readonly locale: ILocale
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
  readonly searchQuery: ReturnType<typeof createSearchQuery>
  readonly history: ISearchHistory
}) {
  const copy = interfaceCopyFor(locale)
  const navigate = useNavigate()
  /** History keeps language partitions and persistence feedback in its single owner. */
  const historyState = useStore(history.store, (state) => ({
    entries: state.entries,
    status: state.status,
    feedback: state.feedback
  }))
  /** Only the route's language is visible in this palette. */
  const historyEntries = historyState.entries.filter((entry) => entry.locale === locale)
  /** Feedback is announced only after the history owner's flush settles. */
  const historyFeedback =
    historyState.feedback === 'saving'
      ? copy.historySaving
      : historyState.feedback === 'saved'
        ? copy.historySaved
        : historyState.feedback === 'deleted'
          ? copy.historyDeleted
          : historyState.feedback === 'failed'
            ? copy.historyFailed
            : ''
  /** Current input text. */
  const [query, setQuery] = useState('')
  /**
   * Recent searches shown for the current input: all of them while the input is empty, otherwise
   * only those containing it. The section is hidden whenever this list is empty, including while
   * history loads or when storage is unavailable.
   */
  const visibleHistory =
    historyState.status === 'ready'
      ? historyEntries.filter((entry) =>
          entry.query.toLowerCase().includes(query.trim().toLowerCase())
        )
      : []
  /** Resource is the sole owner of current page results. */
  const result = useResource(searchQuery.resource)
  /** Distinguishes the debounce interval from a completed empty result. */
  const settledInput = useStore(searchQuery.needle, (state) => state.query)
  /** Both debounce and resource replacement keep the searching state visible. */
  const searching =
    query.trim() !== settledInput ||
    result.status === 'pending' ||
    (result.status === 'success' && result.refreshing === true)
  /** Old resource data stays hidden while a newer query is waiting. */
  const pages: readonly IPaletteItem[] =
    !searching && result.status === 'success'
      ? result.data.map((hit) => ({
          key: `page:${hit.url}`,
          group: 'pages',
          title: hit.meta.title?.replace(/ · migaia$/, '') ?? hit.url,
          detail: plainExcerpt(hit.excerpt),
          to: routeFromSearchUrl(hit.url)
        }))
      : []
  /** Index of the highlighted row across both groups. */
  const [active, setActive] = useState(0)
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

  /** Input debounce belongs to the same session as the query Resource. */
  useEffect(() => searchQuery.setInput(query), [query, searchQuery])

  /** Flat keyboard order: libraries first, then pages. */
  const items = useMemo(() => [...libraries, ...pages], [libraries, pages])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  /** Navigates to one row and closes the palette. */
  const choose = (item: IPaletteItem | undefined) => {
    void history.record(locale, query)
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
            {visibleHistory.length > 0 ? (
              <section className="palette-group" aria-label={copy.historyTitle}>
                <div className="palette-history-head">
                  <p className="palette-group-label">{copy.historyTitle}</p>
                  <button
                    className="palette-history-clear"
                    disabled={historyState.feedback === 'saving'}
                    onClick={() => void history.clear(locale)}
                    type="button"
                  >
                    {copy.historyClear}
                  </button>
                </div>
                {visibleHistory.map((entry) => (
                  <div className="palette-history-row" key={entry.query}>
                    <button
                      className="palette-item"
                      type="button"
                      onClick={() => setQuery(entry.query)}
                    >
                      <span className="palette-item-title">
                        <svg
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <circle cx="8" cy="8" r="5.75" />
                          <path d="M8 5v3.25l2 1.25" />
                        </svg>
                        {entry.query}
                      </span>
                    </button>
                    <button
                      aria-label={`${copy.historyDelete}: ${entry.query}`}
                      className="palette-history-remove"
                      disabled={historyState.feedback === 'saving'}
                      onClick={() => void history.remove(locale, entry.query)}
                      title={copy.historyDelete}
                      type="button"
                    >
                      <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 16 16">
                        <path d="m4.5 4.5 7 7m0-7-7 7" />
                      </svg>
                    </button>
                  </div>
                ))}
              </section>
            ) : null}
            {/* Stays mounted so save and delete results are still announced after the list empties. */}
            {/* Only failures are shown; routine saves are announced to assistive technology only. */}
            <p
              className={historyState.feedback === 'failed' ? 'palette-state' : 'sr-only'}
              role="status"
            >
              {historyFeedback}
            </p>
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

/** Acquires browser query resources only after a committed open, including StrictMode replay. */
export default function CommandPalette({
  locale,
  onOpenChange,
  open
}: {
  readonly locale: ILocale
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
}) {
  /** Page-lifetime history, usually already loaded in the background by the shell. */
  const [history] = useState(pageSearchHistory)
  /** Each open owns a fresh query; a closed panel has no live resource. */
  const [query, setQuery] = useState<ReturnType<typeof createSearchQuery> | null>(null)
  useEffect(() => {
    if (!open) return
    /** Effect-local owner cannot be reused after terminal cleanup. */
    const owner = createSearchQuery(locale)
    setQuery(owner)
    return () => {
      owner.dispose()
      setQuery(null)
    }
  }, [locale, open])
  return open && query?.locale === locale ? (
    <PaletteSession
      locale={locale}
      onOpenChange={onOpenChange}
      open={open}
      searchQuery={query}
      history={history}
    />
  ) : null
}
