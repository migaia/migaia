import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseSync, Visitor, type ImportDeclaration } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

/** Workspace packages directory scanned by the convergence oracle. */
const packagesRoot = join(import.meta.dirname, '../..')

/** Source extensions the oracle parses. */
const sourceExtension = /\.(?:ts|mts|mjs)$/

/** Lists source files below a directory, skipping installed and generated trees. */
function listSources(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    /** Absolute path of this directory entry. */
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      return entry.name === 'node_modules' || entry.name === 'dist' ? [] : listSources(path)
    return sourceExtension.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

/** Every scanned file: package `src/**`, `test/**` and package-root source files. */
function scannedFiles(): string[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      /** One workspace package root. */
      const packageRoot = join(packagesRoot, entry.name)
      /** Source files that live directly in the package root. */
      const rootFiles = readdirSync(packageRoot, { withFileTypes: true })
        .filter((file) => file.isFile() && sourceExtension.test(file.name))
        .map((file) => join(packageRoot, file.name))
      return [
        ...listSources(join(packageRoot, 'src')),
        ...listSources(join(packageRoot, 'test')),
        ...rootFiles
      ]
    })
}

/** Imported (not local alias) names of the named specifiers of one import declaration. */
function importedNames(node: ImportDeclaration): string[] {
  return node.specifiers.flatMap((specifier) =>
    specifier.type !== 'ImportSpecifier'
      ? []
      : [
          specifier.imported.type === 'Identifier'
            ? specifier.imported.name
            : specifier.imported.value
        ]
  )
}

/** Type names deleted by the convergence; no identifier may keep them alive. */
const deletedTypes = new Set([
  'ILifecycleScheduler',
  'IUtilsScheduler',
  'ISerializeScheduler',
  'ISchedulerSnapshot'
])

/** Implementations that must be declared exactly once, in the utils scheduler module. */
const singleImplementations = ['systemScheduler', 'createManualScheduler', 'systemWallClock']

/** Scheduler symbols that must no longer be imported from their former owners. */
const movedSymbols = new Set([
  'systemScheduler',
  'createManualScheduler',
  'IScheduledTask',
  'IManualScheduler'
])

/** Former owners of the moved scheduler symbols. */
const formerOwners = new Set([
  '@migaia/lifecycle',
  '@migaia/lifecycle/scheduler',
  '@migaia/utils/promise'
])

/** Relative path of the one canonical scheduler module. */
const canonicalModule = 'utils/src/internal/scheduler.ts'

/** A plain-text superset skips AST work only when no checked symbol can occur. */
const candidateTokens = [
  ...deletedTypes,
  ...singleImplementations,
  ...movedSymbols,
  '@migaia/utils/scheduler'
]

