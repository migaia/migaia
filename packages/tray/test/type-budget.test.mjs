import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Tray package root used to select the installed local TypeScript compiler. */
const packageDirectory = resolve(new URL('..', import.meta.url).pathname)

describe('TPD-T59 baseline-aware bounded readiness type budget', () => {
  it('compiles exact 64/128 baseline views and bounded dynamic fallbacks', () => {
    const compiler = resolve(packageDirectory, 'node_modules/.bin/tsc')
    const output = execFileSync(
      compiler,
      [
        '--noEmit',
        '--extendedDiagnostics',
        '-p',
        resolve(packageDirectory, 'test/tsconfig.type-budget.json')
      ],
      { cwd: packageDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    expect(output).not.toMatch(/TS2589|excessively deep/i)
    expect(output).toMatch(/Instantiations:\s+\d+/)
    expect(output).toMatch(/Types:\s+\d+/)
    const instantiations = Number(output.match(/Instantiations:\s+(\d+)/)?.[1])
    expect(instantiations).toBeLessThanOrEqual(100_000)
  })
})
