import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import { createContractError } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { normalizePortable } from '@migaia/rpc-contract/portable'

/** Contract sources whose new dependency allowlist is enforced here. */
const contractRoot = join(import.meta.dirname, '../../src')

/** Recursively gathers contract source files without generated declarations. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : []
  })
}

/** Returns the stable error identity used for a rejected hostile byte value. */
function rejection(action: () => unknown): { ctor: Function; code: unknown } {
  try {
    action()
  } catch (error) {
    return { ctor: (error as Error).constructor, code: (error as { code?: unknown }).code }
  }
  expect.fail('expected a rejected byte value')
}

describe('contract utility ownership', () => {
  it('uses serialize, canonical utils and native feature types while preserving native error identity', () => {
    const bare = new Set<string>()
    for (const path of sourceFiles(contractRoot)) {
      for (const statement of parseSync(path, readFileSync(path, 'utf8')).program.body) {
        if (statement.type !== 'ImportDeclaration') continue
        const specifier = statement.source.value
        if (!specifier.startsWith('.')) bare.add(specifier)
      }
    }
    /** Set equality proves the entire dynamic dependency domain without comparison sorting. */
    expect(bare).toEqual(
      new Set([
        '@migaia/plugin-host',
        '@migaia/serialize',
        '@migaia/serialize/core',
        '@migaia/utils/bytes',
        '@migaia/utils/error',
        '@migaia/utils/string',
        '@migaia/utils/promise',
        '@migaia/utils/scheduler'
      ])
    )
    const normalizeSource = readFileSync(join(contractRoot, 'portable/normalize.ts'), 'utf8')
    const errorSource = readFileSync(join(contractRoot, 'contract/contract-error.ts'), 'utf8')
    expect(normalizeSource).not.toMatch(/function isUint8Array|instanceof Uint8Array/u)
    expect(errorSource).toContain('attachErrorIdentity')
    expect(errorSource).not.toMatch(/Object\.defineProperty\([^,]+,\s*['"](?:source|code)['"]/u)
    const error = createContractError(RpcContractErrorCode.invalidDescriptor)
    expect(error).toBeInstanceOf(TypeError)
    expect(Object.getOwnPropertyDescriptor(error, 'source')).toMatchObject({
      enumerable: true,
      writable: false,
      configurable: false
    })
    expect(Object.getOwnPropertyDescriptor(error, 'code')).toMatchObject({
      enumerable: true,
      writable: false,
      configurable: false
    })
    expect(normalizePortable(runInNewContext('new Uint8Array([1, 2])'))).toMatchObject({
      $rpc: 'bytes'
    })
    class B extends Uint8Array {}
    expect(normalizePortable(new B([1, 2]))).toMatchObject({ $rpc: 'bytes' })
  })

  it('rejects forged byte views on normalization and framing paths', () => {
    const ordinary = new DataView(new ArrayBuffer(2))
    const tagged = new DataView(new ArrayBuffer(2))
    Object.defineProperty(tagged, Symbol.toStringTag, { value: 'Uint8Array' })
    const forged = Object.create(Uint8Array.prototype) as Uint8Array
    const ordinaryNormalize = rejection(() => normalizePortable(ordinary))
    for (const value of [tagged, forged]) {
      expect(rejection(() => normalizePortable(value))).toEqual(ordinaryNormalize)
    }
  })
})
