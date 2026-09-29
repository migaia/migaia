import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as contract from '../../src/contract/index.js'
import * as core from '../../src/core/index.js'

/** Source root used to reject another production serializer declaration. */
const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src')

/** Visit source modules without counting declarations in tests or compiled output. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('one production wire error format', () => {
  it('removes the core serializer module and its runtime names', () => {
    expect(existsSync(join(sourceRoot, 'core/error-serialization.ts'))).toBe(false)
    for (const name of ['serializeError', 'deserializeError', 'reachError'])
      expect(name in core, name).toBe(false)
  })

  it('declares serializer functions only in contract/error.ts', () => {
    const owners: string[] = []
    for (const file of sourceFiles(sourceRoot)) {
      const parsed = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      /** Record declared serializer names, not imports or calls. */
      function visit(node: ts.Node): void {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name &&
          /^(de)?serialize\w*Error$/.test(node.name.text)
        )
          owners.push(relative(sourceRoot, file))
        ts.forEachChild(node, visit)
      }
      visit(parsed)
    }
    expect(new Set(owners)).toEqual(new Set(['contract/error.ts']))
  })

  it('publishes all canonical contract functions and no legacy core serializer', () => {
    for (const name of [
      'serializeRpcError',
      'deserializeRpcError',
      'normalizeRpcSerializedError',
      'reachRpcError',
      'toJsonRpcError',
      'fromJsonRpcError'
    ])
      expect(name in contract, name).toBe(true)
  })
})
