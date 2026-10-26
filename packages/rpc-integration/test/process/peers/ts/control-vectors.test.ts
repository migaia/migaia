import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Current baseline vectors share one canonical directory and explicit digest manifest. */
const vectorRoot = join(import.meta.dirname, '../../../../schema/vectors')

/** Read one checked-in JSON artifact without importing runtime internals. */
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('current protocol schemas and baseline vectors', () => {
  it('checks each current baseline vector digest against the checked-in manifest', () => {
    const baseline = readJson(join(vectorRoot, 'protocol-baseline.json')) as {
      selftestVectors: string[]
      contractVectors: string[]
    }
    const expectedFiles = [
      'protocol-baseline.json',
      ...baseline.selftestVectors,
      ...baseline.contractVectors
    ]
    const checksums = readFileSync(join(vectorRoot, 'SHA256SUMS'), 'utf8').trim().split('\n')
    const files = checksums.map((row) => row.split('  ')[1])
    expect(files).toEqual(expectedFiles)
    for (const row of checksums) {
      const [digest, filename] = row.split('  ')
      const contents = readFileSync(join(vectorRoot, filename!))
      expect(createHash('sha256').update(contents).digest('hex')).toBe(digest)
    }
  })
})
