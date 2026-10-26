import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { describe, expect, it } from 'vitest'

/** Preparation-only loader never executes a measured performance window. */
const { assertFdFixtureImports } = await import(
  new URL('../bench/fd-fixture-loader.mjs', import.meta.url).href
)
/** Maintained fixture is the sole source of the extracted launcher implementation. */
const source = readFileSync(
  new URL('../bridge/fixtures/jsonrpc-process.ts', import.meta.url),
  'utf8'
)
/** Strip only the function body, matching the production preparation path. */
const start = source.indexOf('export function fdLauncher(')
/** Keep the canonical function through EOF when its retired sibling no longer follows it. */
const next = source.indexOf('\n/**', start)
/** A declaration after this function, when present, is excluded from offline preparation. */
const end = next === -1 ? source.length : next
/** Type erasure removes imports that exist only in the compile-time contract. */
const body = stripTypeScriptTypes(source.slice(start, end))

describe('canonical FD preparation imports', () => {
  it('accepts the maintained factory and rejects a moved runtime dependency', () => {
    expect(() => assertFdFixtureImports(source, body)).not.toThrow()
    expect(() =>
      assertFdFixtureImports(source.replace("from 'node:events'", "from 'node:timers'"), body)
    ).toThrow('Canonical FD fixture imports drifted')
  })
  it('rejects a new imported identifier used by the erased body', () => {
    expect(() =>
      assertFdFixtureImports(
        `import { newRuntimePort } from 'node:events';\n${source}`,
        `${body}\nnewRuntimePort()`
      )
    ).toThrow('Canonical FD fixture imports drifted')
  })
})
