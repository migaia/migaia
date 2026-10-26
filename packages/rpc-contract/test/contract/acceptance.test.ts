import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { normalizePortable } from '@migaia/rpc-contract/portable'
import { deserializeRpcError, serializeRpcError } from '@migaia/rpc-contract/errors'

const packageRoot = dirname(dirname(dirname(decodeURI(import.meta.url).replace(/^file:\/\//u, ''))))

/** Walk a package source tree for the closed-world architecture assertion. */
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })
}

describe('pure contract acceptance', () => {
  it('publishes only runtime-neutral pure contract/protocol exports with an explicit dependency allowlist', () => {
    const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      exports?: Record<string, unknown>
    }
    expect(metadata.exports).toMatchObject({
      '.': expect.any(Object),
      './protocol': expect.any(Object),
      './interfaces': expect.any(Object),
      './portable': expect.any(Object),
      './errors': expect.any(Object)
    })
    /**
     * Portable traversal moves inward to serialize; platform and unrelated package imports stay
     * forbidden.
     */
    const allowedBareSpecifiers = new Set<string>([
      '@migaia/serialize',
      '@migaia/serialize/core',
      '@migaia/utils/bytes',
      '@migaia/utils/error',
      '@migaia/utils/string',
      '@migaia/utils/promise'
    ])
    const bareSpecifiers = new Set<string>()
    for (const path of sourceFiles(join(packageRoot, 'src'))) {
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(
        /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/gu
      )) {
        const specifier = match[1] ?? match[2]
        if (specifier && !specifier.startsWith('.')) bareSpecifiers.add(specifier)
      }
    }
    expect(bareSpecifiers).toEqual(allowedBareSpecifiers)
  })

  it('accepts canonical values and rejects the complete forbidden matrix', () => {
    const vectors = JSON.parse(
      readFileSync(
        join(packageRoot, '../rpc-integration/schema/vectors/portable-values.json'),
        'utf8'
      )
    ) as { cases: Array<{ value: unknown }> }
    for (const vector of vectors.cases)
      expect(normalizePortable(vector.value)).toEqual(vector.value)
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const invalid: unknown[] = [
      new Date(),
      new Map(),
      new Set(),
      cycle,
      () => undefined,
      Symbol('invalid'),
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      { $rpc: 'bytes', base64url: 'A' },
      { $rpc: 'bytes', base64url: 'AB' },
      { $rpc: 'bytes', base64url: 'AA=' },
      { $rpc: 'reserved', value: 'invalid' }
    ]
    for (const value of invalid) expect(() => normalizePortable(value)).toThrow()
  })

  it('preserves foreign realm identity, stack, cause order, and aggregate errors', () => {
    const context = createContext({})
    const remote = runInContext(
      `(() => {
        const cause = new RangeError('remote cause')
        Object.defineProperty(cause, 'source', { value: '@remote', enumerable: true })
        Object.defineProperty(cause, 'code', { value: 'REMOTE_CAUSE', enumerable: true })
        const cleanup = new Error('cleanup')
        const root = new TypeError('remote root')
        Object.defineProperty(root, 'source', { value: '@remote', enumerable: true })
        Object.defineProperty(root, 'code', { value: 'REMOTE_ROOT', enumerable: true })
        Object.defineProperty(root, 'cause', { value: cause })
        Object.defineProperty(root, 'errors', { value: [cleanup] })
        return root
      })()`,
      context
    )
    const wire = serializeRpcError(remote, { report: () => {} })
    expect(wire).toMatchObject({ source: '@remote', code: 'REMOTE_ROOT', name: 'TypeError' })
    expect(wire.stack).toBeTypeOf('string')
    expect(wire.cause?.code).toBe('REMOTE_CAUSE')
    expect(wire.errors?.[0]?.message).toBe('cleanup')
    const restored = deserializeRpcError(wire)
    expect(restored).toBeInstanceOf(TypeError)
    expect(restored.stack).toBe(wire.stack)
    expect((restored as Error & { cause: Error }).cause).toBeInstanceOf(RangeError)
    expect((restored as Error & { errors: Error[] }).errors[0]?.message).toBe('cleanup')
  })
})
