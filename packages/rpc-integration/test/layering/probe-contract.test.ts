import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

/** Probe definitions remain independent of host and carrier implementations. */
const probeRoot = join(import.meta.dirname, '../../../rpc-core/src/core/probe')
/** Devtools contracts may consume only the two public inward-facing RPC owners. */
const devtoolsRoot = join(import.meta.dirname, '../../../rpc-devtools/src')

/** Enumerate maintained TypeScript files for the contract dependency assertions. */
function sourceFiles(directory: string): string[] {
  /** Nested contracts share the same owner and dependency direction. */
  const paths: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    /** Exact source path supplies actionable assertion messages. */
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...sourceFiles(path))
    else if (entry.name.endsWith('.ts')) paths.push(path)
  }
  return paths
}

/** Read import and re-export edges without depending on runtime module resolution. */
function imports(path: string): string[] {
  /** The parser distinguishes module specifiers from example strings and comments. */
  const program = parseSync(path, readFileSync(path, 'utf8')).program
  /** Both imports and re-exports must retain the package boundary. */
  const specifiers: string[] = []
  for (const statement of program.body) {
    const specifier =
      statement.type === 'ImportDeclaration' || statement.type === 'ExportAllDeclaration'
        ? statement.source.value
        : statement.type === 'ExportNamedDeclaration'
          ? statement.source?.value
          : undefined
    if (specifier !== undefined) specifiers.push(specifier)
  }
  return specifiers
}

describe('rpc-devtools layer-1 dependency direction', () => {
  it('contract A1 keeps probe definitions free of host and carrier imports', () => {
    for (const path of sourceFiles(probeRoot))
      for (const specifier of imports(path))
        expect(specifier, path).not.toMatch(
          /^(?:node:|bun:|@migaia\/rpc-(?:process|threads|browser|bridge-jsonrpc|devtools)(?:\/|$))/u
        )
  })

  it('contract A3 keeps the devtools scaffold on public core and contract entries', () => {
    for (const path of sourceFiles(devtoolsRoot))
      for (const specifier of imports(path)) {
        if (specifier.startsWith('.')) expect(specifier, path).toMatch(/\.js$/u)
        // The runtime-neutral scheduler is the only foundation import: one clock for snapshots.
        else
          expect(specifier, path).toMatch(
            /^(?:@migaia\/rpc-(?:core|contract)(?:\/|$)|@migaia\/utils\/scheduler$)/u
          )
      }
  })
})
