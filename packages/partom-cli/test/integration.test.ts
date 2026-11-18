import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { FIXTURES, partom } from './run.ts'

/** Package root. */
const ROOT = join(import.meta.dirname, '..')
/** Compiled executable path, built once. */
let exe = ''

/** Runs the compiled executable in a fixture directory. */
function run(
  fixture: string,
  args: readonly string[]
): { readonly code: number; readonly stdout: string } {
  /** Child result. */
  const result = spawnSync(exe, args, {
    cwd: join(FIXTURES, fixture),
    encoding: 'utf8',
    timeout: 240000
  })
  return { code: result.status ?? -1, stdout: result.stdout }
}

beforeAll(() => {
  exe = join(mkdtempSync(join(tmpdir(), 'partom-int-')), 'partom')
  /** Compile result. */
  const build = spawnSync(
    'bun',
    [
      'build',
      '--compile',
      'src/entry/darwin-arm64.ts',
      '--external',
      'chromium-bidi/*',
      '--outfile',
      exe
    ],
    { cwd: ROOT, encoding: 'utf8' }
  )
  expect(build.status).toBe(0)
})

describe('stage-1 integration with the compiled executable', () => {
  it('extracts shadcn-style components with variants and pattern guesses', () => {
    const out = mkdtempSync(join(tmpdir(), 'partom-int-extract-'))
    expect(
      run('extract', [
        'extract',
        'button.tsx',
        'dialog.tsx',
        'tabs.tsx',
        'combobox.tsx',
        '--out',
        out
      ]).code
    ).toBe(0)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).components as {
      component: string
      pattern?: string
      variants: Record<string, string[]>
    }[]
    expect(
      Object.fromEntries(report.map((entry) => [entry.component, entry.pattern ?? null]))
    ).toEqual({
      Button: null,
      Dialog: 'dialog',
      Tabs: 'tabs',
      Combobox: 'combobox'
    })
    expect(report.find((entry) => entry.component === 'Button')?.variants.variant).toContain(
      'destructive'
    )
  })

  it('reports no error for the combobox, dialog and tabs application in a real browser (source CLI)', () => {
    const result = partom('shadcn-app', ['doctor', '--rendered', '--json'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      issues: [],
      rendered: [{ blueprintId: 'app', status: 'checked' }]
    })
  })

  it('detects a combobox implementation that breaks APG while the blueprint stays valid', () => {
    const result = partom('shadcn-app-broken', ['doctor', '--rendered', '--json'])
    expect(result.code).toBe(1)
    const issues = JSON.parse(result.stdout).issues as {
      address: string
      basis: string
      rule: string
    }[]
    expect(issues.length).toBeGreaterThan(0)
    expect(
      issues.every(
        (issue) =>
          issue.rule === 'rendered.pattern' &&
          issue.address === 'p/fruit' &&
          issue.basis === 'APG combobox'
      )
    ).toBe(true)
  })
})
