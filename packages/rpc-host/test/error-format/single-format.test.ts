import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync, Visitor } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import * as contract from '@migaia/rpc-contract'
import * as errors from '@migaia/rpc-contract/errors'
import * as core from '@migaia/rpc-host'

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
    for (const name of [
      'serializeError',
      'deserializeError',
      'reachError',
      'serializeRpcError',
      'deserializeRpcError',
      'normalizeRpcSerializedError',
      'reachRpcError',
      'serializeRpcWireError',
      'deserializeRpcWireError'
    ])
      expect(name in core, name).toBe(false)
  })

  it('declares error projections only at the canonical Contract owners', () => {
    const owners: string[] = []
    /** Core's held-error operations delegate once to the same Contract walker with its private maps. */
    const delegates: string[] = []
    for (const file of [...sourceFiles(sourceRoot), ...sourceFiles(contractSourceRoot)]) {
      const text = readFileSync(file, 'utf8')
      /** One file inspection supplies the callback's explicit source and expected delegate facts. */
      const inspection = {
        text,
        path: relative(file.startsWith(contractSourceRoot) ? contractSourceRoot : sourceRoot, file),
        owners,
        delegates,
        calls: {
          serializeRpcError: {
            callee: 'serializeProtocolError',
            arguments: ['value', 'options', 'hostErrorWireMetadata']
          },
          deserializeRpcError: {
            callee: 'deserializeProtocolError',
            arguments: ['value', 'options', 'hostErrorWireMetadata']
          },
          serializeHostWireError: {
            callee: 'serializeRpcWireError',
            arguments: ['value', 'options', 'hostErrorWireMetadata']
          },
          deserializeHostWireError: {
            callee: 'deserializeRpcWireError',
            arguments: ['value', 'hostErrorWireMetadata']
          }
        }
      }
      /** Record declared serializer names, not imports or calls. */
      new Visitor({
        FunctionDeclaration(node) {
          if (!node.id || !/^(de)?serialize\w*Error$/.test(node.id.name)) return
          const name = node.id.name
          if (inspection.path === 'host/error-wire-metadata.ts') {
            /** Restoration may add route bookkeeping after storing the canonical result first. */
            const routed = name === 'deserializeHostWireError'
            if (!routed) expect(node.body?.body).toHaveLength(1)
            const statement = node.body!.body[0]!
            expect(statement.type).toBe(routed ? 'VariableDeclaration' : 'ReturnStatement')
            const returned =
              statement.type === 'ReturnStatement'
                ? statement.argument
                : statement.type === 'VariableDeclaration'
                  ? statement.declarations[0]?.init
                  : null
            expect(returned?.type).toBe('CallExpression')
            if (returned?.type !== 'CallExpression') return
            /** Only these exact private metadata borrowers may delegate to canonical projections. */
            const call = inspection.calls[name as keyof typeof inspection.calls]
            expect(call, name).toBeDefined()
            if (!call) return
            expect(inspection.text.slice(returned.callee.start, returned.callee.end)).toBe(
              call.callee
            )
            /** Host's diagnostic projection borrows the walker while retaining its boundary code. */
            const argumentsToCheck = returned.arguments.map((argument, index) =>
              name === 'serializeHostWireError' && index === 1
                ? 'options'
                : inspection.text.slice(argument.start, argument.end)
            )
            expect(argumentsToCheck).toEqual(call.arguments)
            inspection.delegates.push(`${inspection.path}:${name}`)
          } else inspection.owners.push(`${inspection.path}:${name}`)
        }
      }).visit(parseSync(file, text).program)
    }
    expect(owners).toHaveLength(4)
    expect(new Set(owners)).toEqual(
      new Set([
        'contract/error.ts:serializeRpcError',
        'contract/error.ts:deserializeRpcError',
        'wire/errors.ts:serializeRpcWireError',
        'wire/errors.ts:deserializeRpcWireError'
      ])
    )
    expect(delegates).toHaveLength(4)
    expect(new Set(delegates)).toEqual(
      new Set([
        'host/error-wire-metadata.ts:serializeRpcError',
        'host/error-wire-metadata.ts:deserializeRpcError',
        'host/error-wire-metadata.ts:serializeHostWireError',
        'host/error-wire-metadata.ts:deserializeHostWireError'
      ])
    )
  })

  it('publishes all canonical contract functions and no legacy core serializer', () => {
    for (const name of [
      'serializeRpcError',
      'deserializeRpcError',
      'normalizeRpcSerializedError',
      'reachRpcError'
    ]) {
      expect(name in contract, name).toBe(true)
      expect(name in errors, name).toBe(true)
    }
    for (const name of ['toJsonRpcError', 'fromJsonRpcError']) {
      expect(name in contract, name).toBe(false)
      expect(name in errors, name).toBe(false)
    }
  })
})
