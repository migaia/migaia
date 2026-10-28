import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync, Visitor, type Statement } from 'oxc-parser'

/** Reads the new profile's source graph, independent of the core boundary oracle. */
/** Module specifier of a top-level import or re-export statement, if it has one. */
function moduleSpecifier(statement: Statement): string | undefined {
  if (statement.type === 'ImportDeclaration' || statement.type === 'ExportAllDeclaration')
    return statement.source.value
  if (statement.type === 'ExportNamedDeclaration') return statement.source?.value
  return undefined
}

function processSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? processSources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('process profile boundary', () => {
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
      '@migaia/utils/error',
      // Type-only: the structural abort signal is owned by utils.
      '@migaia/utils/promise'
    ])
    const allowedParent = new Set([
      '../index.js',
      '../errors.js',
      '../admission.js',
      '../error-code.js',
      '../error-text.js',
      // Stable internal outcome tags have one core contract owner.
      '../text.js'
    ])
    for (const path of processSources(join(root, 'src/process'))) {
      const text = readFileSync(path, 'utf8')
      expect(text, path).not.toMatch(/host|plugin|rpc/i)
      expect(text, path).not.toMatch(
        /\b(?:NodeJS|Buffer|Window|Worker|Deno|Bun)\b|\bnode:|Reflect\.apply|\.call\(|\.apply\(|\.bind\(/
      )
      const program = parseSync(path, text).program
      new Visitor({
        Identifier(node) {
          expect(node.name, path).not.toBe('process')
        }
      }).visit(program)
      for (const statement of program.body) {
        const specifier = moduleSpecifier(statement)
        if (specifier === undefined) continue
        if (specifier.startsWith('../')) expect(allowedParent, path).toContain(specifier)
        else if (specifier.startsWith('./')) expect(specifier, path).toMatch(/\.js$/)
        else expect(allowedExternal, path).toContain(specifier)
      }
    }
  })
})
