import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/** Finds core and coroutine sources; each later profile owns its separate boundary oracle. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && (entry.name === 'process' || entry.name === 'threads')) return []
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('A1 runtime-neutral boundary', () => {
  it('keeps source imports and package dependencies inward', () => {
    const root = join(import.meta.dirname, '../..')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      exports: Record<string, { types: string; default: string }>
    }
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@migaia/lifecycle',
      '@migaia/utils'
    ])
    expect(manifest.exports['.']).toEqual({
      types: './dist/index.d.ts',
      default: './dist/index.js'
    })
    for (const path of sources(join(root, 'src'))) {
      const relativePath = relative(join(root, 'src'), path)
      const text = readFileSync(path, 'utf8')
      expect(text, relativePath).not.toMatch(/host|plugin|rpc/i)
      expect(text, relativePath).not.toMatch(
        /\b(?:NodeJS|Buffer|Window|Worker|Deno|Bun)\b|\bnode:|Reflect\.apply|\.call\(|\.apply\(|\.bind\(/
      )
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
      const checkIdentifiers = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) expect(node.text, relativePath).not.toBe('process')
        ts.forEachChild(node, checkIdentifiers)
      }
      checkIdentifiers(file)
      for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
        const value = statement.moduleSpecifier
        if (!value || !ts.isStringLiteral(value)) continue
        const specifier = value.text
        if (specifier.startsWith('.')) {
          expect(specifier, relativePath).toMatch(/\.js$/)
          if (!relativePath.startsWith('coroutine/'))
            expect(specifier, relativePath).not.toMatch(/coroutine|process|threads/)
          else expect(specifier, relativePath).not.toMatch(/process|threads/)
        } else {
          expect([
            '@migaia/lifecycle',
            '@migaia/lifecycle/scheduler',
            '@migaia/utils/scheduler',
            '@migaia/utils/error'
          ]).toContain(specifier)
        }
      }
    }
  })
})
