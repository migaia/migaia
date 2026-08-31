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
  readonly guidance: readonly {
    readonly id: string
    readonly heading: string
    readonly blocks: readonly IMaintainedBlock[]
  }[]
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
  /** Documentation-derived use frequency used only to order reader navigation. */
  readonly usageScore: number
}

/** Converts an export path into a readable module slug without exposing repository terms. */
export function moduleSlug(exportPath: string): string {
  return exportPath === '.' ? 'index' : exportPath.replace(/^\.\//, '').replace(/\//g, '-')
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

/** Distinguishes callable values from supporting constant objects using the declaration head only. */
export function isCallableApiSymbol(
  symbol: Pick<IApiSymbol, 'kind' | 'name' | 'signature'>
): boolean {
  if (symbol.kind === 'function' || symbol.kind === 'class') return true
  if (symbol.kind !== 'const') return false
  const escapedName = symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`export declare const ${escapedName}:\\s*(?:<|\\()`).test(symbol.signature)
}
