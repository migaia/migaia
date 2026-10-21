import { log } from './log.js'
import { LOCALES, type ILocale } from './route-contract.js'
import { PREFERENCE_NAMESPACE } from './ui-state.js'

/** Key under which the reader's last visited documentation language is stored. */
const LOCALE_KEY = 'locale'

/** Namespaced Local Storage store; storage-web loads only when a preference is read or written. */
type IPreferenceStore = ReturnType<
  typeof import('@migaia/storage-web/local-storage').localStorageHost
>

/**
 * Opens the namespaced Local Storage store, loading storage-web on demand so it stays out of the
 * first screen. Resolves `null` and reports when storage is unavailable (private mode, blocked site
 * data); callers then fall back to the browser language.
 */
async function preferenceStore(): Promise<IPreferenceStore | null> {
  try {
    const { localStorageHost } = await import('@migaia/storage-web/local-storage')
    return localStorageHost({ namespace: PREFERENCE_NAMESPACE })
  } catch (error) {
    log.error(error)
    return null
  }
}

/** Reads the stored locale; an absent or unknown value yields `undefined`. */
async function storedLocale(): Promise<ILocale | undefined> {
  const value = (await preferenceStore())?.sync.get(LOCALE_KEY)
  return LOCALES.includes(value as ILocale) ? (value as ILocale) : undefined
}

/**
 * Chooses the language the site root opens: the reader's last visited language, otherwise the first
 * browser language that matches a supported locale, otherwise English.
 */
export async function preferredLocale(): Promise<ILocale> {
  /** Primary subtag of the first browser language the site supports. */
  const browserLocale = navigator.languages
    .map((language) => language.toLowerCase().split('-')[0])
    .find((language): language is ILocale => LOCALES.includes(language as ILocale))
  return (await storedLocale()) ?? browserLocale ?? 'en'
}

/** Records the language the reader is viewing so the next root visit opens it. */
export async function rememberLocale(locale: ILocale): Promise<void> {
  try {
    ;(await preferenceStore())?.sync.set(LOCALE_KEY, locale)
  } catch (error) {
    // A full or revoked storage only loses the preference; the current page is unaffected.
    log.error(error)
  }
}