describe('single scheduler contract across the workspace', () => {
  it('keeps no deleted type, duplicate implementation, former-owner import or re-export', () => {
    /** Identifier hits of deleted type names as `file:name`. */
    const deletedHits: string[] = []
    /** Declaration sites per single implementation name. */
    const declarations = new Map<string, string[]>(singleImplementations.map((name) => [name, []]))
    /** Imports of moved symbols from former owners as `file:symbol`. */
    const formerImports: string[] = []
    /** Re-exports of the utils scheduler subpath from forbidden modules. */
    const reexports: string[] = []
    for (const path of scannedFiles()) {
      /** Every assertion below requires one of these exact spellings in the source. */
      const source = readFileSync(path, 'utf8')
      if (!candidateTokens.some((token) => source.includes(token))) continue
      /** Package-relative path used in diagnostics and ownership checks. */
      const file = relative(packagesRoot, path)
      /** Whether this file may not re-export the utils scheduler subpath. */
      const reexportForbidden =
        file.startsWith('lifecycle/src/') ||
        file === 'utils/src/promise.ts' ||
        file.startsWith('serialize/src/')
      new Visitor({
        Identifier(node) {
          if (deletedTypes.has(node.name)) deletedHits.push(`${file}:${node.name}`)
        },
        VariableDeclarator(node) {
          if (node.id.type === 'Identifier' && declarations.has(node.id.name))
            declarations.get(node.id.name)!.push(file)
        },
        FunctionDeclaration(node) {
          if (node.id !== null && declarations.has(node.id.name))
            declarations.get(node.id.name)!.push(file)
        },
        ImportDeclaration(node) {
          if (formerOwners.has(node.source.value))
            for (const imported of importedNames(node))
              if (movedSymbols.has(imported)) formerImports.push(`${file}:${imported}`)
        },
        TSImportType(node) {
          if (
            node.source.type === 'Literal' &&
            formerOwners.has(String(node.source.value)) &&
            node.qualifier?.type === 'Identifier' &&
            movedSymbols.has(node.qualifier.name)
          )
            formerImports.push(`${file}:${node.qualifier.name}`)
        },
        ExportNamedDeclaration(node) {
          if (reexportForbidden && node.source?.value === '@migaia/utils/scheduler')
            reexports.push(file)
        },
        ExportAllDeclaration(node) {
          if (reexportForbidden && node.source.value === '@migaia/utils/scheduler')
            reexports.push(file)
        }
      }).visit(parseSync(path, source).program)
    }
    expect(deletedHits).toEqual([])
    for (const name of singleImplementations)
      expect(declarations.get(name), name).toEqual([canonicalModule])
    expect(formerImports).toEqual([])
    expect(reexports).toEqual([])
  })

  it('emits no scheduler shim in the built lifecycle and utils promise declarations', () => {
    /** Declaration outputs that previously carried or could re-carry scheduler symbols. */
    const declarationFiles = [
      'lifecycle/dist/index.d.ts',
      'lifecycle/dist/scheduler.d.ts',
      'utils/dist/promise.d.ts'
    ]
    /** Symbol names that must not appear in those declaration texts. */
    const forbidden = [
      'systemScheduler',
      'createManualScheduler',
      'IScheduledTask',
      'IManualScheduler',
      'ILifecycleScheduler'
    ]
    for (const file of declarationFiles) {
      /** Built declaration text. */
      const text = readFileSync(join(packagesRoot, file), 'utf8')
      for (const name of forbidden) expect(text.includes(name), `${file}:${name}`).toBe(false)
    }
  })

  it('routes storage-web catalog scheduler symbols through the utils scheduler subpath', () => {
    /** Non-capability edge of the bounded capability catalog. */
    type ICatalogEdge = { readonly route: string; readonly symbols: readonly string[] }
    /** Parsed catalog fixture. */
    const catalog = JSON.parse(
      readFileSync(
        join(packagesRoot, 'storage-web/test/fixtures/storage-v2-bounded-capability-catalog.json'),
        'utf8'
      )
    ) as { readonly nonCapabilityEdges: readonly ICatalogEdge[] }
    /** Catalog entry for the lifecycle root route. */
    const lifecycleEdge = catalog.nonCapabilityEdges.find(
      (edge) => edge.route === '@migaia/lifecycle'
    )
    expect(lifecycleEdge).toBeDefined()
    for (const name of ['ILifecycleScheduler', 'IScheduledTask', 'systemScheduler'])
      expect(lifecycleEdge!.symbols).not.toContain(name)
    /** Catalog entry for the utils scheduler route. */
    const schedulerEdge = catalog.nonCapabilityEdges.find(
      (edge) => edge.route === '@migaia/utils/scheduler'
    )
    expect(schedulerEdge).toBeDefined()
    /** Symbols storage-web source imports from the utils scheduler route. */
    const imported = new Set<string>()
    for (const path of listSources(join(packagesRoot, 'storage-web/src')))
      new Visitor({
        ImportDeclaration(node) {
          if (node.source.value === '@migaia/utils/scheduler')
            for (const name of importedNames(node)) imported.add(name)
        }
      }).visit(parseSync(path, readFileSync(path, 'utf8')).program)
    for (const name of imported) expect(schedulerEdge!.symbols).toContain(name)
  })
})
