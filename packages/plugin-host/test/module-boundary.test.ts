import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseSync } from 'oxc-parser'
import { expect, it } from 'vitest'
/** Canonical production source root, independent of a built distribution. */
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
/** Enumerates each actual source file once, excluding generated output. */
function sources(directory: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...sources(path))
    else if (entry.name.endsWith('.ts')) result.push(path)
  }
  return result
}
/** Finds forbidden static module edges, including type imports and re-exports. */
function forbiddenEdges(path: string, text: string): string[] {
  const result: string[] = []
  for (const statement of parseSync(path, text).program.body) {
    if (!('source' in statement) || !statement.source || typeof statement.source.value !== 'string')
      continue
    const specifier = statement.source.value
    if (
      specifier.startsWith('.') &&
      relative(sourceRoot, resolve(path, '..', specifier)).startsWith('modules/')
    )
      result.push(specifier)
  }
  return result
}
/** Core runtime and type-only dependencies must both stay independent of optional implementations. */
function coreBoundary(): void {
  for (const path of sources(sourceRoot)) {
    if (relative(sourceRoot, path).startsWith('modules/')) continue
    expect(forbiddenEdges(path, readFileSync(path, 'utf8')), relative(sourceRoot, path)).toEqual([])
  }
}
/** Both kinds of forbidden edges fail while the allowed inward direction remains valid. */
function mutations(): void {
  expect(
    forbiddenEdges(
      join(sourceRoot, 'mutation.ts'),
      `import {featuresModule} from './modules/features/index.ts'
void featuresModule`
    )
  ).toEqual(['./modules/features/index.ts'])
  expect(
    forbiddenEdges(
      join(sourceRoot, 'mutation.ts'),
      `import type {IFeatureFactory} from './modules/features/feature-types.ts'
export type IUse=IFeatureFactory`
    )
  ).toEqual(['./modules/features/feature-types.ts'])
  expect(
    forbiddenEdges(
      join(sourceRoot, 'modules/features/mutation.ts'),
      "import type {IRegistration} from '../../registry.ts'"
    )
  ).toEqual([])
}
/** Public root declarations expose opaque modules without exporting their installation authority. */
function publicAuthority(): void {
  const index = readFileSync(join(sourceRoot, 'index.ts'), 'utf8')
  expect(index).not.toMatch(
    /export[^;]*\b(?:defineModule|IHostModuleDefinition|PluginHostRuntimePorts)\b/
  )
}
/** Package root that owns the published exports map and its built declarations. */
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
/** Internal installation authority that no published entry may expose as a value or type. */
const internalAuthority = new Set([
  'defineModule',
  'HostModules',
  'IHostModuleDefinition',
  'PluginHostRuntimePorts',
  'IPluginHostRuntimeContext'
])
/** Collects every name a declaration file exports, following `export *` once per file. */
function declaredExports(path: string, seen: Set<string>, names: Set<string>): void {
  if (seen.has(path)) return
  seen.add(path)
  for (const statement of parseSync(path, readFileSync(path, 'utf8')).program.body) {
    if (statement.type === 'ExportAllDeclaration') {
      /** Built declarations name runtime `.js` siblings; the declaration file sits next to them. */
      const target = resolve(dirname(path), statement.source.value.replace(/\.(?:js|ts)$/, '.d.ts'))
      if (statement.exported) names.add(String((statement.exported as { name?: string }).name))
      else if (existsSync(target)) declaredExports(target, seen, names)
      continue
    }
    if (statement.type !== 'ExportNamedDeclaration') continue
    for (const specifier of statement.specifiers)
      names.add(
        String(
          (specifier.exported as { name?: string; value?: string }).name ??
            (specifier.exported as { value?: string }).value
        )
      )
    /** Inline declarations (`export declare function x`) carry their own identifier. */
    const declaration = statement.declaration as {
      id?: { name?: string }
      declarations?: { id?: { name?: string } }[]
    } | null
    if (declaration?.id?.name) names.add(declaration.id.name)
    for (const item of declaration?.declarations ?? []) if (item.id?.name) names.add(item.id.name)
  }
}
/** Every published entry hides installation authority from both its runtime and declaration exports. */
async function publishedEntries(): Promise<void> {
  /** The exports map is the complete published surface. */
  const exportsMap = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    .exports as Record<string, { types: string; default: string }>
  for (const [entry, target] of Object.entries(exportsMap)) {
    /** Runtime names come from the built module consumers actually load. */
    const runtime = Object.keys(await import(pathToFileURL(join(packageRoot, target.default)).href))
    /** Declared names include every re-exported type reachable from the entry declaration. */
    const declared = new Set<string>()
    declaredExports(join(packageRoot, target.types), new Set(), declared)
    expect(declared.size, entry).toBeGreaterThan(0)
    // The root witness proves the walker reads real class and re-exported names.
    if (entry === '.')
      expect([...declared]).toEqual(expect.arrayContaining(['PluginHost', 'definePlugin']))
    for (const name of [...runtime, ...declared])
      expect(internalAuthority.has(name), `${entry} exports ${name}`).toBe(false)
  }
}
it('keeps core value and type imports outside optional module implementations', coreBoundary)
it(
  'hides installation authority from every published runtime and declaration entry',
  publishedEntries
)
it('detects reachable value and type edges while accepting inward module dependencies', mutations)
it('does not publish internal module installation authority', publicAuthority)
