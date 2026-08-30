import { useEffect, useState } from 'react'
import { Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation } from 'react-router'
import './app.css'
import { DOMAINS, LOCALES, type ILocale } from './content.js'
import { copyFor } from './copy.js'
import { loadSearchIndex } from './search.js'

type IThemeMode = 'light' | 'dark' | 'time'
type ITimePhase = 'sunrise' | 'sunset' | 'night' | 'midnight'
type IThemeChoice = IThemeMode | ITimePhase

/** Persistent browser key for the reader-selected color mode. */
const THEME_STORAGE_KEY = 'migai-theme'

/** Resolves the local-clock phase used by the time-gradient theme. */
function timePhase(date: Date): ITimePhase {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'sunrise'
  if (hour >= 12 && hour < 19) return 'sunset'
  if (hour >= 19 && hour < 23) return 'night'
  return 'midnight'
}

/** Applies one theme contract and its current local-clock phase to the document root. */
function applyTheme(choice: IThemeChoice, date = new Date()) {
  const root = document.documentElement
  const fixedPhase =
    choice === 'sunrise' || choice === 'sunset' || choice === 'night' || choice === 'midnight'
      ? choice
      : undefined
  root.dataset.theme = choice === 'time' || fixedPhase ? 'time' : choice
  if (choice === 'time' || fixedPhase) root.dataset.timePhase = fixedPhase ?? timePhase(date)
  else delete root.dataset.timePhase
}

/** Supplies the shared static document shell and its keyboard-first orientation controls. */
export function Layout({ children }: { children: React.ReactNode }) {
  const locale = localeFromPath(useLocation().pathname)
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

/** Returns the current locale from the browser URL without creating route state. */
function localeFromPath(pathname: string): ILocale {
  const segment = pathname.split('/')[1]
  return LOCALES.includes(segment as ILocale) ? (segment as ILocale) : 'en'
}

/** Renders global navigation, demand-loaded search, language selection, and theme control. */
function ShellHeader() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchLoaded, setSearchLoaded] = useState(false)
  const [theme, setTheme] = useState<IThemeChoice>('light')
  const [phase, setPhase] = useState<ITimePhase>(() => timePhase(new Date()))
  const locale = localeFromPath(useLocation().pathname)
  const copy = copyFor(locale)

  /** Loads Pagefind only after the user opens search. */
  async function openSearch() {
    setSearchOpen(true)
    if (!searchLoaded) {
      try {
        await loadSearchIndex()
      } catch {
        // The static Pagefind index is optional during local development; keep the
        // demand-loaded panel usable with its deterministic empty state.
      }
      setSearchLoaded(true)
    }
  }

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    const availableThemes: readonly IThemeChoice[] = [
      'light',
      'dark',
      'time',
      'sunrise',
      'sunset',
      'night',
      'midnight'
    ]
    const initialTheme: IThemeChoice = availableThemes.includes(storedTheme as IThemeChoice)
      ? (storedTheme as IThemeChoice)
      : 'light'
    setTheme(initialTheme)
    setPhase(timePhase(new Date()))
    applyTheme(initialTheme)
  }, [])

  useEffect(() => {
    if (theme !== 'time') return
    /** Refreshes the phase after local-clock boundaries without reloading the page. */
    const refreshPhase = () => {
      const nextPhase = timePhase(new Date())
      setPhase(nextPhase)
      applyTheme('time')
    }
    refreshPhase()
    const timer = window.setInterval(refreshPhase, 60_000)
    return () => window.clearInterval(timer)
  }, [theme])

  /** Applies and persists an explicit reader choice, including fixed phase previews. */
  function selectTheme(nextTheme: IThemeChoice) {
    setTheme(nextTheme)
    applyTheme(nextTheme)
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        {copy.skip}
      </a>
      <header className="site-header">
        <Link className="brand" to={`/${locale}`} aria-label="Migai library home">
          migai
        </Link>
        <nav className="global-nav" aria-label={copy.primaryNavigation}>
          {DOMAINS.map((domain) => (
            <Link key={domain} to={`/${locale}/${domain}`}>
              {domain === 'docs' ? 'Docs' : domain === 'guides' ? 'Guides' : copy.architecture}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <button
            type="button"
            className="button button-quiet mobile-nav-trigger"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {copy.menu}
          </button>
          <button type="button" className="button button-quiet" onClick={openSearch}>
            {copy.search} <kbd>⌘K</kbd>
          </button>
          {LOCALES.map((candidate) => (
            <Link
              key={candidate}
              className={candidate === locale ? 'language-link active' : 'language-link'}
              to={`/${candidate}`}
              aria-label={`Switch to ${candidate}`}
            >
              {candidate}
            </Link>
          ))}
          <select
            className="theme-select"
            value={theme}
            onChange={(event) => selectTheme(event.target.value as IThemeChoice)}
            aria-label={copy.theme}
          >
            <option value="light">{locale === 'zh' ? '日间' : 'Light'}</option>
            <option value="dark">{locale === 'zh' ? '夜间' : 'Dark'}</option>
            <option value="time">
              {locale === 'zh' ? `跟随时间 · ${phase}` : `Auto · ${phase}`}
            </option>
            <option value="sunrise">Sunrise</option>
            <option value="sunset">Sunset</option>
            <option value="night">Night</option>
            <option value="midnight">Midnight</option>
          </select>
        </div>
      </header>
      {mobileNavOpen ? (
        <dialog
          className="mobile-sheet"
          id="mobile-navigation"
          open
          aria-label={copy.mobileNavigation}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMobileNavOpen(false)
          }}
        >
          <div className="mobile-sheet-header">
            <strong>{copy.navigate}</strong>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setMobileNavOpen(false)}
            >
              {copy.close}
            </button>
          </div>
          <nav aria-label={copy.mobileNavigation}>
            {DOMAINS.map((domain) => (
              <Link
                key={domain}
                onClick={() => setMobileNavOpen(false)}
                to={`/${locale}/${domain}`}
              >
                {domain === 'docs' ? 'Docs' : domain === 'guides' ? 'Guides' : copy.architecture}
              </Link>
            ))}
          </nav>
        </dialog>
      ) : null}
      {searchOpen ? (
        <section
          className="search-panel"
          aria-label={copy.search}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSearchOpen(false)
          }}
        >
          <label htmlFor="site-search">{copy.searchLabel}</label>
          <input
            id="site-search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
          />
          <p className="search-state">{query.trim() ? copy.searchUnknown : copy.searchEmpty}</p>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setSearchOpen(false)}
          >
            {copy.close}
          </button>
        </section>
      ) : null}
    </>
  )
}

/** Renders the active route inside the shared orientation shell. */
export default function App() {
  return (
    <>
      <ShellHeader />
      <Outlet />
    </>
  )
}

/** Renders a stable fallback while preserving the global recovery actions. */
export function ErrorBoundary() {
  const locale = localeFromPath(useLocation().pathname)
  return (
    <main className="page-shell">
      <p className="eyebrow">Not found</p>
      <h1>That page is not available.</h1>
      <p className="lede">The path does not map to a current library or documented topic.</p>
      <div className="actions">
        <Link className="button button-primary" to={`/${locale}/docs`}>
          Browse Docs
        </Link>
        <Link className="button button-secondary" to={`/${locale}/guides`}>
          Browse Guides
        </Link>
        <Link className="button button-secondary" to={`/${locale}`}>
          Language home
        </Link>
      </div>
    </main>
  )
}
