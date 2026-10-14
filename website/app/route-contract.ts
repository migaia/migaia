/** Supported language prefixes used by every public route. */
export const LOCALES = ['en', 'zh'] as const

/** The single public content domain; guides and API reference both live under it. */
export const DOMAINS = ['docs'] as const

/** Path segment that separates API reference pages from guide topics inside one library. */
export const API_SEGMENT = 'api'

export type ILocale = (typeof LOCALES)[number]

/**
 * Page kind rendered by the docs route: `docs` is API reference, `guides` is a learning-path or
 * topic page. It is not a URL segment; every page URL starts with `/<locale>/docs`.
 */
export type IDomain = 'docs' | 'guides'

/** Builds a locale-preserving docs URL; a library link opens that library's learning path. */
export function domainPath(locale: ILocale, library?: string): string {
  return `/${locale}/docs${library ? `/${library}` : ''}`
}

/** Builds the URL of one guide topic; `index` is the library learning path itself. */
export function guidePath(locale: ILocale, library: string, topic = 'index'): string {
  return `/${locale}/docs/${library}${topic === 'index' ? '' : `/${topic}`}`
}
