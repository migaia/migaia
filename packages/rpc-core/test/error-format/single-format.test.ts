import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as contract from '@migaia/rpc-contract'
import * as core from '@migaia/rpc-core'

/** Source root used to reject another production serializer declaration. */
const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src')
/** The canonical protocol walker moved intact to the independent Contract owner. */
const contractSourceRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../rpc-contract/src'
)

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
    /** Core's held-error operations delegate once to the same Contract walker with its private maps. */
    const delegates: string[] = []
    for (const file of [...sourceFiles(sourceRoot), ...sourceFiles(contractSourceRoot)]) {
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
        ) {
          const ownerRoot = file.startsWith(contractSourceRoot) ? contractSourceRoot : sourceRoot
          const ownerPath = relative(ownerRoot, file)
          if (ownerPath === 'core/internal/error-wire-metadata.ts') {
            expect(node.body?.statements).toHaveLength(1)
            const statement = node.body!.statements[0]!
            expect(ts.isReturnStatement(statement)).toBe(true)
            const returned = (statement as ts.ReturnStatement).expression!
            expect(ts.isCallExpression(returned)).toBe(true)
            const call = returned as ts.CallExpression
            expect(call.expression.getText(parsed)).toBe(
              node.name.text === 'serializeRpcError'
                ? 'serializeProtocolError'
                : 'deserializeProtocolError'
            )
            expect(call.arguments.map((argument) => argument.getText(parsed))).toEqual([
              'value',
              'options',
              node.name.text === 'serializeRpcError' ? 'metadata' : 'routes'
            ])
            delegates.push(ownerPath)
          } else owners.push(ownerPath)
        }
        ts.forEachChild(node, visit)
      }
      visit(parsed)
    }
    expect(new Set(owners)).toEqual(new Set(['contract/error.ts']))
    expect(delegates).toEqual([
      'core/internal/error-wire-metadata.ts',
      'core/internal/error-wire-metadata.ts'
    ])
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
