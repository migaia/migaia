import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Finds the complete thread source surface for architectural assertions. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('A1 thread boundary', () => {
  it('publishes a separate runtime-neutral subentry', () => {
    const root = join(import.meta.dirname, '../..')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string; default: string }>
    }
    expect(manifest.exports['./threads']).toEqual({
      types: './dist/threads/index.d.ts',
      default: './dist/threads/index.js'
    })
    expect(readFileSync(join(root, 'src/index.ts'), 'utf8')).not.toContain('./threads/')
    const forbiddenIdentifiers = new Set([
      'NodeJS',
      'Buffer',
      'Window',
      'Worker',
      'Deno',
      'Bun',
      'process',
      'createMutationQueue',
      'createGenerationController',
      'createLifecycleScope',
      'createTerminalController',
      'createStringLeaseRegistry',
      'executeReleaseDescriptor',
      'boundedWait',
      'createUnitBudget'
    ])
    for (const path of sources(join(root, 'src/threads'))) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/host|plugin|rpc/i)
      expect(source, path).not.toMatch(/Reflect\.apply|\.call\(|\.apply\(|\.bind\(/)
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
      const inspect = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) expect(forbiddenIdentifiers.has(node.text), path).toBe(false)
        if (ts.isStringLiteral(node)) expect(node.text.startsWith('THREAD_'), path).toBe(false)
        ts.forEachChild(node, inspect)
      }
      inspect(file)
      for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
        const module = statement.moduleSpecifier
        if (!module || !ts.isStringLiteral(module)) continue
        const name = module.text
        if (name.startsWith('../')) expect(['../index.js', '../errors.js'], path).toContain(name)
        else if (name.startsWith('./')) expect(name, path).toMatch(/^\.\/[^/]+\.js$/)
        else {
          expect(name, path).toBe('@migaia/lifecycle')
          expect(
            ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly,
            path
          ).toBe(true)
        }
      }
    }
  })
})
