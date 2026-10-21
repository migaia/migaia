import libraryIndexManifest from '../src/generated/manifests/library-index.json'
import {
  apiDisplayKind,
  isCallableApiSymbol,
  moduleSlug,
  symbolSlug,
  type IApi,
  type IApiSymbol,
  type ILibrary
} from './content-contract.js'
import { essentialApiParts, essentialApis } from './essential-apis.js'
import { referenceFor } from './reference/index.js'

export type ILibrarySummary = Omit<ILibrary, 'documentation'>

/**
 * Type names one symbol page carries. `expanded` types are referenced directly by the selected
 * declaration and ship their full declaration; `linked` adds the types those declarations name,
 * which ship only as compact link entries whose own route loads the full declaration.
 */
type IReferencedTypes = {
  readonly expanded: ReadonlySet<string>
  readonly linked: ReadonlySet<string>
}

/** No selected symbol: no type is pulled in beyond the module's own listing. */
const noReferencedTypes: IReferencedTypes = { expanded: new Set(), linked: new Set() }

export type ILibraryRouteContent = {
  readonly library: ILibrary
  readonly apis: readonly IApi[]
}

export type IGuideApiLink = {
  readonly module: string
  readonly name: string
  readonly symbolPath: string
  /**
   * Reader-facing declaration kind (`function`, `class`, `const`, …) drawn as the sidebar marker; a
   * callable const reads as `function`.
   */
  readonly kind: string
}

type ILibraryRouteContentOptions = {
  readonly documentation: 'none' | 'readme' | 'guide' | 'all'
  /** Selects the English `*.en.md` documents; Chinese is the default maintained language. */
  readonly locale?: 'zh' | 'en'
  readonly includeApiIndex: boolean
  readonly selectedModule?: string
  readonly selectedSymbol?: string
}

/** Lightweight facts used by domain indexes without loading maintained document bodies. */
export const librarySummaries = libraryIndexManifest.libraries as readonly ILibrarySummary[]

/** Build-time bounded dynamic imports; Vite emits one independently cacheable chunk per library. */
const libraryShardLoaders = import.meta.glob<{
  readonly default: ILibraryRouteContent & { readonly version: number }
}>('../src/generated/manifests/libraries/*.json')

/** Keeps task-guide navigation on reader-facing entries; the full Docs index retains internals. */
function isGuideNavigationSymbol(api: IApi, symbol: IApiSymbol): boolean {
  if (/^(?:internals|node-internals)$/.test(api.module)) return false
  return !new Set([
    'DependencyTracker',
    'VersionClock',
    'createManualScheduler',
    'createMutationQueue',
    'invokeParallelSettled',
    'invokeTaskSettled'
  ]).has(symbol.name)
}

/** Includes callable APIs plus RPC's runtime specification constants in guide navigation. */
function isGuideApiLinkSymbol(slug: string, api: IApi, symbol: IApiSymbol): boolean {
  if (!isGuideNavigationSymbol(api, symbol)) return false
  if (isCallableApiSymbol(symbol)) return true
  return slug === 'rpc-core' && api.module === 'transport-constants' && symbol.kind === 'const'
}

/**
 * Module slug of a type-only public entry (`@migaia/<library>/typing`). Its sidebar group lists
 * every type the entry exports, so readers see the type surface apart from runtime APIs.
 */
export const TYPE_ENTRY_MODULE = 'typing'

/**
 * Lists every type exported by a library's type-only entry: types declared there, plus types it
 * re-exports, which link to their owning module's page. Empty when the library has no such entry.
 */
export async function loadTypeEntryLinks(slug: string): Promise<readonly IGuideApiLink[]> {
  /** Reuse the library shard so navigation follows the same generated export inventory. */
  const loader = libraryShardLoaders[`../src/generated/manifests/libraries/${slug}.json`]
  if (!loader) return []
  const { apis } = (await loader()).default
  /** The entry's manifest record carries both its own declarations and its re-export aliases. */
  const entry = apis.find((api) => api.module === TYPE_ENTRY_MODULE)
  if (!entry) return []
  /** Declarations keep the entry's own module and collision-safe route segments. */
  const declared = entry.symbols.map((symbol) => ({
    module: entry.module,
    name: symbol.name,
    symbolPath: symbolSlug(symbol, entry.symbols),
    kind: apiDisplayKind(symbol)
  }))
  /** Re-export aliases preserve canonical declaration ownership instead of duplicating pages. */
  const reexported = entry.aliases.flatMap((alias) => {
    /** A re-export is documented once, on the page of the module that declares it. */
    const owner = apis.find((api) => api.module === alias.ownerModule)
    /** Resolve the declaration to retain its generated kind and collision-safe route segment. */
    const symbol = owner?.symbols.find((candidate) => candidate.name === alias.name)
    return owner && symbol
      ? [
          {
            module: owner.module,
            name: symbol.name,
            symbolPath: symbolSlug(symbol, owner.symbols),
            kind: apiDisplayKind(symbol)
          }
        ]
      : []
  })
  return [...declared, ...reexported]
}

