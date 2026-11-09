import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
it('keeps core value and type imports outside optional module implementations', coreBoundary)
it('detects reachable value and type edges while accepting inward module dependencies', mutations)
it('does not publish internal module installation authority', publicAuthority)
