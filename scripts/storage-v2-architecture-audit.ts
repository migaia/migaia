import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import * as ts from 'typescript'

type IManifest = {
  readonly name: string
  readonly exports?: Readonly<Record<string, unknown>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

type IWorkspacePackage = {
  readonly directory: string
  readonly manifest: IManifest
  readonly source: ReadonlyMap<string, string>
}

type ICapability = {
  readonly name: string
  readonly owner: string
  readonly routes: readonly string[]
  readonly symbols: readonly string[]
  readonly consumers: readonly string[]
}

type IRouteSymbols = {
  readonly route: string
  readonly symbols: readonly string[]
}

type ITargetedRule = {
  readonly id: string
  readonly packages: readonly string[]
  readonly pathPattern: string
  readonly sourcePatterns: readonly string[]
}

type ICatalog = {
  readonly schemaVersion: number
  readonly packages: readonly string[]
  readonly capabilities: readonly ICapability[]
  readonly nonCapabilityEdges: readonly IRouteSymbols[]
  readonly targetedRules: readonly ITargetedRule[]
}

type IHostileCase = {
  readonly id: string
  readonly kind:
    | 'catalog-route'
    | 'catalog-symbol'
    | 'catalog-consumer'
    | 'catalog-non-capability-symbol'
    | 'remove-dependency'
    | 'append-source'
    | 'append-module-source'
  readonly capability?: string
  readonly package?: string
  readonly path?: string
  readonly value: string
  readonly expectedCode: string
}

type IHostileFixture = {
  readonly schemaVersion: number
  readonly cases: readonly IHostileCase[]
}

type IImportEdge = {
  readonly consumer: string
  readonly file: string
  readonly route: string
  readonly symbol?: string
  readonly kind: 'import' | 'import-equals' | 'dynamic-import' | 're-export' | 'import-type'
}

type IAuditFacts = {
  readonly imports: readonly IImportEdge[]
  readonly exportedSymbols: ReadonlyMap<string, ReadonlySet<string>>
  readonly sources: ReadonlyMap<string, ReadonlyMap<string, string>>
}

/** Stable error carrying the machine-checkable fail-closed reason. */
class AuditFailure extends Error {
  /** Stable reason consumed by the permanent hostile-fixture matrix. */
  readonly code: string

  /** Creates one audit failure without conflating its code and diagnostic detail. */
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'AuditFailure'
    this.code = code
  }
}

/** Repository root that owns the independent architecture command. */
const repositoryRoot = resolve(import.meta.dirname, '..')

/** Reviewed finite capability catalog required by SWV2-D42/T44. */
const catalogPath = resolve(
  repositoryRoot,
  'packages/storage-web/test/fixtures/storage-v2-bounded-capability-catalog.json'
)

/** Permanent finite hostile mutations for the declared T44 failure surface. */
const hostilePath = resolve(
  repositoryRoot,
  'packages/storage-web/test/fixtures/storage-v2-bounded-t44-hostile.json'
)

/** Exact hostile IDs, mutation kinds, and failure codes required by C2-R2 acceptance. */
const requiredHostileCaseContract = [
  ['unknown-route', 'catalog-route', 'UNKNOWN_CATALOG_ROUTE'],
  ['unknown-symbol', 'catalog-symbol', 'UNKNOWN_CATALOG_SYMBOL'],
  ['false-consumer', 'catalog-consumer', 'CAPABILITY_CONSUMER_MISMATCH'],
  ['unused-non-capability-symbol', 'catalog-non-capability-symbol', 'NON_CAPABILITY_EDGE_MISMATCH'],
  ['missing-manifest-dependency', 'remove-dependency', 'MISSING_MANIFEST_DEPENDENCY'],
  ['side-effect-import-dependency', 'append-module-source', 'MISSING_MANIFEST_DEPENDENCY'],
  ['dynamic-import-unknown-route', 'append-module-source', 'UNKNOWN_WORKSPACE_ROUTE'],
  ['named-import-unknown-symbol', 'append-module-source', 'UNKNOWN_WORKSPACE_SYMBOL'],
  ['namespace-import-dependency', 'append-module-source', 'MISSING_MANIFEST_DEPENDENCY'],
  ['import-equals-dependency', 'append-module-source', 'MISSING_MANIFEST_DEPENDENCY'],
  ['export-all-dependency', 'append-module-source', 'MISSING_MANIFEST_DEPENDENCY'],
  ['namespace-reexport-dependency', 'append-module-source', 'MISSING_MANIFEST_DEPENDENCY'],
  ['named-reexport-unknown-symbol', 'append-module-source', 'UNKNOWN_WORKSPACE_SYMBOL'],
  ['import-type-unknown-route', 'append-module-source', 'UNKNOWN_WORKSPACE_ROUTE'],
  ['red02-parallel-fanout', 'append-source', 'SWV2-RED02'],
  ['red02-non-memory-backend', 'append-source', 'SWV2-RED02'],
  ['red03-parallel-scheduler', 'append-source', 'SWV2-RED03'],
  ['red07-parallel-timeout', 'append-source', 'SWV2-RED07'],
  ['red10-instanceof-byte-boundary', 'append-source', 'SWV2-RED10']
] as const satisfies readonly (readonly [string, IHostileCase['kind'], string])[]

