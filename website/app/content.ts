import apiManifest from '../src/generated/manifests/apis.json'
import libraryManifest from '../src/generated/manifests/libraries.json'

/** Supported language prefixes used by every public route. */
export const LOCALES = ['en', 'zh'] as const

/** Public content domains rendered by the shared route module. */
export const DOMAINS = ['docs', 'guides', 'architecture'] as const

export type ILocale = (typeof LOCALES)[number]
export type IDomain = (typeof DOMAINS)[number]

/** Generated library fact used by navigation and page recipes. */
export type ILibrary = {
  readonly slug: string
  readonly description: string | null
  readonly version: string | null
  readonly exports: readonly string[]
}

/** Generated public API projection with the required documentation sections. */
export type IApi = {
  readonly id: string
  readonly library: string
  readonly module: string
  readonly exportPath: string
  readonly sections: readonly string[]
  readonly guidePath: string
  readonly architecturePath: string
  readonly symbols: readonly IApiSymbol[]
  readonly aliases: readonly IApiAlias[]
}

/** Alias-only export projection pointing to a canonical symbol owner. */
export type IApiAlias = {
  readonly name: string
  readonly signature: string
  readonly source: string
  readonly exportPath: string
  readonly ownerExportPath: string
  readonly ownerModule: string
  readonly ownerFragment: string
}

/** Source-backed public symbol projection shown under its owning module. */
export type IApiSymbol = {
  readonly name: string
  readonly kind: string
  readonly fragment: string
  readonly signature: string
  readonly source: string
  readonly purpose: string
  readonly core: string
  readonly advanced: string
  readonly parameters: readonly string[]
  readonly returns: string
  readonly errors: readonly string[]
  readonly lifecycleConcurrency: string
  readonly parameterDetails: readonly {
    readonly name: string
    readonly type: string
    readonly optional: boolean
  }[]
  readonly examples: readonly string[]
  readonly whenToUse: string
  readonly notUse: string
  readonly sections: readonly {
    readonly id: string
    readonly title: string
    readonly content: string
    readonly example?: string
  }[]
  readonly exportPath: string
}

/** Runtime view of generated library facts. */
export const libraries = libraryManifest.libraries as readonly ILibrary[]

/** Runtime view of generated API facts. */
export const apis = apiManifest.apis as readonly IApi[]

/** Finds one library by its canonical URL slug. */
export function findLibrary(slug: string): ILibrary | undefined {
  return libraries.find((library) => library.slug === slug)
}

/** Finds APIs belonging to one library, preserving generated export order. */
export function findLibraryApis(slug: string): readonly IApi[] {
  return apis.filter((api) => api.library === slug)
}

/** Builds a locale-preserving URL for a domain/library destination. */
export function domainPath(locale: ILocale, domain: IDomain, library?: string): string {
  return `/${locale}/${domain}${library ? `/${library}` : ''}`
}

/** Converts an export path into a readable module slug without exposing repository terms. */
export function moduleSlug(exportPath: string): string {
  return exportPath === '.' ? 'index' : exportPath.replace(/^\.\//, '').replaceAll('/', '-')
}
