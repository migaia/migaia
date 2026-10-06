import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Runtime exports must resolve from built files as an ordinary ESM consumer sees them. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** Traverse static imports only; adapter loading is forbidden in the neutral threads entry. */
function importClosure(file: string, visited = new Set<string>()): string[] {
  if (visited.has(file)) return []
  visited.add(file)
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  return source.statements.flatMap((statement) => {
    if (
      (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      return []
    const specifier = statement.moduleSpecifier.text
    if (!specifier.startsWith('.')) return [specifier]
    const target = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'))
    return [target, ...importClosure(target, visited)]
  })
}

describe('threads public exports', () => {
  it('[A1][A25] removes all three directional thread factories from the built namespace', async () => {
    /** Ordinary packed-subpath resolution must not retain aliases after the consumer migration. */
    const runtime = await import('@migaia/rpc/threads')
    for (const name of ['createThreadHost', 'createServeThreadHost', 'createServeThreadPlugin'])
      expect(Object.hasOwn(runtime, name), '[A25] retired thread factory must be absent').toBe(
        false
      )
    expect(runtime.createThreadPeer).toBeTypeOf('function')
    expect(runtime.createThreadPlugin).toBeTypeOf('function')
  })
  it('[A8] exports all platform factories with no new dependencies and no platform root imports', async () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    const base = JSON.parse(
      readFileSync(resolve(root, 'test/threads/fixtures/base-manifest.json'), 'utf8')
    )
    expect(manifest.dependencies).toEqual(base.dependencies)
    expect(manifest.peerDependencies).toEqual(base.peerDependencies)
    expect(manifest.exports['.']).toBeUndefined()
    for (const entry of [
      'threads',
      ...['node', 'deno', 'bun', 'electron-main', 'electron-renderer', 'browser'].map(
        (name) => `threads/adapters/${name}`
      )
    ]) {
      const exported = manifest.exports[`./${entry}`]
      expect(exported).toBeDefined()
      expect(existsSync(resolve(root, exported.types))).toBe(true)
      const runtime = await import(pathToFileURL(resolve(root, exported.default)).href)
      expect(Object.keys(runtime).length).toBeGreaterThan(0)
      if (entry.includes('adapters/')) expect(Object.keys(runtime)).toHaveLength(2)
    }
    const imports = importClosure(resolve(root, 'src/threads/index.ts'))
    expect(imports.filter((item) => /threads\/adapters\/|^(?:node:|electron$)/.test(item))).toEqual(
      []
    )
  })
})