/** Exact finite rule ownership, path scopes, and source patterns authorized by SWV2-D42. */
const requiredTargetedRuleContract = [
  {
    id: 'SWV2-RED02',
    packages: ['@migaia/storage-web'],
    pathPattern: '^src/backends/(?!index\\.ts$)[^/]+\\.ts$',
    sourcePatterns: [
      'storageListeners\\s*=\\s*new\\s+Set',
      'class\\s+StorageChange(?:Queue|Dispatcher)'
    ]
  },
  {
    id: 'SWV2-RED03',
    packages: ['@migaia/storage-web'],
    pathPattern: '^src/',
    sourcePatterns: ['class\\s+StorageReactiveScheduler', 'createStorageReactiveScheduler\\s*[=(]']
  },
  {
    id: 'SWV2-RED07',
    packages: ['@migaia/storage-web'],
    pathPattern: '^src/core/operation\\.ts$',
    sourcePatterns: [
      'storageTimeoutController\\s*=\\s*new\\s+AbortController',
      'storageTimeoutHandle\\s*=\\s*setTimeout'
    ]
  },
  {
    id: 'SWV2-RED10',
    packages: [
      '@migaia/serialize',
      '@migaia/storage-contract',
      '@migaia/storage-web',
      '@migaia/store-persist',
      '@migaia/store-worker',
      '@migaia/web-rpc'
    ],
    pathPattern: '^src/',
    sourcePatterns: ['instanceof\\s+(?:Uint8Array|ArrayBuffer)\\b']
  }
] as const satisfies readonly ITargetedRule[]

/** Reads one JSON artifact with its expected static shape. */
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

/** Converts a scoped route to its owning workspace package name. */
const packageNameFromRoute = (route: string): string | undefined => {
  if (!route.startsWith('@')) return undefined
  /** Scoped package segments excluding any public subpath. */
  const parts = route.split('/')
  return parts.length < 2 ? undefined : `${parts[0]}/${parts[1]}`
}

/** Produces stable slash-separated paths for compiler maps and rule matching on every host. */
const portableRelative = (from: string, to: string): string =>
  relative(from, to).split(sep).join('/')

/** Recursively reads executable/type source while excluding generated output and tests. */
const readSource = (directory: string): ReadonlyMap<string, string> => {
  /** Absolute source path to immutable source text. */
  const source = new Map<string, string>()
  if (!existsSync(directory)) return source
  /** Visits the package-owned source tree in deterministic lexical order. */
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      /** Absolute child path currently under review. */
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name))
        source.set(path, readFileSync(path, 'utf8'))
    }
  }
  visit(directory)
  return source
}

/** Derives every workspace package from repository layout, never from the reviewed catalog. */
const readWorkspace = (): ReadonlyMap<string, IWorkspacePackage> => {
  /** Independently generated workspace inventory keyed by manifest name. */
  const workspace = new Map<string, IWorkspacePackage>()
  for (const parentName of ['packages', 'apps']) {
    /** Conventional workspace parent currently being enumerated. */
    const parent = resolve(repositoryRoot, parentName)
    if (!existsSync(parent)) continue
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      /** Candidate package directory under the workspace parent. */
      const directory = resolve(parent, entry.name)
      /** Manifest used as the package ownership boundary. */
      const manifestPath = resolve(directory, 'package.json')
      if (!existsSync(manifestPath)) continue
      /** Parsed package manifest under independent inventory. */
      const manifest = readJson<IManifest>(manifestPath)
      workspace.set(manifest.name, {
        directory,
        manifest,
        source: new Map([
          ...readSource(resolve(directory, 'src')),
          ...readSource(resolve(directory, 'e2e'))
        ])
      })
    }
  }
  /** Website workspace, which does not live under packages/apps. */
  const websiteDirectory = resolve(repositoryRoot, 'website')
  /** Website manifest path used only when the workspace exists. */
  const websiteManifestPath = resolve(websiteDirectory, 'package.json')
  if (existsSync(websiteManifestPath)) {
    /** Parsed website package boundary. */
    const manifest = readJson<IManifest>(websiteManifestPath)
    workspace.set(manifest.name, {
      directory: websiteDirectory,
      manifest,
      source: new Map([
        ...readSource(resolve(websiteDirectory, 'src')),
        ...readSource(resolve(websiteDirectory, 'e2e'))
      ])
    })
  }
  return workspace
}

/** Selects one runtime/type target from an exports condition object. */
const exportTarget = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  /** Manifest condition map ordered by source-relevant preference. */
  const conditions = value as Readonly<Record<string, unknown>>
  return (
    exportTarget(conditions.types) ??
    exportTarget(conditions.import) ??
    exportTarget(conditions.default)
  )
}

