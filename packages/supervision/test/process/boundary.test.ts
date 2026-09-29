import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/** Reads the new profile's source graph, independent of the core boundary oracle. */
function processSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? processSources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('A1 process profile boundary', () => {
  it('keeps the process subentry inward and separate from the root entry', () => {
    const root = join(import.meta.dirname, '../..')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string; default: string }>
    }
    expect(manifest.exports['./process']).toEqual({
      types: './dist/process/index.d.ts',
      default: './dist/process/index.js'
    })
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain("'process/index'")
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).not.toContain("'./process/")
    const allowedExternal = new Set([
      '@migaia/lifecycle',
      '@migaia/lifecycle/scheduler',
      '@migaia/utils/scheduler',
      '@migaia/utils/error'
    ])
    const allowedParent = new Set([
      '../index.js',
      '../errors.js',
      '../admission.js',
      '../error-code.js',
      '../error-text.js'
    ])
    for (const path of processSources(join(root, 'src/process'))) {
      const text = readFileSync(path, 'utf8')
      expect(text, path).not.toMatch(/host|plugin|rpc/i)
      expect(text, path).not.toMatch(
        /\b(?:NodeJS|Buffer|Window|Worker|Deno|Bun)\b|\bnode:|Reflect\.apply|\.call\(|\.apply\(|\.bind\(/
      )
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
      const checkIdentifiers = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) expect(node.text, path).not.toBe('process')
        ts.forEachChild(node, checkIdentifiers)
      }
      checkIdentifiers(file)
      for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
        const value = statement.moduleSpecifier
        if (!value || !ts.isStringLiteral(value)) continue
        const specifier = value.text
        if (specifier.startsWith('../')) expect(allowedParent, path).toContain(specifier)
        else if (specifier.startsWith('./')) expect(specifier, path).toMatch(/\.js$/)
        else expect(allowedExternal, path).toContain(specifier)
      }
    }
  })
})
