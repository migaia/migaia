import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type ICustodyResult = {
  readonly status: 'PASS' | 'FAIL'
  readonly baseStatus: 'PASS' | 'FAIL'
  readonly overlayStatus: 'PASS' | 'FAIL'
  readonly v14Status: 'PASS' | 'FAIL'
  readonly v15Status: 'PASS' | 'FAIL'
  readonly successor: {
    readonly moduleCount: number
    readonly rawBytes: number
    readonly gzipBytes: number
    readonly endpointStaticImportCount: number
  }
  readonly predecessor: ICustodyResult['successor']
  readonly historicalRecipeIdentity: Readonly<{
    authoritative: false
    kind: 'historical-recipe-identity'
    predecessorSourceSha256: string
    successorHunkSha256: string
  }>
  readonly changedModules: readonly string[]
  readonly causalRows: readonly { readonly id: string; readonly status: string }[]
  readonly residualCount: number
  readonly errors: readonly string[]
  readonly baseErrors: readonly string[]
  readonly overlayErrors: readonly string[]
  readonly successorOverlayErrors: readonly string[]
  readonly overlayDigest: string
}

const packageRoot = resolve(import.meta.dirname, '../..')
const validator = resolve(packageRoot, 'test/tree-shaking/intended-cost-custody.mjs')

/**
 * Executes the package-local custody validator as a fresh process. The process may read only its
 * persisted artifact and canonical package build inputs.
 */
function readCustodyResult(): ICustodyResult {
  return JSON.parse(
    execFileSync(process.execPath, [validator], {
      cwd: packageRoot,
      encoding: 'utf8'
    })
  ) as ICustodyResult
}

/** Authenticates immutable D18 custody, stored recipe identity, and residual matrix history. */
describe('RPCC-D18 intended-cost custody', () => {
  it('passes immutable successor, predecessor, dual-hash, and causal-row custody', () => {
    const result = readCustodyResult()
    expect(result.status).toBe('PASS')
    expect(result.baseStatus).toBe('PASS')
    expect(result.overlayStatus).toBe('PASS')
    expect(result.v14Status).toBe('PASS')
    expect(result.v15Status).toBe('PASS')
    expect(result.errors).toEqual([])
    expect(result.baseErrors).toEqual([])
    expect(result.overlayErrors).toEqual([])
    expect(result.successorOverlayErrors).toEqual([])
    expect(result.historicalRecipeIdentity).toEqual({
      authoritative: false,
      kind: 'historical-recipe-identity',
      predecessorSourceSha256: '7ad43d2e3fe28189809d89274098d86824cd95659949a69cdf05cbadf54cfd17',
      successorHunkSha256: '23171f46f052fd2332844a976f114d6264057ed6ce1041fde42ce051d464e57f'
    })
    expect(result.overlayDigest).toBe(
      'b92e03b7104c833e47d6bda121047afc1c3f8c9cbdcf3742ccc2dd1375ca691e'
    )
    expect(result.successor).toEqual({
      moduleCount: 119,
      rawBytes: 468754,
      gzipBytes: 112123,
      endpointStaticImportCount: 13
    })
    expect(result.predecessor).toEqual({
      moduleCount: 119,
      rawBytes: 468731,
      gzipBytes: 112116,
      endpointStaticImportCount: 13
    })
    expect(result.changedModules).toEqual(['packages/web-rpc/src/core.ts'])
    expect(result.causalRows).toEqual([
      { id: 'F006-PASS-B01-ROOT-D18', status: 'PASS' },
      { id: 'F006-PASS-B11-D18', status: 'PASS' },
      { id: 'F006-PASS-B11F-D18', status: 'PASS' },
      { id: 'F006-PASS-B01-CHUNK', status: 'PASS' },
      { id: 'F006-PASS-B11-CHUNK', status: 'PASS' }
    ])
    expect(result.residualCount).toBe(8)
  })
})
