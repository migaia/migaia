export {
  API_SEGMENT,
  README_SEGMENT,
  domainPath,
  guidePath,
  type IDomain,
  type ILocale
} from './route-contract.js'
import type { ILocale } from './route-contract.js'

/** Generated library fact used by navigation and page recipes. */
export type ILibrary = {
  readonly slug: string
  readonly description: string | null
  readonly version: string | null
  readonly exports: readonly string[]
  /** Locales with a maintained package README: Chinese `README.md`, English `README.en.md`. */
  readonly readmeLocales: readonly ILocale[]
  readonly documentation: {
    readonly readme: IMaintainedDocument | null
    readonly guide: IMaintainedDocument | null
    /** English counterparts read from `README.en.md` and `USEGUIDE.en.md`; absent in route data. */
    readonly en?: {
      readonly readme: IMaintainedDocument | null
      readonly guide: IMaintainedDocument | null
    }
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
  /** True when the declaration refers to a named overloaded callable type. */
  readonly callable?: boolean
  readonly name: string
  readonly kind: string
  /**
   * Route segment chosen by the manifest generator when the default `name` segment is taken, for
   * example a root-entry symbol named like a subpath module. Absent when the name is used as is.
   */
  readonly routeSlug?: string
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
  /**
   * Named types this declaration extends or intersects (`A & { ... }`, `extends A`); their members
   * belong to the same instance surface. Absent on compact navigation projections.
   */
  readonly composes?: readonly string[]
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
  return exportPath === '.' ? 'index' : exportPath.replace(/^\.\//, '')
}

/** Resolves a docs URL against public module paths without confusing nested modules with symbols. */
export function resolveDocsSelection(segments: readonly string[], apis: readonly IApi[]) {
  /** Nested candidates are checked deepest-first so `plugins/reactive` wins over `plugins`. */
  const candidates = apis
    .filter((api) => api.module !== 'index')
    .sort((left, right) => right.module.split('/').length - left.module.split('/').length)
  /** The selected module must consume a complete public-path prefix. */
  const selectedApi = candidates.find((api) => {
    /** Public module segments retain the package export hierarchy. */
    const moduleSegments = api.module.split('/')
    return moduleSegments.every((segment, index) => segments[index] === segment)
  })
  if (!selectedApi) return { moduleName: 'index', symbolPath: segments[0] }
  /** The symbol begins immediately after every segment owned by the selected module. */
  const symbolOffset = selectedApi.module.split('/').length
  return { moduleName: selectedApi.module, symbolPath: segments[symbolOffset] }
}

/** Produces a stable semantic path, adding a readable kind only for case-folding collisions. */
export function symbolSlug(
  symbol: Pick<IApiSymbol, 'kind' | 'name' | 'routeSlug'>,
  siblings: readonly Pick<IApiSymbol, 'kind' | 'name'>[]
): string {
  if (symbol.routeSlug) return symbol.routeSlug
  /** Siblings whose names differ from this symbol only by letter case. */
  const collisions = siblings.filter(
    (candidate) =>
      candidate.name.toLocaleLowerCase('en-US') === symbol.name.toLocaleLowerCase('en-US')
  )
  return `${encodeURIComponent(symbol.name)}${collisions.length > 1 ? `-${symbol.kind}` : ''}`
}

/** Distinguishes callable values from supporting constant objects using the declaration head only. */
export function isCallableApiSymbol(
  symbol: Pick<IApiSymbol, 'kind' | 'name' | 'signature' | 'callable'>
): boolean {
  if (symbol.kind === 'function' || symbol.kind === 'class') return true
  if (symbol.kind !== 'const') return false
  if (symbol.callable) return true
  const escapedName = symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`export declare const ${escapedName}:\\s*(?:<|\\()`).test(symbol.signature)
}

/**
 * Declaration kind shown to readers in sidebar markers, page badges and hero accents. A callable
 * `const` (`export const connect = () => …`, or a const typed by a callable alias) is called like a
 * function, so it reads as `function`; only data constants keep `const`. The generated `kind`
 * itself stays unchanged because collision-safe route slugs and declaration grouping depend on it.
 */
export function apiDisplayKind(
  symbol: Pick<IApiSymbol, 'kind' | 'name' | 'signature' | 'callable'>
): string {
  return symbol.kind === 'const' && isCallableApiSymbol(symbol) ? 'function' : symbol.kind
}

/**
 * Empty values of the required symbol fields. Route data omits a field holding exactly this value,
 * because most projected symbols (navigation and link entries) leave nearly every field empty and
 * every docs page would otherwise serialize those empty fields twice: once inlined for hydration
 * and once in its `.data` file. `unpackApis` restores them, so components always see complete
 * symbols.
 */
const EMPTY_SYMBOL_FIELDS = {
  signature: '',
  source: '',
  purpose: '',
  core: '',
  advanced: '',
  parameters: [],
  returns: '',
  errors: [],
  lifecycleConcurrency: '',
  parameterDetails: [],
  members: [],
  examples: [],
  guidance: [],
  configuration: [],
  whenToUse: '',
  notUse: '',
  sections: [],
  exportPath: '',
  usageScore: 0
} as const satisfies Partial<IApiSymbol>

/** Required symbol fields that route data may omit when empty. */
type IEmptySymbolField = keyof typeof EMPTY_SYMBOL_FIELDS

/** Symbol as sent in route data: fields equal to their empty value are absent. */
export type IPackedApiSymbol = Omit<IApiSymbol, IEmptySymbolField> &
  Partial<Pick<IApiSymbol, IEmptySymbolField>>

/** API module as sent in route data, carrying packed symbols. */
export type IPackedApi = Omit<IApi, 'symbols'> & { readonly symbols: readonly IPackedApiSymbol[] }

/**
 * Drops every symbol field that holds its empty value, for route data only, plus a `false`
 * `callable` flag, which readers only test for truthiness. Pair with `unpackApis` on the reading
 * side; the round trip returns symbols that read the same as the input.
 */
export function packApis(apis: readonly IApi[]): readonly IPackedApi[] {
  return apis.map((api) => ({
    ...api,
    symbols: api.symbols.map((symbol) => {
      /** Mutable copy that loses its empty fields below. */
      const packed: Record<string, unknown> = { ...symbol }
      for (const field of Object.keys(EMPTY_SYMBOL_FIELDS) as IEmptySymbolField[]) {
        /** Field value on the source symbol. */
        const value = symbol[field]
        if (value === EMPTY_SYMBOL_FIELDS[field] || (Array.isArray(value) && value.length === 0))
          delete packed[field]
      }
      if (packed['callable'] === false) delete packed['callable']
      return packed as IPackedApiSymbol
    })
  }))
}

/** Restores the empty fields `packApis` dropped, so readers receive complete symbols again. */
export function unpackApis(apis: readonly IPackedApi[]): readonly IApi[] {
  return apis.map((api) => ({
    ...api,
    symbols: api.symbols.map((symbol) => ({ ...EMPTY_SYMBOL_FIELDS, ...symbol }))
  }))
}

/** Sidebar link fields this module packs; `symbolPath` is usually the encoded symbol name. */
type ISymbolLink = { readonly name: string; readonly symbolPath: string }

/** Link as sent in route data: `symbolPath` is absent when it equals the encoded name. */
export type IPackedLink<T extends ISymbolLink> = Omit<T, 'symbolPath'> & {
  readonly symbolPath?: string
}

/**
 * Omits each link's `symbolPath` when it is just `encodeURIComponent(name)`, which holds for every
 * symbol without a case-folding collision. Pair with `unpackLinks` on the reading side.
 */
export function packLinks<T extends ISymbolLink>(links: readonly T[]): readonly IPackedLink<T>[] {
  return links.map((link) => {
    if (link.symbolPath !== encodeURIComponent(link.name)) return link
    /** Link without its derivable path. */
    const { symbolPath: _derivable, ...packed } = link
    return packed
  })
}

/** Restores the `symbolPath` that `packLinks` omitted. */
export function unpackLinks<T extends ISymbolLink>(links: readonly IPackedLink<T>[]): readonly T[] {
  return links.map(
    (link) => ({ ...link, symbolPath: link.symbolPath ?? encodeURIComponent(link.name) }) as T
  )
}
