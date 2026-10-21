import { log } from './log.js'
import { createStore } from '@migaia/store-light'
import { createStoreToken } from '@migaia/store-react'

/** Theme storage host; storage-web loads only when persistence attaches after mount. */
type IThemeHost = ReturnType<typeof import('@migaia/storage-web/local-storage').localStorageHost>
/** Theme persistence handle; store-persist loads only when persistence attaches after mount. */
type IThemePersistHandle = ReturnType<typeof import('@migaia/store-persist/light').persist>

/** Reader preference; system resolves against the current platform appearance. */
export type IThemeChoice = 'light' | 'dark' | 'system'

/** Page UI state; only the reader's theme choice belongs in persistent storage. */
type IUiState = {
  theme: IThemeChoice
  systemDark: boolean
  searchOpen: boolean
  mobileNavOpen: boolean
  /**
   * False until theme persistence has attached (or failed to). The theme toggle and search entries
   * stay disabled until then, so no choice is made before the stored one is in control.
   */
  persistenceReady: boolean
}

/** Shared preference namespace, also used by the existing locale owner. */
export const PREFERENCE_NAMESPACE = 'migaia-website'
/** Logical archive key used by the theme persistence attachment. */
const THEME_KEY = 'theme'
/** Physical key read before application code runs, using storage-web's default encoding. */
export const THEME_PHYSICAL_KEY = `sw1:14:${PREFERENCE_NAMESPACE}:${THEME_KEY}`
/** Read-only compatibility key for preferences saved by the previous website. */
export const LEGACY_THEME_KEY = 'migaia-theme'
/** Platform query shared by the prepaint bridge and the live theme attachment. */
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

/** Creates request-local state without acquiring browser resources during prerendering. */
export function createUiStore() {
  return createStore<IUiState>({
    theme: 'system',
    systemDark: false,
    searchOpen: false,
    mobileNavOpen: false,
    persistenceReady: false
  })
}

/** Store type follows the canonical factory rather than duplicating the Store protocol. */
export type IUiStore = ReturnType<typeof createUiStore>
/** Exact token shared by the page registry and all shell consumers. */
export const uiStoreToken = createStoreToken<IUiStore>('website-ui')

/** Unknown persisted choices retain the documented system appearance fallback. */
export function normalizeThemeChoice(value: unknown): IThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system'
}

/** Resolves the selected theme without reading the DOM or browser APIs. */
export function resolveTheme(state: Pick<IUiState, 'theme' | 'systemDark'>): 'light' | 'dark' {
  /** Hydration can contain an older or unrecognized preference. */
  const choice = normalizeThemeChoice(state.theme)
  return choice === 'dark' || (choice === 'system' && state.systemDark) ? 'dark' : 'light'
}

/**
 * Attaches browser persistence and appearance projection for one committed root effect. Cleanup
 * closes admission immediately and releases borrowed browser resources in order.
 */
export function attachUiRuntime(store: IUiStore): () => void {
  /** Prevents a previous effect's asynchronous hydration from publishing after detach. */
  let closed = false
  /** Platform appearance subscription, acquired only in the client effect. */
  const media = window.matchMedia(DARK_MEDIA_QUERY)
  /** Prepaint already chose storage precedence without changing stored bytes. */
  const choice = document.documentElement.dataset.themeChoice
  store.$set({
    theme: normalizeThemeChoice(choice),
    systemDark: media.matches
  })
  /** Projects reactive state into the existing CSS contract. */
  const project = () => {
    if (closed) return
    /** Resolved appearance consumed by CSS and native browser controls. */
    const theme = resolveTheme(store)
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.themeChoice = normalizeThemeChoice(store.theme)
    document.documentElement.style.colorScheme = theme
  }
  /** Store owns state; this subscription owns only the DOM projection. */
  const unsubscribe = store.$subscribe(project)
  project()
  /** Updates the platform input while retaining the reader's explicit choice. */
  const followSystem = () => {
    if (!closed) store.$set({ systemDark: media.matches })
  }
  media.addEventListener('change', followSystem)
  /** Host and attachment belong to this effect, never to server rendering. */
  let host: IThemeHost | undefined
  /** Persistence attachment borrows the Store and host. */
  let handle: IThemePersistHandle | undefined
  /** Reports persistence failure once even when both a signal and an awaited flush see it. */
  let lastReported: unknown
  /** Preserves the original error object across automatic and explicit write reporting. */
  const reportPersistence = (error: unknown) => {
    if (closed || error === undefined || error === lastReported) return
    lastReported = error
    log.error(error)
  }
  /** Observes automatic writes, whose failures are exposed through the persistence signal. */
  let writeErrors: ReturnType<IUiStore['$runtime']['effect']> | undefined
  /**
   * Persistence is not needed to paint: the prepaint script already applied the saved theme. Its
   * libraries therefore load after mount, outside the first-screen bundle.
   */
  void (async () => {
    try {
      const [{ persist }, { localStorageHost }] = await Promise.all([
        import('@migaia/store-persist/light'),
        import('@migaia/storage-web/local-storage')
      ])
      if (closed) return
      host = localStorageHost({ namespace: PREFERENCE_NAMESPACE })
      /** Read before persist starts hydration; missing storage values use null. */
      const hadKey = host.sync.get(THEME_KEY) !== null
      handle = persist(store, {
        key: THEME_KEY,
        storage: host,
        version: 1,
        partialize: (state) => ({ theme: state.theme })
      })
      /** Stable effect-local handle used after asynchronous hydration. */
      const attachment = handle
      writeErrors = store.$runtime.effect(() => reportPersistence(attachment.writeError.value))
      await attachment.ready
      if (closed) return
      if (!hadKey) await attachment.flush()
    } catch (error) {
      reportPersistence(error)
    } finally {
      // Failure still releases the controls: the theme then applies to this page only.
      if (!closed) store.$set({ persistenceReady: true })
    }
  })()
  return () => {
    closed = true
    unsubscribe()
    writeErrors?.dispose()
    media.removeEventListener('change', followSystem)
    /** Each owner is released even when a preceding cleanup fails. */
    void (async () => {
      try {
        await handle?.disposeAsync()
      } catch (error) {
        log.error(error)
      }
      try {
        await host?.dispose()
      } catch (error) {
        log.error(error)
      }
    })()
  }
}