/** Maps a manifest dist target to the checked-in TypeScript source target. */
const sourceTarget = (workspacePackage: IWorkspacePackage, target: string): string => {
  /** Source-relative equivalent of the published target. */
  const sourceRelative = target
    .replace(/^\.\/dist\//, './src/')
    .replace(/\.d\.(?:mts|cts|ts)$/, '.ts')
    .replace(/\.(?:mjs|cjs|js)$/, '.ts')
  return resolve(workspacePackage.directory, sourceRelative)
}

/** Builds TypeScript paths directly from every workspace exports map. */
const compilerPaths = (
  workspace: ReadonlyMap<string, IWorkspacePackage>
): Readonly<Record<string, string[]>> => {
  /** Compiler route map preserving manifest wildcard routes. */
  const paths: Record<string, string[]> = {}
  for (const [name, workspacePackage] of workspace) {
    /** Explicit public exports; applications without an exports map add no package route. */
    const exports = workspacePackage.manifest.exports ?? {}
    for (const [key, value] of Object.entries(exports)) {
      /** Selected manifest target for this route. */
      const target = exportTarget(value)
      if (target === undefined) continue
      /** Public package route accepted by TypeScript module resolution. */
      const route = key === '.' ? name : `${name}/${key.slice(2)}`
      /** Root-relative TypeScript source path used by the compiler resolver. */
      const relativeTarget = portableRelative(
        repositoryRoot,
        sourceTarget(workspacePackage, target)
      )
      paths[route] = [relativeTarget]
      if (route.includes('*') && relativeTarget.includes('*')) {
        /** Regex that captures the concrete source segment represented by one export wildcard. */
        const targetPattern = new RegExp(
          `^${relativeTarget
            .split('*')
            .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('(.+)')}$`
        )
        for (const file of workspacePackage.source.keys()) {
          /** Repository-relative source candidate for wildcard expansion. */
          const sourcePath = portableRelative(repositoryRoot, file)
          /** Concrete wildcard segment captured from the manifest target. */
          const match = targetPattern.exec(sourcePath)
          if (match?.[1] === undefined) continue
          paths[route.replace('*', match[1])] = [sourcePath]
        }
      }
    }
  }
  return paths
}

/** Returns static workspace route/symbol edges from one source file. */
const sourceEdges = (consumer: string, file: string, source: string): readonly IImportEdge[] => {
  /** Parsed TypeScript syntax used only for module edges, never local value flow. */
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  /** Static package route/symbol edges found in this source. */
  const edges: IImportEdge[] = []
  /** Adds one edge only for a workspace-style scoped package route. */
  const add = (route: string, symbol: string | undefined, kind: IImportEdge['kind']): void => {
    if (packageNameFromRoute(route) !== undefined)
      edges.push({ consumer, file, route, ...(symbol === undefined ? {} : { symbol }), kind })
  }
  /** Visits only syntax needed to find static import, re-export and import-type edges. */
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      /** Imported workspace route. */
      const route = node.moduleSpecifier.text
      /** Import clause whose bindings become exact route+symbol edges. */
      const clause = node.importClause
      /** Edge count used to preserve side-effect and empty-binding module dependencies. */
      const priorEdgeCount = edges.length
      if (clause?.name !== undefined) add(route, 'default', 'import')
      if (clause?.namedBindings !== undefined) {
        if (ts.isNamespaceImport(clause.namedBindings)) add(route, '*', 'import')
        else
          for (const element of clause.namedBindings.elements)
            add(route, (element.propertyName ?? element.name).text, 'import')
      }
      if (edges.length === priorEdgeCount) add(route, undefined, 'import')
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      /** TypeScript import-equals is a static namespace dependency. */
      add(node.moduleReference.expression.text, undefined, 'import-equals')
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      /** Re-exported workspace route. */
      const route = (node.moduleSpecifier as ts.StringLiteralLike).text
      if (node.exportClause === undefined) add(route, '*', 're-export')
      else if (ts.isNamedExports(node.exportClause))
        if (node.exportClause.elements.length === 0) add(route, undefined, 're-export')
        else
          for (const element of node.exportClause.elements)
            add(route, (element.propertyName ?? element.name).text, 're-export')
      else if (ts.isNamespaceExport(node.exportClause)) add(route, '*', 're-export')
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      /** Literal dynamic import is a static module dependency without a selected symbol. */
      add(node.arguments[0]!.text, undefined, 'dynamic-import')
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      /** Import-type route resolved by TypeScript. */
      const route = node.argument.literal.text
      /** First qualifier segment names the imported export; absent qualifiers are namespaces. */
      const symbol = node.qualifier?.getText(sourceFile).split('.')[0] ?? '*'
      add(route, symbol, 'import-type')
    }
    node.forEachChild(visit)
  }
  sourceFile.forEachChild(visit)
  return edges
}

