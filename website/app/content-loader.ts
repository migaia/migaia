import libraryIndexManifest from '../src/generated/manifests/library-index.json'
import {
  isCallableApiSymbol,
  moduleSlug,
  symbolSlug,
  type IApi,
  type IApiSymbol,
  type ILibrary
} from './content-contract.js'

export type ILibrarySummary = Omit<ILibrary, 'documentation'>

export type ILibraryRouteContent = {
  readonly library: ILibrary
  readonly apis: readonly IApi[]
}

export type IGuideApiLink = {
  readonly module: string
  readonly name: string
  readonly symbolPath: string
}

type ILibraryRouteContentOptions = {
  readonly documentation: 'none' | 'readme' | 'guide' | 'all'
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

/** Projects complete lightweight API navigation without serializing documentation bodies. */
export async function loadLibraryApiLinks(slug: string): Promise<readonly IGuideApiLink[]> {
  const loader = libraryShardLoaders[`../src/generated/manifests/libraries/${slug}.json`]
  if (!loader) return []
  const module = await loader()
  return module.default.apis.flatMap((api) =>
    api.symbols
      .filter((symbol) => isCallableApiSymbol(symbol) && isGuideNavigationSymbol(api, symbol))
      .map((symbol) => ({
      module: api.module,
      name: symbol.name,
      symbolPath: symbolSlug(symbol, api.symbols)
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
  const library = module.default.library
  return {
    library: {
      ...library,
      exports: options.includeApiIndex ? library.exports : [],
      documentation: {
        readme:
          options.documentation === 'readme' || options.documentation === 'all'
            ? projectReaderDocument(library.documentation.readme, slug)
            : null,
        guide:
          options.documentation === 'guide' || options.documentation === 'all'
            ? projectReaderDocument(library.documentation.guide, slug)
            : null
      }
    },
    apis: options.includeApiIndex
      ? module.default.apis.map((api) =>
          api === selectedApi
            ? projectSelectedApi(api, options.selectedSymbol)
            : projectApiIndexEntry(api, aliasOwnerModules.has(api.module))
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
        /^(?:\d+(?:\.\d+)?[.、]?\s*)?(?:这是什么|适合什么场景|用了之后能得到什么)$/.test(
          heading
        )
      if (resourceDecisionContext) return true
      return !/^(?:@|使用手册$|(?:\d+(?:\.\d+)?[.、]?\s*)?(?:这是什么|适合什么场景|安装|目录|构建门禁|核心概念一览|用了之后能得到什么|what (?:this is|it is for|you get)|install(?:ation)?|contents?|build gates?|core concepts?)$)/i.test(
        heading
      )
    })
  }
}

/** Removes repository-only fields while retaining selected API documentation. */
function projectSelectedApi(api: IApi, selectedSymbolPath?: string): IApi {
  const selectedSymbol = selectedSymbolPath
    ? api.symbols.find((symbol) => symbolSlug(symbol, api.symbols) === selectedSymbolPath)
    : undefined
  const relatedTypeNames = selectedSymbol
    ? collectReferencedTypeNames(selectedSymbol, api.symbols)
    : new Set<string>()
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
      signature: alias.signature,
      source: publicSourceName(alias.source),
      exportPath: alias.exportPath,
      ownerExportPath: alias.ownerExportPath,
      ownerModule: alias.ownerModule,
      ownerFragment: alias.ownerFragment
    })),
    symbols: api.symbols.map((symbol) =>
      selectedSymbol
        ? symbol === selectedSymbol
          ? projectSelectedSymbol(symbol)
          : (symbol.kind === 'type' || symbol.kind === 'interface') &&
              relatedTypeNames.has(symbol.name)
            ? projectTypingSymbol(symbol)
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

/** Retains only type declarations reachable from the selected API signature. */
function collectReferencedTypeNames(
  selected: IApiSymbol,
  symbols: readonly IApiSymbol[]
): ReadonlySet<string> {
  const typing = symbols.filter((symbol) => symbol.kind === 'type' || symbol.kind === 'interface')
  const names = new Set<string>()
  const pending = typing.filter((symbol) =>
    new RegExp(`\\b${symbol.name}\\b`).test(selected.signature)
  )
  while (pending.length > 0) {
    const symbol = pending.shift()
    if (!symbol || names.has(symbol.name)) continue
    names.add(symbol.name)
    for (const dependency of typing)
      if (
        !names.has(dependency.name) &&
        new RegExp(`\\b${dependency.name}\\b`).test(symbol.signature)
      )
        pending.push(dependency)
  }
  return names
}

/** Keeps typing readable and recursively discoverable without full runtime prose. */
function projectTypingSymbol(symbol: IApiSymbol): IApiSymbol {
  return {
    ...compactSymbol(symbol),
    signature: symbol.signature,
    source: publicSourceName(symbol.source),
    purpose: symbol.purpose
  }
}

/** Omits generator absence markers instead of shipping them as reader-facing prose. */
function projectSelectedSymbol(symbol: IApiSymbol): IApiSymbol {
  const undocumentedAdvanced = symbol.advanced.startsWith(
    'No additional advanced behavior is declared for '
  )
  return {
    name: symbol.name,
    kind: symbol.kind,
    fragment: symbol.fragment,
    signature: symbol.signature,
    source: publicSourceName(symbol.source),
    purpose: symbol.purpose,
    core: symbol.core,
    advanced: undocumentedAdvanced ? '' : symbol.advanced,
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
    examples: symbol.examples,
    guidance: symbol.guidance,
    configuration: symbol.configuration,
    whenToUse: symbol.whenToUse,
    notUse: symbol.notUse,
    sections: symbol.sections.filter(
      (section) => !(section.id === 'advanced-usage' && undocumentedAdvanced)
    ),
    exportPath: symbol.exportPath,
    usageScore: symbol.usageScore
  }
}

/** Retains navigation fields plus compact alias-owner symbols for one library. */
function projectApiIndexEntry(api: IApi, includeSymbols: boolean): IApi {
  return {
    id: api.id,
    library: api.library,
    module: api.module,
    exportPath: api.exportPath,
    sections: api.sections,
    guidePath: api.guidePath,
    architecturePath: api.architecturePath,
    aliases: [],
    symbols: includeSymbols
      ? api.symbols.map(compactSymbol)
      : api.symbols
          .filter((symbol) => symbol.kind === 'type' || symbol.kind === 'interface')
          .map(compactSymbol)
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
    symbol.kind === 'const' &&
    new RegExp(
      `export declare const ${symbol.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(?:<|\\()`
    ).test(symbol.signature)
      ? `export declare const ${symbol.name}: (`
      : ''
  return {
    name: symbol.name,
    kind: symbol.kind,
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
