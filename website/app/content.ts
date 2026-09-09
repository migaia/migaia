import apiManifest from '../src/generated/manifests/apis.json'
import libraryManifest from '../src/generated/manifests/libraries.json'
export { domainPath, type IDomain, type ILocale } from './route-contract.js'

/** Generated library fact used by navigation and page recipes. */
export type ILibrary = {
  readonly slug: string
  readonly description: string | null
  readonly version: string | null
  readonly exports: readonly string[]
  readonly documentation: {
    readonly readme: IMaintainedDocument | null
    readonly guide: IMaintainedDocument | null
  }
}

export type IMaintainedBlock =
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'list'; readonly items: readonly string[] }
  | { readonly type: 'code'; readonly language: string; readonly code: string }
  | {
      readonly type: 'table'
      readonly headers: readonly string[]
      readonly rows: readonly (readonly string[])[]
    }

export type IMaintainedDocument = {
  readonly sections: readonly {
    readonly id: string
    readonly heading: string
    readonly blocks: readonly IMaintainedBlock[]
  }[]
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

/** Public instance member extracted from a class declaration. */
export type IApiMember = {
  readonly name: string
  readonly kind: string
  readonly signature: string
  readonly description: string | null
  readonly parameterDetails: readonly {
    readonly name: string
    readonly type: string
    readonly optional: boolean
  }[]
  readonly returns: string
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
  readonly members: readonly IApiMember[]
  readonly examples: readonly string[]
  /** Maintained task/configuration guidance directly bound to this public API. */
  readonly guidance: readonly {
    readonly id: string
    readonly heading: string
    readonly blocks: readonly IMaintainedBlock[]
  }[]
  /** Object configuration fields projected from the maintained API contract. */
  readonly configuration: readonly {
    readonly name: string
    readonly type: string
    readonly optional: boolean
    readonly description: string
    readonly descriptionEn?: string
    readonly descriptionZh?: string
  }[]
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

/** Converts an export path into a readable module slug without exposing repository terms. */
export function moduleSlug(exportPath: string): string {
  return exportPath === '.' ? 'index' : exportPath.replace(/^\.\//, '')
}

/** Produces a stable semantic path, adding a readable kind only for case-folding collisions. */
export function symbolSlug(
  symbol: Pick<IApiSymbol, 'kind' | 'name'>,
  siblings: readonly Pick<IApiSymbol, 'kind' | 'name'>[]
): string {
  const collisions = siblings.filter(
    (candidate) =>
      candidate.name.toLocaleLowerCase('en-US') === symbol.name.toLocaleLowerCase('en-US')
  )
  return `${encodeURIComponent(symbol.name)}${collisions.length > 1 ? `-${symbol.kind}` : ''}`
}