/** Creates immutable compiler-backed module facts once for cold and warm validation. */
const buildFacts = (workspace: ReadonlyMap<string, IWorkspacePackage>): IAuditFacts => {
  /** All workspace source roots included in the compiler Program. */
  const rootNames = [...workspace.values()].flatMap((entry) => [...entry.source.keys()])
  /** Manifest-derived paths make TypeScript resolve source exports, not stale dist output. */
  const paths = compilerPaths(workspace)
  /** Compiler options matching the repository's bundler-mode ESM contract. */
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: repositoryRoot,
    paths,
    skipLibCheck: true
  }
  /** Immutable TypeScript Program used for route and exported-symbol resolution. */
  const program = ts.createProgram({ rootNames, options })
  /** TypeChecker used to resolve each manifest route's actual public symbols. */
  const checker = program.getTypeChecker()
  /** Independently derived route to public symbol set. */
  const exportedSymbols = new Map<string, ReadonlySet<string>>()
  for (const route of Object.keys(paths)) {
    if (route.includes('*')) continue
    /** Synthetic containing file used for a resolver-only public-route check. */
    const containingFile = resolve(repositoryRoot, 'scripts/storage-v2-architecture-audit.ts')
    /** TypeScript's resolved source for the public route. */
    const resolved = ts.resolveModuleName(route, containingFile, options, ts.sys).resolvedModule
    if (resolved === undefined) throw new AuditFailure('UNKNOWN_WORKSPACE_ROUTE', route)
    /** Program source file that owns the resolved public route. */
    const sourceFile = program.getSourceFile(resolved.resolvedFileName)
    if (sourceFile === undefined)
      throw new AuditFailure('UNRESOLVED_EXPORT_SOURCE', `${route} -> ${resolved.resolvedFileName}`)
    /** Compiler module symbol containing direct and re-exported public symbols. */
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (moduleSymbol === undefined) throw new AuditFailure('UNRESOLVED_EXPORT_SYMBOL_TABLE', route)
    exportedSymbols.set(
      route,
      new Set(checker.getExportsOfModule(moduleSymbol).map((item) => item.name))
    )
  }
  /** Static route+symbol edges generated from every workspace source. */
  const imports = [...workspace].flatMap(([consumer, entry]) =>
    [...entry.source].flatMap(([file, source]) => sourceEdges(consumer, file, source))
  )
  /** Relative sources grouped by package for targeted finite rules. */
  const sources = new Map(
    [...workspace].map(([name, entry]) => [
      name,
      new Map(
        [...entry.source].map(([file, source]) => [portableRelative(entry.directory, file), source])
      )
    ])
  )
  return { imports, exportedSymbols, sources }
}

/** Returns the reviewed capability matched by one exact route+symbol edge. */
const capabilityForEdge = (edge: IImportEdge, catalog: ICatalog): ICapability | undefined =>
  edge.symbol === undefined
    ? undefined
    : catalog.capabilities.find(
        (capability) =>
          capability.routes.includes(edge.route) &&
          (capability.symbols.includes('*') || capability.symbols.includes(edge.symbol!))
      )

/** Normalizes route/symbol rows while preserving duplicates for explicit rejection. */
const normalizeRouteSymbols = (entries: readonly IRouteSymbols[]): readonly IRouteSymbols[] =>
  entries
    .map((entry) => ({ route: entry.route, symbols: [...entry.symbols].sort() }))
    .sort((left, right) => left.route.localeCompare(right.route))

/** Derives every actually used non-capability symbol imported from a capability owner. */
const deriveUsedNonCapabilityEdges = (
  facts: IAuditFacts,
  catalog: ICatalog,
  workspace: ReadonlyMap<string, IWorkspacePackage>
): readonly IRouteSymbols[] => {
  /** Used non-capability symbols grouped by their exact public route. */
  const symbolsByRoute = new Map<string, Set<string>>()
  for (const edge of facts.imports) {
    /** Owning package for this literal workspace route. */
    const owner = packageNameFromRoute(edge.route)
    if (
      owner === undefined ||
      owner === edge.consumer ||
      edge.symbol === undefined ||
      !workspace.has(owner) ||
      !catalog.capabilities.some((capability) => capability.owner === owner) ||
      capabilityForEdge(edge, catalog) !== undefined
    )
      continue
    /** Deduplicated used symbols for this route. */
    const symbols = symbolsByRoute.get(edge.route) ?? new Set<string>()
    symbols.add(edge.symbol)
    symbolsByRoute.set(edge.route, symbols)
  }
  return normalizeRouteSymbols(
    [...symbolsByRoute].map(([route, symbols]) => ({ route, symbols: [...symbols] }))
  )
}

