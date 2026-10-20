import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync, Visitor, type Statement } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

/** Finds the complete thread source surface for architectural assertions. */
/** Module specifier of a top-level import or re-export statement, if it has one. */
function moduleSpecifier(statement: Statement): string | undefined {
  if (statement.type === 'ImportDeclaration' || statement.type === 'ExportAllDeclaration')
    return statement.source.value
  if (statement.type === 'ExportNamedDeclaration') return statement.source?.value
  return undefined
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('thread boundary', () => {
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
      const program = parseSync(path, source).program
      new Visitor({
        Identifier(node) {
          expect(forbiddenIdentifiers.has(node.name), path).toBe(false)
        },
        Literal(node) {
          if (typeof node.value === 'string')
            expect(node.value.startsWith('THREAD_'), path).toBe(false)
        }
      }).visit(program)
      for (const statement of program.body) {
        const name = moduleSpecifier(statement)
        if (name === undefined) continue
        if (name.startsWith('../')) expect(['../index.js', '../errors.js'], path).toContain(name)
        else if (name.startsWith('./')) expect(name, path).toMatch(/^\.\/[^/]+\.js$/)
        else {
          expect(name, path).toBe('@migaia/lifecycle')
          expect(
            statement.type === 'ImportDeclaration' && statement.importKind === 'type',
            path
          ).toBe(true)
        }
      }
    }
  })
})
