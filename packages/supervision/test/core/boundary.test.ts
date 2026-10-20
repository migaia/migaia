import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseSync, Visitor, type Statement } from 'oxc-parser'

/** Finds core and coroutine sources; each later profile owns its separate boundary oracle. */
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
    if (entry.isDirectory() && (entry.name === 'process' || entry.name === 'threads')) return []
    return entry.isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('runtime-neutral boundary', () => {
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
      const program = parseSync(path, text).program
      new Visitor({
        Identifier(node) {
          expect(node.name, relativePath).not.toBe('process')
        }
      }).visit(program)
      for (const statement of program.body) {
        const specifier = moduleSpecifier(statement)
        if (specifier === undefined) continue
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
            '@migaia/utils/error',
            // Reuses the canonical runtime-neutral thenable observer for passive listeners.
            '@migaia/utils/function',
            // Type-only: the structural abort signal is owned by utils.
            '@migaia/utils/promise'
          ]).toContain(specifier)
        }
      }
    }
  })
})
