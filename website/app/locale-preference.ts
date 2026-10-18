import { localStorageHost } from '@migaia/storage-web/local-storage'
import { LOCALES, type ILocale } from './route-contract.js'

/** Namespace of the site's own Local Storage entries, isolated from other apps on the origin. */
const PREFERENCE_NAMESPACE = 'migaia-website'

/** Key under which the reader's last visited documentation language is stored. */
const LOCALE_KEY = 'locale'

/**
 * Opens the namespaced Local Storage store. Returns `null` and reports when storage is unavailable
 * (private mode, blocked site data); callers then fall back to the browser language.
 */
function preferenceStore(): ReturnType<typeof localStorageHost> | null {
  try {
    return localStorageHost({ namespace: PREFERENCE_NAMESPACE })
  } catch (error) {
    console.error(error)
    return null
  }
}

/** Reads the stored locale; an absent or unknown value yields `undefined`. */
function storedLocale(): ILocale | undefined {
  const value = preferenceStore()?.sync.get(LOCALE_KEY)
  return LOCALES.includes(value as ILocale) ? (value as ILocale) : undefined
}

/**
 * Chooses the language the site root opens: the reader's last visited language, otherwise the first
 * browser language that matches a supported locale, otherwise English.
 */
export function preferredLocale(): ILocale {
  /** Primary subtag of the first browser language the site supports. */
  const browserLocale = navigator.languages
    .map((language) => language.toLowerCase().split('-')[0])
    .find((language): language is ILocale => LOCALES.includes(language as ILocale))
  return storedLocale() ?? browserLocale ?? 'en'
}

/** Records the language the reader is viewing so the next root visit opens it. */
export function rememberLocale(locale: ILocale): void {
  try {
    preferenceStore()?.sync.set(LOCALE_KEY, locale)
  } catch (error) {
    // A full or revoked storage only loses the preference; the current page is unaffected.
    console.error(error)
  }
}
