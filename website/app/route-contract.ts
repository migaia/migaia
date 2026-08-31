/** Supported language prefixes used by every public route. */
export const LOCALES = ['en', 'zh'] as const

/** Public content domains rendered by the shared route module. */
export const DOMAINS = ['docs', 'guides', 'architecture'] as const

export type ILocale = (typeof LOCALES)[number]
export type IDomain = (typeof DOMAINS)[number]

/** Builds a locale-preserving URL without loading generated content manifests. */
export function domainPath(locale: ILocale, domain: IDomain, library?: string): string {
  return `/${locale}/${domain}${library ? `/${library}` : ''}`
}