/** Projects complete lightweight API navigation without serializing documentation bodies. */
export async function loadLibraryApiLinks(slug: string): Promise<readonly IGuideApiLink[]> {
  const loader = libraryShardLoaders[`../src/generated/manifests/libraries/${slug}.json`]
  if (!loader) return []
  const module = await loader()
  return module.default.apis.flatMap((api) =>
    api.symbols
      .filter(
        (symbol) =>
          isGuideApiLinkSymbol(slug, api, symbol) ||
          // Curated essentials (for example storage hosts exported as constants) stay linkable.
          (essentialApis[slug] ?? []).some((entry) => {
            const { module, name } = essentialApiParts(entry)
            return module === api.module && name === symbol.name
          })
      )
      .map((symbol) => ({
        module: api.module,
        name: symbol.name,
        symbolPath: symbolSlug(symbol, api.symbols),
        kind: apiDisplayKind(symbol)
      }))
  )
}

/** Loads one canonical library payload without importing the all-library manifests. */
export async function loadLibraryRouteContent(
  slug: string,
  options: ILibraryRouteContentOptions
): Promise<ILibraryRouteContent | undefined> {
  const loader = libraryShardLoaders[`../src/generated/manifests/libraries/${slug}.json`]
  if (!loader) return undefined
  const module = await loader()
  const selectedApi = module.default.apis.find(
    (api) =>
      api.module === options.selectedModule || moduleSlug(api.exportPath) === options.selectedModule
  )
  /** Canonical owners needed only to resolve aliases from the selected module. */
  const aliasOwnerModules = new Set(selectedApi?.aliases.map((alias) => alias.ownerModule) ?? [])
  /** Keep same-library result and dependency types even when a sibling entry exports them. */
  const selectedSymbol = selectedApi?.symbols.find(
    (symbol) => symbolSlug(symbol, selectedApi.symbols) === options.selectedSymbol
  )
  const reference = referenceFor(slug)
  const surface = selectedSymbol
    ? (
        reference?.types[`${selectedApi!.module}:${selectedSymbol.name}`] ??
        reference?.types[selectedSymbol.name]
      )?.surface
    : undefined
  const relatedTypes = selectedSymbol
    ? collectReferencedTypeNames(
        {
          ...selectedSymbol,
          signature: [
            selectedSymbol.signature,
            selectedSymbol.returns,
            ...selectedSymbol.parameterDetails.map((parameter) => parameter.type),
            surface ?? ''
          ].join(' ')
        },
        module.default.apis.flatMap((api) => api.symbols)
      )
    : noReferencedTypes
  const library = module.default.library
  /** Locale-selected README and usage guide; English never falls back to the Chinese text. */
  const localized =
    options.locale === 'en'
      ? (library.documentation.en ?? { readme: null, guide: null })
      : library.documentation
  return {
    library: {
      ...library,
      exports: options.includeApiIndex ? library.exports : [],
      documentation: {
        readme:
          options.documentation === 'readme' || options.documentation === 'all'
            ? projectReaderDocument(localized.readme, slug)
            : null,
        guide:
          options.documentation === 'guide' || options.documentation === 'all'
            ? projectReaderDocument(localized.guide, slug)
            : null
      }
    },
    apis: options.includeApiIndex
      ? module.default.apis.map((api) =>
          api === selectedApi
            ? projectSelectedApi(api, options.selectedSymbol, relatedTypes)
            : projectApiIndexEntry(api, aliasOwnerModules.has(api.module), relatedTypes)
        )
      : []
  }
}

