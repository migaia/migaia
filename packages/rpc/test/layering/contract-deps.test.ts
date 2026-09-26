import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createContractError } from '../../src/contract/contract-error.js'
import { RpcContractErrorCode } from '../../src/contract/error-code.js'
import { createBinaryFramer } from '../../src/contract/framing/message-framer.js'
import { normalizePortable } from '../../src/contract/normalize.js'

/** Contract sources whose new dependency allowlist is enforced by A4. */
const contractRoot = join(import.meta.dirname, '../../src/contract')

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
  it('A4 uses only the two utils imports and preserves native error identity', () => {
    const bare = new Set<string>()
    for (const path of sourceFiles(contractRoot)) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
        if (!specifier.startsWith('.')) bare.add(specifier)
      }
    }
    expect([...bare].sort()).toEqual(['@migaia/utils/bytes', '@migaia/utils/error'])
    const normalizeSource = readFileSync(join(contractRoot, 'normalize.ts'), 'utf8')
    const framerSource = readFileSync(join(contractRoot, 'framing/message-framer.ts'), 'utf8')
    const errorSource = readFileSync(join(contractRoot, 'contract-error.ts'), 'utf8')
    expect(normalizeSource).not.toMatch(/function isUint8Array|instanceof Uint8Array/u)
    expect(framerSource).not.toMatch(/function isUint8Array|instanceof Uint8Array/u)
    expect(errorSource).toContain('attachErrorIdentity')
    expect(errorSource).not.toContain('defineProperty')
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

  it('A4 rejects forged byte views on normalization and framing paths', () => {
    const ordinary = new DataView(new ArrayBuffer(2))
    const tagged = new DataView(new ArrayBuffer(2))
    Object.defineProperty(tagged, Symbol.toStringTag, { value: 'Uint8Array' })
    const forged = Object.create(Uint8Array.prototype) as Uint8Array
    const ordinaryNormalize = rejection(() => normalizePortable(ordinary))
    const ordinaryFrame = createBinaryFramer().accept(ordinary, {
      source: 'peer',
      messageId: 'frame'
    })
    expect(ordinaryFrame.status).toBe('rejected')
    for (const value of [tagged, forged]) {
      expect(rejection(() => normalizePortable(value))).toEqual(ordinaryNormalize)
      const frame = createBinaryFramer().accept(value, { source: 'peer', messageId: 'frame' })
      expect(frame.status).toBe('rejected')
      if (frame.status === 'rejected' && ordinaryFrame.status === 'rejected') {
        expect(frame.error.constructor).toBe(ordinaryFrame.error.constructor)
        expect(frame.error).toMatchObject({
          code: (ordinaryFrame.error as { code?: unknown }).code
        })
      }
    }
  })
})
