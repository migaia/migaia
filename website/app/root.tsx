import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  Links,
  type LinksFunction as ILinksFunction,
  Meta,
  type MetaFunction as IMetaFunction,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigation,
  useNavigationType
} from 'react-router'
// Self-hosted variable fonts are bundled with the site; no font request leaves its origin.
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './app.css'
import faviconHref from './favicon.svg?url'
import { BRAND_BLADE_PATH, whirlBrandMark } from './brand-mark.js'
import { energizeCardEdge, trackCardFocus } from './card-focus.js'
import { LOCALES, type ILocale } from './route-contract.js'
import { copyFor, interfaceCopyFor } from './copy.js'
import { revealRouteContent } from './motion.js'
import { OPEN_SEARCH_EVENT } from './search.js'
import { Button } from './components/ui/button.js'
import type { IPageNavigationContext } from './components/page-navigation.js'

/**
 * Reader-selected color mode. `system` follows `prefers-color-scheme`; the document root always
 * carries the resolved `light` or `dark` value in `data-theme`.
 */
type IThemeChoice = 'light' | 'dark' | 'system'

/** Order the header toggle cycles through. */
const THEME_CYCLE: readonly IThemeChoice[] = ['light', 'dark', 'system']

/** Existing recovery-page purpose used when no page route supplies more specific metadata. */
const ROOT_DESCRIPTION = 'The path does not map to a current library or documented topic.'

/** Keeps the document titled when a route resolves to the shared recovery boundary. */
export const meta: IMetaFunction = () => [
  { title: 'migaia' },
  { name: 'description', content: ROOT_DESCRIPTION }
]

/** Tab icon: the brand mark, emitted through Vite so it ships with the hashed assets. */
export const links: ILinksFunction = () => [
  { rel: 'icon', type: 'image/svg+xml', href: faviconHref }
]

/** Persistent browser key for the reader-selected color mode. */
const THEME_STORAGE_KEY = 'migaia-theme'

/**
 * Applies the saved theme before styles paint so hydration never flashes the wrong palette. Legacy
 * stored values from the retired time theme fall back to `system`.
 */
const THEME_BOOT_SCRIPT = `(()=>{try{const r=document.documentElement;let c=localStorage.getItem('migaia-theme');if(c!=='light'&&c!=='dark')c='system';const d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);r.dataset.theme=d?'dark':'light';r.dataset.themeChoice=c;r.style.colorScheme=d?'dark':'light'}catch{}})()`

/** Resolves a choice against the platform preference and applies it to the document root. */
function applyTheme(choice: IThemeChoice) {
  const root = document.documentElement
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.themeChoice = choice
  root.style.colorScheme = dark ? 'dark' : 'light'
}

/** Reads the stored choice; anything unknown (including retired time-theme values) is `system`. */
function storedTheme(): IThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/**
 * Strips a trailing slash from the address before hydration. Static hosts redirect `/zh/docs/x` to
 * the directory URL `/zh/docs/x/`; React Router then requests `/zh/docs/x/_.data`, which is never
 * prerendered, so a later Back to that entry rendered the not-found page. The site root (Vite base,
 * `/` or `/migaia/`) keeps its slash because React Router's basename includes it.
 */
const TRAILING_SLASH_BOOT_SCRIPT = `(()=>{const p=location.pathname;if(p!==${JSON.stringify(import.meta.env.BASE_URL)}&&p.endsWith('/'))history.replaceState(history.state,'',p.replace(/\\/+$/,'')+location.search+location.hash)})()`

/**
 * Production network policy: the page may only fetch from its own origin (route data, the search
 * index). Fonts, the hero shader, and motion ship inside the build, so no request, telemetry
 * beacon, or socket can leave for another host. Dev builds skip it so Vite's HMR socket still
 * works.
 */
const CONNECT_POLICY = "connect-src 'self'"

/** Supplies the shared static document shell and its keyboard-first orientation controls. */
export function Layout({ children }: { children: React.ReactNode }) {
  const locale = localeFromPath(useLocation().pathname)
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {import.meta.env.PROD ? (
          <meta httpEquiv="Content-Security-Policy" content={CONNECT_POLICY} />
        ) : null}
        <Meta />
        <script dangerouslySetInnerHTML={{ __html: TRAILING_SLASH_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
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

/** Theme toggle glyphs: sun for light, moon for dark, half-filled display for system. */
function ThemeIcon({ choice }: { readonly choice: IThemeChoice }) {
  if (choice === 'light')
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
      </svg>
    )
  if (choice === 'dark')
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16">
        <path d="M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8Z" />
      </svg>
    )
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <rect height="9" rx="1.5" width="12" x="2" y="2.5" />
      <path d="M6 14h4M8 11.5V14" />
    </svg>
  )
}

/**
 * Brand mark: a Kotoamatsukami eye (Shisui's Mangekyō) — four curved blades turning like a pinwheel
 * out of an inner ring, around an accent pupil. One blade is drawn and rotated by quarter turns so
 * all four stay identical. Uses theme tokens plus the accent so it follows both themes.
 */
function BrandMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 20 20">
      <circle className="brand-mark-ring" cx="10" cy="10" r="4.4" />
      {[0, 90, 180, 270].map((angle) => (
        <path
          className="brand-mark-node"
          d={BRAND_BLADE_PATH}
          key={angle}
          transform={`rotate(${angle} 10 10)`}
        />
      ))}
      <circle className="brand-mark-node accent" cx="10" cy="10" r="2.2" />
    </svg>
  )
}

/**
 * Site-wide WebGPU background chunk; requested after hydration so it never weighs on the first page
 * payload, and rendered client-only so prerendered markup stays unchanged.
 */
const AmbientField = lazy(() => import('./components/ambient-field.js'))

/** Command palette chunk; downloaded the first time the reader opens search. */
const CommandPalette = lazy(() => import('./components/command-palette.js'))

/** Renders the sticky header: brand, library context, ⌘K search, language, and theme. */
function ShellHeader({ pageNavigation }: { readonly pageNavigation: React.ReactNode }) {
  /** Palette visibility. */
  const [searchOpen, setSearchOpen] = useState(false)
  /** Mounts the lazy palette only after the first open so the shell ships without it. */
  const [searchMounted, setSearchMounted] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  /** Choice starts as `system` so prerendered markup matches; mount reads the stored value. */
  const [theme, setTheme] = useState<IThemeChoice>('system')
  /** Header shows its hairline only after the page scrolls under it. */
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()
  const locale = localeFromPath(location.pathname)
  /** Opposite locale exposed as the header's single language-switch destination. */
  const alternateLocale: ILocale = locale === 'zh' ? 'en' : 'zh'
  /** Client-routable pathname without the static preview server's file suffix. */
  const canonicalPathname = location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '')
  /** Equivalent localized route, including the active query string and document anchor. */
  const alternateLocalePath = `${
    /^\/(?:en|zh)(?=\/|$)/.test(canonicalPathname)
      ? canonicalPathname.replace(/^\/(?:en|zh)(?=\/|$)/, `/${alternateLocale}`)
      : `/${alternateLocale}${canonicalPathname}`
  }${location.search}${location.hash}`
  /** Library slug of the current docs page, shown as the header context crumb. */
  const currentLibrary = canonicalPathname.match(/^\/(?:en|zh)\/docs\/([^/]+)/)?.[1]
  const copy = copyFor(locale)
  const ui = interfaceCopyFor(locale)
  /** Visible name of the current theme choice for the toggle's accessible label. */
  const themeName =
    theme === 'light' ? ui.themeLight : theme === 'dark' ? ui.themeDark : ui.themeSystem

  /** Page navigation links close the existing menu after React Router changes the route. */
  useEffect(() => setMobileNavOpen(false), [location.pathname])

  /** Opens the palette, mounting its lazy chunk on first use. */
  const openSearch = () => {
    setSearchMounted(true)
    setSearchOpen(true)
  }

  useEffect(() => {
    /** ⌘K / Ctrl+K open search everywhere; the older ⌥J shortcut keeps working. */
    const handleSearchShortcut = (event: KeyboardEvent) => {
      const commandK = (event.metaKey || event.ctrlKey) && event.code === 'KeyK'
      const optionJ = event.altKey && !event.metaKey && !event.ctrlKey && event.code === 'KeyJ'
      if (!commandK && !optionJ) return
      event.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', handleSearchShortcut)
    window.addEventListener(OPEN_SEARCH_EVENT, openSearch)
    return () => {
      window.removeEventListener('keydown', handleSearchShortcut)
      window.removeEventListener(OPEN_SEARCH_EVENT, openSearch)
    }
  }, [])

  useEffect(() => {
    const initial = storedTheme()
    setTheme(initial)
    applyTheme(initial)
    /** A `system` choice follows live platform changes without a reload. */
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const follow = () => {
      if (document.documentElement.dataset.themeChoice === 'system') applyTheme('system')
    }
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [])

  useEffect(() => {
    /** Passive scroll probe; only the boolean crossing re-renders. */
    const update = () => setScrolled(window.scrollY > 8)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  /** Advances light → dark → system and persists the explicit reader choice. */
  function cycleTheme() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length]!
    setTheme(next)
    applyTheme(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch (error) {
      // Storage can be unavailable (private mode); the choice still applies to this page.
      console.error(error)
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        {copy.skip}
      </a>
      <header className="site-header" data-scrolled={scrolled ? 'true' : 'false'}>
        <div className="site-header-inner">
          <Link
            className="brand"
            to={`/${locale}`}
            aria-label={ui.brandHome}
            onMouseEnter={(event) =>
              whirlBrandMark(event.currentTarget.querySelector('.brand-mark'))
            }
          >
            <BrandMark />
            <span>migaia</span>
          </Link>
          <nav className="global-nav" aria-label={copy.primaryNavigation}>
            {currentLibrary ? (
              <>
                <span aria-hidden="true" className="global-nav-separator">
                  /
                </span>
                <button
                  aria-label={`${ui.switchLibrary}: ${currentLibrary}`}
                  className="library-switcher"
                  onClick={openSearch}
                  type="button"
                >
                  <span>{currentLibrary}</span>
                  <svg aria-hidden="true" viewBox="0 0 16 16">
                    <path d="m5 6.5 3 3 3-3" />
                  </svg>
                </button>
              </>
            ) : null}
          </nav>
          <div className="header-actions">
            <button
              aria-keyshortcuts="Meta+K Control+K Alt+J"
              className="search-trigger"
              onClick={openSearch}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16">
                <circle cx="7" cy="7" r="4.75" />
                <path d="m10.5 10.5 3 3" />
              </svg>
              <span>{ui.searchTrigger}</span>
              <kbd>⌘K</kbd>
            </button>
            <Button
              type="button"
              variant="quiet"
              className="mobile-nav-trigger"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {copy.menu}
            </Button>
            <Link
              className="language-link"
              to={alternateLocalePath}
              aria-label={locale === 'zh' ? '切换至英文' : 'Switch to Chinese'}
            >
              {locale === 'zh' ? 'EN' : '中'}
            </Link>
            <button
              aria-label={`${ui.themeCurrent}: ${themeName}`}
              className="theme-toggle"
              data-choice={theme}
              onClick={cycleTheme}
              title={`${ui.themeCurrent}: ${themeName}`}
              type="button"
            >
              <ThemeIcon choice={theme} />
            </button>
          </div>
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
            <Button type="button" variant="quiet" onClick={() => setMobileNavOpen(false)}>
              {copy.close}
            </Button>
          </div>
          {pageNavigation ? (
            <div className="mobile-page-navigation left-rail-content">{pageNavigation}</div>
          ) : null}
        </dialog>
      ) : null}
      {searchMounted ? (
        <Suspense fallback={null}>
          <CommandPalette locale={locale} onOpenChange={setSearchOpen} open={searchOpen} />
        </Suspense>
      ) : null}
    </>
  )
}

/** Renders the active route inside the shared orientation shell. */
function App() {
  /** The active outlet supplies category links without moving its article into the header. */
  const [pageNavigation, setPageNavigation] = useState<React.ReactNode>(null)
  /** A stable registration boundary keeps route updates from repeatedly installing the same menu. */
  const navigationContext = useMemo<IPageNavigationContext>(() => ({ setPageNavigation }), [])
  /** Turns true after hydration; gates the client-only ambient background. */
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  /** Speeds up and flickers the edge light of the card under the pointer. */
  useEffect(() => {
    /** Restores the previously focused card's edge light. */
    let restore = () => {}
    const stop = trackCardFocus((card) => {
      restore()
      restore = card ? energizeCardEdge(card) : () => {}
    })
    return () => {
      stop()
      restore()
    }
  }, [])
  return (
    <>
      {hydrated ? (
        <Suspense fallback={null}>
          <AmbientField />
        </Suspense>
      ) : null}
      <ShellHeader pageNavigation={pageNavigation} />
      <RouteProgress />
      <RouteScrollReset />
      <Outlet context={navigationContext} />
    </>
  )
}

/**
 * Thin accent bar under the header while a route's data loads, then a short fade-and-rise of the
 * new article after push/replace navigations. History (POP) and in-page anchors stay still.
 */
function RouteProgress() {
  const navigation = useNavigation()
  const { hash, pathname } = useLocation()
  const navigationType = useNavigationType()
  /** Skips the first effect run so the initial server-rendered page is never re-animated. */
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (navigationType === 'POP' || hash) return
    void revealRouteContent(
      document.querySelector('.article-column') ?? document.querySelector('#main-content')
    )
  }, [hash, navigationType, pathname])

  return (
    <div
      aria-hidden="true"
      className="route-progress"
      data-active={navigation.state !== 'idle' ? 'true' : 'false'}
    />
  )
}

/** Resets new route visits while preserving hash targets and browser history restoration. */
function RouteScrollReset() {
  const { hash, pathname } = useLocation()
  const navigationType = useNavigationType()
  useEffect(() => {
    if (navigationType === 'POP' || hash) return
    window.scrollTo({ left: 0, top: 0 })
  }, [hash, navigationType, pathname])
  return null
}

export default App

/** Renders a stable fallback while preserving the global recovery actions. */
export function ErrorBoundary() {
  const locale = localeFromPath(useLocation().pathname)
  return (
    <main className="page-shell">
      <p className="eyebrow">Not found</p>
      <h1>That page is not available.</h1>
      <p className="lede">{ROOT_DESCRIPTION}</p>
      <div className="actions">
        <Link className="button button-primary" to={`/${locale}/docs`}>
          Browse Docs
        </Link>
        <Link className="button button-secondary" to={`/${locale}`}>
          Language home
        </Link>
      </div>
    </main>
  )
}