/** Removes repository navigation/install sections while retaining reader decision context. */
function projectReaderDocument(document: ILibrary['documentation']['readme'], library: string) {
  if (!document) return null
  return {
    sections: document.sections.filter((section) => {
      const heading = section.heading.trim()
      const resourceDecisionContext =
        library === 'resource' &&
        /^(?:\d+(?:\.\d+)?[.、]?\s*)?(?:这是什么|适合什么场景|用了之后能得到什么)$/.test(heading)
      if (resourceDecisionContext) return true
      return !/^(?:@|使用手册$|(?:\d+(?:\.\d+)?[.、]?\s*)?(?:这是什么|适合什么场景|安装|目录|构建门禁|核心概念一览|用了之后能得到什么|what (?:this is|it is for|you get)|install(?:ation)?|contents?|build gates?|core concepts?)$)/i.test(
        heading
      )
    })
  }
}

/** Removes repository-only fields while retaining selected API documentation. */
function projectSelectedApi(
  api: IApi,
  selectedSymbolPath?: string,
  relatedTypes?: IReferencedTypes
): IApi {
  const selectedSymbol = selectedSymbolPath
    ? api.symbols.find((symbol) => symbolSlug(symbol, api.symbols) === selectedSymbolPath)
    : undefined
  const { expanded, linked } =
    relatedTypes ??
    (selectedSymbol ? collectReferencedTypeNames(selectedSymbol, api.symbols) : noReferencedTypes)
  /** Authored symbol references replace extractor descriptions in every configuration row. */
  const symbolReferences = referenceFor(api.library)?.symbols
  const hasAuthoredSymbol = Boolean(
    selectedSymbol &&
    (symbolReferences?.[`${api.module}:${selectedSymbol.name}`] ??
      symbolReferences?.[selectedSymbol.name])
  )
  return {
    id: api.id,
    library: api.library,
    module: api.module,
    exportPath: api.exportPath,
    sections: api.sections,
    guidePath: api.guidePath,
    architecturePath: api.architecturePath,
    aliases: api.aliases.map((alias) => ({
      name: alias.name,
      signature: selectedSymbolPath === alias.name ? alias.signature : '',
      source: publicSourceName(alias.source),
      exportPath: alias.exportPath,
      ownerExportPath: alias.ownerExportPath,
      ownerModule: alias.ownerModule,
      ownerFragment: alias.ownerFragment
    })),
    symbols: api.symbols
      .filter(
        (symbol) =>
          !selectedSymbol ||
          symbol === selectedSymbol ||
          (symbol.kind !== 'type' && symbol.kind !== 'interface') ||
          linked.has(symbol.name)
      )
      .map((symbol) =>
        selectedSymbol
          ? symbol === selectedSymbol
            ? projectSelectedSymbol(symbol, hasAuthoredSymbol)
            : (symbol.kind === 'type' || symbol.kind === 'interface') && expanded.has(symbol.name)
              ? projectTypingSymbol(symbol)
              : symbol.kind === 'class' && expanded.has(symbol.name)
                ? // A class returned by the selected factory keeps its instance members.
                  { ...compactSymbol(symbol), members: symbol.members, composes: symbol.composes }
                : compactSymbol(symbol)
          : projectModuleIndexSymbol(symbol)
      )
  }
}

/** Keeps runtime summaries while retaining every complete type declaration. */
function projectModuleIndexSymbol(symbol: IApiSymbol): IApiSymbol {
  return symbol.kind === 'type' || symbol.kind === 'interface'
    ? compactSymbol(symbol)
    : {
        ...compactSymbol(symbol),
        signature: symbol.kind === 'const' ? symbol.signature : '',
        source: publicSourceName(symbol.source),
        purpose: symbol.purpose
      }
}

/**
 * Selects the type declarations one symbol page shows. Types named by the selected declaration (and
 * the bases they compose) are expanded; types named inside those declarations are linked. Deeper
 * types are not carried: a linked type's own route loads its declaration on demand, so a page stays
 * bounded instead of shipping the module's whole reachable type graph.
 */