/** Runs the finite D42 module/catalog/rule gate against immutable facts. */
const audit = (
  workspace: ReadonlyMap<string, IWorkspacePackage>,
  facts: IAuditFacts,
  catalog: ICatalog,
  sourceOverrides: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map()
): void => {
  if (catalog.schemaVersion !== 1)
    throw new AuditFailure('CATALOG_SCHEMA', `${catalog.schemaVersion}`)
  /** Independently observed workspace names. */
  const actualPackages = [...workspace.keys()].sort()
  /** Reviewed workspace names, which must be bidirectionally exact. */
  const reviewedPackages = [...catalog.packages].sort()
  if (JSON.stringify(actualPackages) !== JSON.stringify(reviewedPackages))
    throw new AuditFailure(
      'PACKAGE_CATALOG_MISMATCH',
      JSON.stringify({ actualPackages, reviewedPackages })
    )

  /** Unique capability names prevent a second reviewed owner from shadowing the first. */
  const capabilityNames = catalog.capabilities.map((capability) => capability.name)
  if (new Set(capabilityNames).size !== capabilityNames.length)
    throw new AuditFailure('DUPLICATE_CAPABILITY', JSON.stringify(capabilityNames))
  assertTargetedRuleContract(catalog)
  /** Route+symbol ownership claims used to reject duplicate or conflicting catalog edges. */
  const capabilityClaims = new Set<string>()
  for (const capability of catalog.capabilities) {
    if (!workspace.has(capability.owner))
      throw new AuditFailure('UNKNOWN_CAPABILITY_OWNER', `${capability.name}:${capability.owner}`)
    for (const route of capability.routes) {
      if (packageNameFromRoute(route) !== capability.owner)
        throw new AuditFailure('CAPABILITY_ROUTE_OWNER_MISMATCH', `${capability.name}:${route}`)
      /** Compiler-resolved public symbols for this reviewed capability route. */
      const symbols = facts.exportedSymbols.get(route)
      if (symbols === undefined)
        throw new AuditFailure('UNKNOWN_CATALOG_ROUTE', `${capability.name}:${route}`)
      for (const symbol of capability.symbols) {
        if (symbol !== '*' && !symbols.has(symbol))
          throw new AuditFailure('UNKNOWN_CATALOG_SYMBOL', `${capability.name}:${route}:${symbol}`)
        /** Exact reviewed ownership key for one capability-bearing public symbol. */
        const claim = `${route}\0${symbol}`
        /** Wildcard claims conflict with every specific claim on the same route. */
        const overlaps =
          capabilityClaims.has(claim) ||
          capabilityClaims.has(`${route}\0*`) ||
          (symbol === '*' && [...capabilityClaims].some((entry) => entry.startsWith(`${route}\0`)))
        if (overlaps)
          throw new AuditFailure('DUPLICATE_CATALOG_CLAIM', `${capability.name}:${route}:${symbol}`)
        capabilityClaims.add(claim)
      }
    }
  }

  /** Exact non-capability rows must resolve even when no current source imports them. */
  const reviewedNonCapabilityClaims = catalog.nonCapabilityEdges.flatMap((entry) =>
    entry.symbols.map((symbol) => `${entry.route}\0${symbol}`)
  )
  if (new Set(reviewedNonCapabilityClaims).size !== reviewedNonCapabilityClaims.length)
    throw new AuditFailure(
      'DUPLICATE_NON_CAPABILITY_EDGE',
      JSON.stringify(reviewedNonCapabilityClaims)
    )
  for (const entry of catalog.nonCapabilityEdges) {
    /** Compiler-resolved public symbols for one reviewed non-capability route. */
    const symbols = facts.exportedSymbols.get(entry.route)
    if (symbols === undefined) throw new AuditFailure('UNKNOWN_CATALOG_ROUTE', entry.route)
    for (const symbol of entry.symbols) {
      if (symbol !== '*' && !symbols.has(symbol))
        throw new AuditFailure('UNKNOWN_CATALOG_SYMBOL', `${entry.route}:${symbol}`)
      if (
        capabilityClaims.has(`${entry.route}\0${symbol}`) ||
        capabilityClaims.has(`${entry.route}\0*`)
      )
        throw new AuditFailure('CONFLICTING_CATALOG_CLAIM', `${entry.route}:${symbol}`)
    }
  }
  for (const edge of facts.imports) {
    /** Owning package parsed from the static workspace route. */
    const owner = packageNameFromRoute(edge.route)
    if (owner === undefined || !workspace.has(owner) || owner === edge.consumer) continue
    /** Public symbols compiler-resolved for this exact route. */
    const symbols = facts.exportedSymbols.get(edge.route)
    if (symbols === undefined)
      throw new AuditFailure('UNKNOWN_WORKSPACE_ROUTE', `${edge.consumer}:${edge.route}`)
    if (edge.symbol !== undefined && edge.symbol !== '*' && !symbols.has(edge.symbol))
      throw new AuditFailure(
        'UNKNOWN_WORKSPACE_SYMBOL',
        `${edge.consumer}:${edge.route}:${edge.symbol}`
      )
    /** Consumer manifest needed for direct dependency validation. */
    const manifest = workspace.get(edge.consumer)?.manifest
    /** All declared direct dependency forms accepted by this architecture gate. */
    const dependencies = { ...manifest?.dependencies, ...manifest?.devDependencies }
    if (!(owner in dependencies))
      throw new AuditFailure(
        'MISSING_MANIFEST_DEPENDENCY',
        `${edge.consumer}:${owner}:${edge.route}`
      )
    /** Whether the provider owns at least one reviewed capability family. */
    const capabilityOwner = catalog.capabilities.some((capability) => capability.owner === owner)
    if (!capabilityOwner || edge.symbol === undefined) continue
    /** Narrowed exact symbol selected by this binding-bearing edge. */
    const importedSymbol = edge.symbol
    /** Exact reviewed capability classification, if this route+symbol is capability-bearing. */
    const capability = capabilityForEdge(edge, catalog)
    /** Exact reviewed non-capability classification for capability-owner routes. */
    const nonCapability = catalog.nonCapabilityEdges.some(
      (entry) =>
        entry.route === edge.route &&
        (entry.symbols.includes('*') || entry.symbols.includes(importedSymbol))
    )
    if (capability === undefined && !nonCapability)
      throw new AuditFailure(
        'UNCLASSIFIED_ROUTE_SYMBOL',
        `${edge.consumer}:${edge.route}:${edge.symbol}`
      )
  }

  /** Independently derived used rows; valid but unused reviewed exports are forbidden. */
  const usedNonCapabilityEdges = deriveUsedNonCapabilityEdges(facts, catalog, workspace)
  /** Normalized reviewed rows used for exact bidirectional comparison. */
  const reviewedNonCapabilityEdges = normalizeRouteSymbols(catalog.nonCapabilityEdges)
  if (JSON.stringify(usedNonCapabilityEdges) !== JSON.stringify(reviewedNonCapabilityEdges))
    throw new AuditFailure(
      'NON_CAPABILITY_EDGE_MISMATCH',
      JSON.stringify({ usedNonCapabilityEdges, reviewedNonCapabilityEdges })
    )

  for (const capability of catalog.capabilities) {
    /** Consumers independently derived from exact compiler-resolved static edges. */
    const actualConsumers = [
      ...new Set(
        facts.imports
          .filter((edge) => capabilityForEdge(edge, catalog)?.name === capability.name)
          .map((edge) => edge.consumer)
          .filter((consumer) => consumer !== capability.owner)
      )
    ].sort()
    /** Reviewed consumer allowlist, required to be bidirectionally exact. */
    const reviewedConsumers = [...capability.consumers].sort()
    if (JSON.stringify(actualConsumers) !== JSON.stringify(reviewedConsumers))
      throw new AuditFailure(
        'CAPABILITY_CONSUMER_MISMATCH',
        `${capability.name}:${JSON.stringify({ actualConsumers, reviewedConsumers })}`
      )
  }

  /** RED02 rule whose path scope must cover every concrete backend source except the barrel. */
  const red02Rule = catalog.targetedRules.find((rule) => rule.id === 'SWV2-RED02')!
  /** Current finite backend source inventory derived independently from storage-web. */
  const backendPaths = [...(facts.sources.get('@migaia/storage-web')?.keys() ?? [])]
    .filter((path) => /^src\/backends\/[^/]+\.ts$/.test(path) && path !== 'src/backends/index.ts')
    .sort()
  /** Backend files selected by the reviewed RED02 path expression. */
  const reviewedBackendPaths = backendPaths.filter((path) =>
    new RegExp(red02Rule.pathPattern).test(path)
  )
  if (JSON.stringify(reviewedBackendPaths) !== JSON.stringify(backendPaths))
    throw new AuditFailure(
      'RED02_BACKEND_SCOPE_MISMATCH',
      JSON.stringify({ backendPaths, reviewedBackendPaths })
    )

  for (const rule of catalog.targetedRules) {
    /** File matcher bounding this rule to its named ownership surface. */
    const pathPattern = new RegExp(rule.pathPattern)
    /** Source matchers explicitly declared for the named RED rule. */
    const sourcePatterns = rule.sourcePatterns.map((pattern) => new RegExp(pattern))
    for (const packageName of rule.packages) {
      /** Baseline sources plus any one hostile mutation for this package. */
      const sources = new Map(facts.sources.get(packageName) ?? [])
      for (const [path, source] of sourceOverrides.get(packageName) ?? []) sources.set(path, source)
      for (const [path, source] of sources) {
        if (!pathPattern.test(path)) continue
        for (const pattern of sourcePatterns)
          if (pattern.test(source))
            throw new AuditFailure(rule.id, `${packageName}:${path}:${pattern.source}`)
      }
    }
  }
}

