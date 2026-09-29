import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as contract from '../../src/contract/index.js'
import * as core from '../../src/core/index.js'
import { RpcContractErrorCode } from '../../src/contract/error-code.js'
import { RpcCoreErrorCode } from '../../src/core/error-code.js'

/** Inspect source identifiers exactly, so retained coordinator names are never false positives. */
function identifiers(root: string): Set<string> {
  const found = new Set<string>()
  /** Traverse only tracked TypeScript source shapes. */
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.ts')) {
        const source = ts.createSourceFile(
          path,
          readFileSync(path, 'utf8'),
          ts.ScriptTarget.Latest,
          true
        )
        /** Capture whole identifier tokens, not substrings of valid replacements. */
        function visit(node: ts.Node): void {
          if (ts.isIdentifier(node)) found.add(node.text)
          ts.forEachChild(node, visit)
        }
        visit(source)
      }
    }
  }
  walk(root)
  return found
}

describe('one owner for wire routes and public control contracts (A11)', () => {
  it('removes legacy core symbols while retaining public contract and core exports', () => {
    const src = join(import.meta.dirname, '../../src')
    expect(existsSync(join(src, 'core/internal/routing-data.ts'))).toBe(false)
    const names = identifiers(join(src, 'core'))
    for (const old of [
      'RpcVariation',
      'IRpcVariation',
      'sendVariation',
      'onVariationFailure',
      'normalizeWebRpcRoutingData',
      'webRpc'
    ])
      expect(names.has(old), old).toBe(false)
    const route = readFileSync(join(src, 'contract/v1/route.ts'), 'utf8')
    expect(route).toContain('RpcRouteField')
    const sourceFiles = ['contract/wire-constants.ts', 'contract/v1/route.ts']
    expect(
      sourceFiles.filter((file) =>
        readFileSync(join(src, file), 'utf8').includes("'migaia.rpc.route'")
      )
    ).toEqual(['contract/wire-constants.ts'])
    for (const name of [
      'normalizeRpcEnvelope',
      'createRpcHello',
      'normalizeRpcHandshake',
      'acceptRpcHandshake',
      'completeRpcHandshake',
      'createRpcUnknownFieldWarner',
      'RpcProtocol',
      'RpcControl',
      'RpcCapability',
      'RpcHandshakeReason'
    ])
      expect(Object.hasOwn(contract, name), name).toBe(true)
    expect(Object.hasOwn(core, 'createRpcIdempotencyStore')).toBe(true)
    expect(Object.values(RpcContractErrorCode)).not.toContain('CANCELLED')
    expect(Object.values(RpcContractErrorCode)).not.toContain('DEADLINE_EXCEEDED')
    expect(RpcCoreErrorCode.cancelled).toBe('CANCELLED')
    expect(RpcCoreErrorCode.deadlineExceeded).toBe('DEADLINE_EXCEEDED')
  })
})
