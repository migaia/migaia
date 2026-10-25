import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('constructs the ordinary Bun URL spawn and calls its actual Worker', () => {
  /** Bun executes a genuine service child through the current public built package. */
  const fixture = fileURLToPath(new URL('./fixtures/audit-bun-short.mts', import.meta.url))
  /** The receipt includes owned cleanup so a pending exit cannot pass behind business success. */
  const output = execFileSync('bun', [fixture], { encoding: 'utf8', timeout: 25_000 })
  expect(JSON.parse(output.trim().split('\n').at(-1)!)).toEqual({
    value: 'actual-bun-worker',
    diagnostics: []
  })
}, 30_000)
