/**
 * This file checks delivery-process artifacts, not product behavior. It needs workspace-local docs/
 * and is excluded from the package gate.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readerEvidencePath = resolve(
  import.meta.dirname,
  '../../../../docs/plugin-host/native-feature-reader-evidence.mjs'
)
const workspaceRoot = resolve(import.meta.dirname, '../../../..')

/** Runs the current PC03 reader oracle without consulting protected rpc-contract custody. */
const readCurrentReaderEvidence = () =>
  JSON.parse(
    execFileSync(process.execPath, [readerEvidencePath, workspaceRoot], {
      cwd: workspaceRoot,
      encoding: 'utf8'
    })
  ) as {
    readonly schema: string
    readonly roots: readonly string[]
    readonly scannedFiles: number
    readonly activeReaders: readonly unknown[]
    readonly result: 'PASS' | 'FAIL'
  }

/** WRC-B01-T17 proves current reader closure through the task-owned NF evidence producer. */
describe('WRC-B01 current native-feature reader closure', () => {
  it('reads the complete nonwebsite owner universe without using protected historical custody', () => {
    const evidence = readCurrentReaderEvidence()
    expect(evidence.schema).toBe('native-feature-reader-evidence/v1')
    expect(evidence.result).toBe('PASS')
    expect(evidence.activeReaders).toEqual([])
    expect(evidence.scannedFiles).toBeGreaterThan(0)
    expect(evidence.roots).toEqual(
      expect.arrayContaining([
        'packages/plugin-host/src',
        'packages/web-rpc/src',
        'packages/storage-web/src',
        'packages/store-persist/src',
        'fixtures/consumers'
      ])
    )
  })

  it('fails when a disposable same-directory legacy translator alias is introduced', () => {
    const specimenDirectory = mkdtempSync(join(tmpdir(), 'native-feature-reader-'))
    const specimenPath = join(specimenDirectory, 'alias.ts')
    /** Joins the prohibited test fixture without making this test itself a reader finding. */
    const retiredSpecifier = './internal/' + 'plugin-' + 'translator.js'
    try {
      writeFileSync(specimenPath, `import '${retiredSpecifier}'\n`, 'utf8')
      expect(() =>
        execFileSync(
          process.execPath,
          [readerEvidencePath, workspaceRoot, '--specimen', specimenPath],
          {
            cwd: workspaceRoot,
            encoding: 'utf8'
          }
        )
      ).toThrow()
    } finally {
      rmSync(specimenDirectory, { recursive: true, force: true })
    }
  })
})