/** Clones the finite catalog for one hostile mutation without contaminating later cases. */
const cloneCatalog = (catalog: ICatalog): ICatalog =>
  JSON.parse(JSON.stringify(catalog)) as ICatalog

/** Normalizes order-insensitive rule sets while retaining every exact owned field. */
const normalizeTargetedRuleContract = (rules: readonly ITargetedRule[]): readonly ITargetedRule[] =>
  rules
    .map((rule) => ({
      id: rule.id,
      packages: [...rule.packages].sort(),
      pathPattern: rule.pathPattern,
      sourcePatterns: [...rule.sourcePatterns].sort()
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

/** Rejects any catalog whose finite targeted-rule ownership or detector payload drifts. */
const assertTargetedRuleContract = (catalog: ICatalog): void => {
  /** Actual catalog contract normalized independently from fixture order. */
  const actual = normalizeTargetedRuleContract(catalog.targetedRules)
  /** Required immutable contract normalized independently from source declaration order. */
  const required = normalizeTargetedRuleContract(requiredTargetedRuleContract)
  if (JSON.stringify(actual) !== JSON.stringify(required))
    throw new AuditFailure('TARGETED_RULE_CONTRACT_MISMATCH', JSON.stringify({ actual, required }))
}

/** Proves deletion of every declared source detector is rejected before baseline scanning. */
const assertTargetedRuleRemovalSelfTests = (catalog: ICatalog): void => {
  for (const requiredRule of requiredTargetedRuleContract) {
    for (const requiredPattern of requiredRule.sourcePatterns) {
      /** Catalog mutation omitting exactly one required finite source detector. */
      const missingPattern: ICatalog = {
        ...catalog,
        targetedRules: catalog.targetedRules.map((rule) =>
          rule.id === requiredRule.id
            ? {
                ...rule,
                sourcePatterns: rule.sourcePatterns.filter((pattern) => pattern !== requiredPattern)
              }
            : rule
        )
      }
      try {
        assertTargetedRuleContract(missingPattern)
      } catch (error) {
        if (error instanceof AuditFailure && error.code === 'TARGETED_RULE_CONTRACT_MISMATCH')
          continue
        throw error
      }
      throw new AuditFailure(
        'TARGETED_RULE_REMOVAL_SELF_TEST_FAILED',
        `${requiredRule.id}:${requiredPattern}`
      )
    }
  }
}

/** Rejects any hostile fixture whose required IDs, kinds, or expected codes drift. */
const assertHostileCaseContract = (fixture: IHostileFixture): void => {
  if (fixture.schemaVersion !== 1)
    throw new AuditFailure('HOSTILE_SCHEMA', `${fixture.schemaVersion}`)
  /** Actual contract projection sorted independently from fixture row order. */
  const actual = fixture.cases
    .map((hostile) => [hostile.id, hostile.kind, hostile.expectedCode] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  /** Required contract projection sorted independently from source declaration order. */
  const required = [...requiredHostileCaseContract].sort(([left], [right]) =>
    left.localeCompare(right)
  )
  if (JSON.stringify(actual) !== JSON.stringify(required))
    throw new AuditFailure('HOSTILE_CONTRACT_MISMATCH', JSON.stringify({ actual, required }))
}

/** Proves removal of every required hostile row is rejected by the independent contract. */
const assertHostileRemovalSelfTests = (fixture: IHostileFixture): void => {
  for (const [requiredId] of requiredHostileCaseContract) {
    /** Fixture mutation omitting exactly one required hostile row. */
    const missing: IHostileFixture = {
      ...fixture,
      cases: fixture.cases.filter((hostile) => hostile.id !== requiredId)
    }
    try {
      assertHostileCaseContract(missing)
    } catch (error) {
      if (error instanceof AuditFailure && error.code === 'HOSTILE_CONTRACT_MISMATCH') continue
      throw error
    }
    throw new AuditFailure('HOSTILE_REMOVAL_SELF_TEST_FAILED', requiredId)
  }
}

/** Applies one declared hostile mutation and requires its exact fail-closed code. */
const runHostileCase = (
  hostile: IHostileCase,
  workspace: ReadonlyMap<string, IWorkspacePackage>,
  facts: IAuditFacts,
  catalog: ICatalog
): void => {
  /** Isolated mutable catalog copy used only by catalog mutation cases. */
  const candidate = cloneCatalog(catalog)
  /** Optional source override used only by named-rule mutation cases. */
  const sourceOverrides = new Map<string, ReadonlyMap<string, string>>()
  if (hostile.kind === 'catalog-non-capability-symbol') {
    /** Reviewed route selected for the valid-but-unused non-capability mutation. */
    const route = hostile.path
    /** Mutable reviewed row confined to this cloned fixture. */
    const entry = candidate.nonCapabilityEdges.find(
      (candidateEntry) => candidateEntry.route === route
    )
    if (entry === undefined) throw new AuditFailure('HOSTILE_FIXTURE_INVALID', hostile.id)
    ;(entry.symbols as string[]).push(hostile.value)
  } else if (hostile.kind.startsWith('catalog-')) {
    /** Capability selected by the permanent hostile fixture. */
    const capability = candidate.capabilities.find((entry) => entry.name === hostile.capability)
    if (capability === undefined) throw new AuditFailure('HOSTILE_FIXTURE_INVALID', hostile.id)
    /** Mutable capability projection confined to this cloned fixture. */
    const mutable = capability as unknown as {
      routes: string[]
      symbols: string[]
      consumers: string[]
    }
    if (hostile.kind === 'catalog-route') mutable.routes.push(hostile.value)
    else if (hostile.kind === 'catalog-symbol') mutable.symbols.push(hostile.value)
    else mutable.consumers.push(hostile.value)
  } else if (hostile.kind === 'remove-dependency') {
    /** Package whose manifest dependency is removed in the isolated state. */
    const packageName = hostile.package
    if (packageName === undefined) throw new AuditFailure('HOSTILE_FIXTURE_INVALID', hostile.id)
    /** Baseline workspace package selected by the fixture. */
    const workspacePackage = workspace.get(packageName)
    if (workspacePackage === undefined)
      throw new AuditFailure('HOSTILE_FIXTURE_INVALID', hostile.id)
    /** Dependency map with exactly the hostile dependency omitted. */
    const dependencies = Object.fromEntries(
      Object.entries(workspacePackage.manifest.dependencies ?? {}).filter(
        ([name]) => name !== hostile.value
      )
    )
    /** Isolated workspace clone used for dependency validation. */
    workspace = new Map(workspace).set(packageName, {
      ...workspacePackage,
      manifest: { ...workspacePackage.manifest, dependencies }
    })
  } else if (hostile.kind === 'append-module-source') {
    /** Package receiving one source-level module syntax mutation. */
    const packageName = hostile.package
    /** Package-relative path for the isolated module mutation. */
    const path = hostile.path
    if (packageName === undefined || path === undefined)
      throw new AuditFailure('HOSTILE_FIXTURE_INVALID', hostile.id)
    /** Baseline workspace package cloned with one added or extended source. */
    const workspacePackage = workspace.get(packageName)
    if (workspacePackage === undefined)
      throw new AuditFailure('HOSTILE_FIXTURE_INVALID', hostile.id)
    /** Absolute source path visible to the static module-edge extractor. */
    const absolutePath = resolve(workspacePackage.directory, path)
    /** Existing source text, or an empty module for a new hostile file. */
    const source = workspacePackage.source.get(absolutePath) ?? ''
    workspace = new Map(workspace).set(packageName, {
      ...workspacePackage,
      source: new Map(workspacePackage.source).set(absolutePath, `${source}${hostile.value}`)
    })
    facts = buildFacts(workspace)
  } else {
    /** Source mutation coordinates required by append-source cases. */
    const packageName = hostile.package
    /** Package-relative source path required by append-source cases. */
    const path = hostile.path
    if (packageName === undefined || path === undefined)
      throw new AuditFailure('HOSTILE_FIXTURE_INVALID', hostile.id)
    /** Baseline source text extended by the named sensitive pattern. */
    const source = facts.sources.get(packageName)?.get(path)
    if (source === undefined) throw new AuditFailure('HOSTILE_FIXTURE_INVALID', hostile.id)
    sourceOverrides.set(packageName, new Map([[path, `${source}${hostile.value}`]]))
  }
  try {
    audit(workspace, facts, candidate, sourceOverrides)
  } catch (error) {
    if (error instanceof AuditFailure && error.code === hostile.expectedCode) return
    throw error
  }
  throw new AuditFailure('HOSTILE_CASE_DID_NOT_FAIL', hostile.id)
}

/** Runs cold facts, permanent hostile cases and warm immutable-fact replay under D45 budgets. */
const main = (): void => {
  /** Reviewed catalog loaded once for immutable baseline comparison. */
  const catalog = readJson<ICatalog>(catalogPath)
  /** Permanent hostile fixture loaded independently from implementation logic. */
  const hostileFixture = readJson<IHostileFixture>(hostilePath)
  assertTargetedRuleContract(catalog)
  assertTargetedRuleRemovalSelfTests(catalog)
  assertHostileCaseContract(hostileFixture)
  assertHostileRemovalSelfTests(hostileFixture)
  /** Cold run start including workspace/source/compiler fact construction. */
  const coldStart = performance.now()
  /** Independently generated workspace state. */
  const workspace = readWorkspace()
  /** Immutable compiler-backed facts shared only after their cold construction. */
  const facts = buildFacts(workspace)
  audit(workspace, facts, catalog)
  /** Cold elapsed milliseconds checked against the 60-second D45 budget. */
  const coldMs = performance.now() - coldStart
  if (coldMs > 60_000) throw new AuditFailure('COLD_BUDGET_EXCEEDED', `${coldMs.toFixed(2)}ms`)
  for (const hostile of hostileFixture.cases) runHostileCase(hostile, workspace, facts, catalog)
  /** Warm replay start reusing only the same immutable Program-derived facts. */
  const warmStart = performance.now()
  audit(workspace, facts, catalog)
  /** Warm elapsed milliseconds checked against the 30-second D45 budget. */
  const warmMs = performance.now() - warmStart
  if (warmMs > 30_000) throw new AuditFailure('WARM_BUDGET_EXCEEDED', `${warmMs.toFixed(2)}ms`)
  process.stdout.write(
    `SWV2-T44 PASS packages=${workspace.size} edges=${facts.imports.length} hostile=${hostileFixture.cases.length} coldMs=${coldMs.toFixed(2)} warmMs=${warmMs.toFixed(2)}\n`
  )
}

main()