function collectReferencedTypeNames(
  selected: IApiSymbol,
  symbols: readonly IApiSymbol[]
): IReferencedTypes {
  /** Classes count as typing here because a factory may return a class instance. */
  const typing = symbols.filter(
    (symbol) => symbol.kind === 'type' || symbol.kind === 'interface' || symbol.kind === 'class'
  )
  /** Whether `text` names the typing symbol as a whole word. */
  const names = (text: string, symbol: IApiSymbol) => new RegExp(`\\b${symbol.name}\\b`).test(text)
  const expanded = new Set<string>()
  /** Inherited bases may live outside the visible signature (`class X extends PrivateBase`). */
  const pending = typing.filter(
    (symbol) => names(selected.signature, symbol) || selected.composes?.includes(symbol.name)
  )
  while (pending.length > 0) {
    const symbol = pending.shift()
    if (!symbol || expanded.has(symbol.name)) continue
    expanded.add(symbol.name)
    /** A composed base contributes members to this declaration, so it expands too. */
    for (const base of typing) if (symbol.composes?.includes(base.name)) pending.push(base)
  }
  const linked = new Set(expanded)
  for (const symbol of typing)
    if (
      !linked.has(symbol.name) &&
      typing.some((owner) => expanded.has(owner.name) && names(owner.signature, symbol))
    )
      linked.add(symbol.name)
  return { expanded, linked }
}

/**
 * Keeps typing readable and recursively discoverable without full runtime prose. Members and
 * composed bases stay so a factory page can show the instance surface its result exposes.
 */
function projectTypingSymbol(symbol: IApiSymbol): IApiSymbol {
  return {
    ...compactSymbol(symbol),
    signature: symbol.signature,
    source: publicSourceName(symbol.source),
    purpose: symbol.purpose,
    members: symbol.members,
    composes: symbol.composes
  }
}

/** Keeps declaration facts used by the detail view; generated narrative sections stay build-only. */
function projectSelectedSymbol(symbol: IApiSymbol, hasAuthoredReference: boolean): IApiSymbol {
  return {
    name: symbol.name,
    kind: symbol.kind,
    callable: symbol.callable,
    routeSlug: symbol.routeSlug,
    fragment: symbol.fragment,
    signature: symbol.signature,
    source: publicSourceName(symbol.source),
    purpose: symbol.purpose,
    // Focused reference articles render maintained prose, never these generated narrative copies.
    core: '',
    advanced: '',
    parameters: symbol.parameters,
    returns: symbol.returns,
    errors: symbol.errors.filter(
      (error) => !error.startsWith('No documented errors are declared for ')
    ),
    lifecycleConcurrency: symbol.lifecycleConcurrency.startsWith(
      'No lifecycle or concurrency behavior is declared for '
    )
      ? ''
      : symbol.lifecycleConcurrency,
    parameterDetails: symbol.parameterDetails,
    members: symbol.members,
    composes: symbol.composes,
    examples: symbol.examples,
    guidance: symbol.guidance,
    configuration: hasAuthoredReference
      ? symbol.configuration.map((field) => ({
          ...field,
          // The field's type/flags remain; its maintained reference supplies the visible text.
          description: '',
          descriptionEn: undefined,
          descriptionZh: undefined
        }))
      : symbol.configuration,
    whenToUse: symbol.whenToUse,
    notUse: symbol.notUse,
    sections: [],
    exportPath: symbol.exportPath,
    usageScore: symbol.usageScore
  }
}

/** Retains navigation fields plus compact alias-owner symbols for one library. */
function projectApiIndexEntry(
  api: IApi,
  includeSymbols: boolean,
  relatedTypes: IReferencedTypes
): IApi {
  return {
    id: api.id,
    library: api.library,
    module: api.module,
    exportPath: api.exportPath,
    sections: api.sections,
    guidePath: api.guidePath,
    architecturePath: api.architecturePath,
    aliases: [],
    symbols: api.symbols
      .filter((symbol) => includeSymbols || relatedTypes.linked.has(symbol.name))
      .map((symbol) =>
        relatedTypes.expanded.has(symbol.name) ? projectTypingSymbol(symbol) : compactSymbol(symbol)
      )
  }
}

/** Converts a build-time declaration path into a website-facing filename. */
function publicSourceName(source: string): string {
  return source.split('/').at(-1) ?? source
}

/** Retains only fields needed to build another module's stable semantic symbol link. */
function compactSymbol(symbol: IApiSymbol): IApiSymbol {
  /** Minimal declaration marker retaining callable-const navigation identity. */
  const compactSignature =
    symbol.kind === 'const' && isCallableApiSymbol(symbol)
      ? `export declare const ${symbol.name}: (`
      : ''
  return {
    name: symbol.name,
    kind: symbol.kind,
    callable: symbol.callable,
    fragment: symbol.fragment,
    signature: compactSignature,
    // Navigation grouping is part of the stable reader contract. Keeping the
    // public filename prevents the selected symbol from changing rail groups.
    source: publicSourceName(symbol.source),
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
    exportPath: symbol.exportPath,
    usageScore: symbol.usageScore
  }
}
