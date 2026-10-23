import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
/** Export expectations stay with the repository's existing baseline owner. */
const baseline = JSON.parse(
  readFileSync(
    new URL('../../../scripts/fixtures/public-exports.baseline.json', import.meta.url),
    'utf8'
  )
) as { packages: Record<string, Record<string, string[]>> }
describe('SQLite public package entries', () => {
  it('loads the neutral root without loading a runtime driver or re-exporting shared SQL', async () => {
    const root = await import('@migaia/storage-plugin-sqlite')
    expect(Object.keys(root).sort()).toEqual(
      baseline.packages['@migaia/storage-plugin-sqlite']!['.']
    )
    expect(root).not.toHaveProperty('nodeSqliteDriver')
    expect(root).not.toHaveProperty('bunSqliteDriver')
    expect(root).not.toHaveProperty('sqlFragment')
  })
  it('loads actual Node and maintenance subpaths with finite public exports', async () => {
    const driver = await import('@migaia/storage-plugin-sqlite/node')
    const maintenance = await import('@migaia/storage-plugin-sqlite/features/maintenance')
    expect(Object.keys(driver).sort()).toEqual(
      baseline.packages['@migaia/storage-plugin-sqlite']!['./node']
    )
    expect(Object.keys(maintenance).sort()).toEqual(
      baseline.packages['@migaia/storage-plugin-sqlite']!['./features/maintenance']
    )
    const connection = driver.nodeSqliteDriver(':memory:')
    expect('close' in connection).toBe(false)
    await connection.dispose()
  })
})
