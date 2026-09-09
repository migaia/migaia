import { useEffect, useState } from 'react'
import {
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigation,
  useNavigationType
} from 'react-router'
import './app.css'
import { DOMAINS, LOCALES, type ILocale } from './route-contract.js'
import { copyFor } from './copy.js'
import { loadSearchIndex } from './search.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle
} from './components/ui/dialog.js'
import { Input } from './components/ui/input.js'
import { Button } from './components/ui/button.js'

type IThemeMode = 'light' | 'dark' | 'time'
type ITimePhase = 'sunrise' | 'sunset' | 'night' | 'midnight'
type IThemeChoice = IThemeMode | ITimePhase

/** Persistent browser key for the reader-selected color mode. */
const THEME_STORAGE_KEY = 'migaia-theme'

/** Applies the saved theme before styles paint so hydration never exposes the light fallback. */
const THEME_BOOT_SCRIPT = `(()=>{try{const r=document.documentElement;const t=localStorage.getItem('migaia-theme');const a=['light','dark','time','sunrise','sunset','night','midnight'];const c=a.includes(t)?t:'light';const f=['sunrise','sunset','night','midnight'].includes(c)?c:null;const h=new Date().getHours();const p=h>=5&&h<12?'sunrise':h>=12&&h<19?'sunset':h>=19&&h<23?'night':'midnight';r.dataset.theme=c==='time'||f?'time':c;if(c==='time'||f)r.dataset.timePhase=f||p;else delete r.dataset.timePhase;r.style.colorScheme=c==='dark'||(r.dataset.theme==='time'&&(r.dataset.timePhase==='night'||r.dataset.timePhase==='midnight'))?'dark':'light'}catch{}})()`

/** Resolves the local-clock phase used by the time-gradient theme. */
function timePhase(date: Date): ITimePhase {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'sunrise'
  if (hour >= 12 && hour < 19) return 'sunset'
  if (hour >= 19 && hour < 23) return 'night'
  return 'midnight'
}

/** Returns the reader-facing label for one fixed local-clock phase. */
function timePhaseLabel(locale: ILocale, phase: ITimePhase): string {
  if (locale === 'en') return phase
  return {
    sunrise: '日出',
    sunset: '日落',
    night: '夜晚',
    midnight: '午夜'
  }[phase]
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
  /** Native-control palette that matches the resolved canvas rather than the stored mode name. */
  const darkCanvas =
    root.dataset.theme === 'dark' ||
    (root.dataset.theme === 'time' &&
      (root.dataset.timePhase === 'night' || root.dataset.timePhase === 'midnight'))
  root.style.colorScheme = darkCanvas ? 'dark' : 'light'
}

/** Supplies the shared static document shell and its keyboard-first orientation controls. */
export function Layout({ children }: { children: React.ReactNode }) {
  const locale = localeFromPath(useLocation().pathname)
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
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

/** Renders global navigation, demand-loaded search, language selection, and theme control. */
function ShellHeader() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchLoaded, setSearchLoaded] = useState(false)
  const [theme, setTheme] = useState<IThemeChoice>('light')
  const [phase, setPhase] = useState<ITimePhase>(() => timePhase(new Date()))
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
    /** Opens search from the Quip-style Option+J shortcut without inserting the Option glyph. */
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.code !== 'KeyJ') return
      event.preventDefault()
      void openSearch()
    }
    window.addEventListener('keydown', handleSearchShortcut)
    return () => window.removeEventListener('keydown', handleSearchShortcut)
  }, [searchLoaded])

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
        <Link
          className="brand"
          to={`/${locale}`}
          aria-label={locale === 'zh' ? 'Migaia 文档首页' : 'Migaia library home'}
        >
          migaia
        </Link>
        <nav className="global-nav" aria-label={copy.primaryNavigation}>
          {DOMAINS.map((domain) => (
            <Link key={domain} to={`/${locale}/${domain}`}>
              {domain === 'docs'
                ? copy.docs
                : domain === 'guides'
                  ? copy.guides
                  : copy.architecture}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
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
          <Button type="button" variant="quiet" aria-keyshortcuts="Alt+J" onClick={openSearch}>
            {copy.search} <kbd>⌥J</kbd>
          </Button>
          <Link
            className="language-link"
            to={alternateLocalePath}
            aria-label={locale === 'zh' ? '切换至英文' : 'Switch to Chinese'}
          >
            {locale === 'zh' ? 'En' : '中文'}
          </Link>
          <select
            className="theme-select"
            value={theme}
            onChange={(event) => selectTheme(event.target.value as IThemeChoice)}
            aria-label={copy.theme}
          >
            <option value="light">{locale === 'zh' ? '日间' : 'Light'}</option>
            <option value="dark">{locale === 'zh' ? '夜间' : 'Dark'}</option>
            <option value="time">
              {locale === 'zh'
                ? `跟随时间 · ${timePhaseLabel(locale, phase)}`
                : `Auto · ${timePhaseLabel(locale, phase)}`}
            </option>
            <option value="sunrise">{locale === 'zh' ? '日出' : 'Sunrise'}</option>
            <option value="sunset">{locale === 'zh' ? '日落' : 'Sunset'}</option>
            <option value="night">{locale === 'zh' ? '夜晚' : 'Night'}</option>
            <option value="midnight">{locale === 'zh' ? '午夜' : 'Midnight'}</option>
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
            <Button type="button" variant="quiet" onClick={() => setMobileNavOpen(false)}>
              {copy.close}
            </Button>
          </div>
          <nav aria-label={copy.mobileNavigation}>
            {DOMAINS.map((domain) => (
              <Link
                key={domain}
                onClick={() => setMobileNavOpen(false)}
                to={`/${locale}/${domain}`}
              >
                {domain === 'docs'
                  ? copy.docs
                  : domain === 'guides'
                    ? copy.guides
                    : copy.architecture}
              </Link>
            ))}
          </nav>
        </dialog>
      ) : null}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogPortal>
          <DialogOverlay />
          <DialogContent
            aria-describedby="site-search-description"
            onEscapeKeyDown={() => setSearchOpen(false)}
            onPointerDownOutside={() => setSearchOpen(false)}
          >
            <div className="search-panel-header">
              <DialogTitle>{copy.searchLabel}</DialogTitle>
            </div>
            <div className="search-field">
              <Input
                id="site-search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder=" "
              />
              <label htmlFor="site-search">{copy.searchPlaceholder}</label>
            </div>
            <DialogDescription id="site-search-description" className="search-state">
              {query.trim() ? copy.searchUnknown : copy.searchEmpty}
            </DialogDescription>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  )
}

/** Renders the active route inside the shared orientation shell. */
function App() {
  return (
    <>
      <ShellHeader />
      <RouteTransition />
      <RouteScrollReset />
      <Outlet />
    </>
  )
}

/** Keeps the previous page visually covered by a theme-aware particle veil while data routes load. */
function RouteTransition() {
  const navigation = useNavigation()
  return (
    <div
      className="route-transition"
      data-active={navigation.state === 'idle' ? 'false' : 'true'}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
    </div>
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
