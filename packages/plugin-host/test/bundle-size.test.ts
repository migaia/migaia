import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { measureBundle, bundleViolations } from '../../../scripts/bundle-size.mts'

/** Eight owned production entries are fixed by the maintained source budget table. */
const budgets = JSON.parse(
  readFileSync(
    new URL('../../../scripts/fixtures/bundle-size-budgets.json', import.meta.url),
    'utf8'
  )
) as readonly { entry: string; gzip: number; owner: string; forbidden: readonly string[] }[]
/** Public source resolution is independent of a potentially stale dist tree. */
const root = fileURLToPath(new URL('../../../', import.meta.url))

describe('dependency-inclusive production bundles', () => {
  // The table has eight permanent entry rows; this loop does not grow with application input.
  for (const row of budgets)
    it(`${row.owner}: ${row.entry}`, async () => {
      /** All assertions consume the same minified artifact and metafile. */
      const result = await measureBundle(resolve(root, row.entry))
      expect(bundleViolations(result, row)).toEqual([])
      expect(result.external.filter((name) => name.startsWith('@migaia/'))).toEqual([])
      expect(result.inputs.some((name) => name.includes('/dist/'))).toBe(false)
      if (row.owner === 'log-host')
        expect(result.inputs.some((name) => name.includes('packages/plugin-host/src/'))).toBe(true)
      console.info(
        JSON.stringify({ entry: row.entry, min: result.min, gzip: result.gzip, ceiling: row.gzip })
      )
    })
})

/** A public package export must be resolved before forbidden and byte-budget checks run. */
async function forbiddenMutation(): Promise<void> {
  /** The reachable capability export cannot disappear as an unused binding. */
  const result = await measureBundle(
    resolve(root, 'packages/plugin-host/test/fixtures/bundle-forbidden.ts')
  )
  /** The maintained core ceiling is unchanged by the mutation. */
  const budget = budgets.find((row) => row.entry.endsWith('/PluginHost.ts'))!
  /** The mutation names the exact actual source input required by the graph assertion. */
  const forbidden = 'packages/capability/src/index.ts'
  expect(result.inputs).toContain(forbidden)
  expect(result.external.filter((name) => name.startsWith('@migaia/'))).toEqual([])
  /** Check independent failure branches on the same real artifact. */
  const failures = bundleViolations(result, { ...budget, forbidden: [forbidden] })
  expect(failures).toContain('forbidden ' + forbidden)
  expect(result.gzip).toBeGreaterThan(budget.gzip)
  expect(failures).toContain(`gzip ${result.gzip} exceeds ${budget.gzip}`)
}
/** An exported Han literal remains in the exact UTF-8 artifact counted and compressed. */
async function hanMutation(): Promise<void> {
  /** Public export prevents tree-shaking the negative witness. */
  const result = await measureBundle(
    resolve(root, 'packages/plugin-host/test/fixtures/bundle-han.ts')
  )
  expect(result.code).toContain('汉字')
  expect(result.han).toHaveLength(1)
  expect(result.han[0]!.text).toBe('汉字')
  expect(result.han[0]!.sources).toContain('packages/plugin-host/test/fixtures/bundle-han.ts')
  expect(
    bundleViolations(result, { gzip: Number.MAX_SAFE_INTEGER, forbidden: [] }).some((message) =>
      message.startsWith('Han at ')
    )
  ).toBe(true)
}
it('rejects a real reachable forbidden export and unchanged-budget overflow', forbiddenMutation)
it('rejects a surviving Han literal in the measured UTF-8 artifact', hanMutation)
