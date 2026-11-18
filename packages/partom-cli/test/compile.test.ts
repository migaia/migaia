import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }
import { FIXTURES } from './run.ts'

/** Package root. */
const ROOT = join(import.meta.dirname, '..')

describe('single executable', () => {
  it('runs without node_modules and still loads project packages from the project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'partom-exe-'))
    const build = spawnSync(
      'bun',
      [
        'build',
        '--compile',
        'src/entry/darwin-arm64.ts',
        '--external',
        'chromium-bidi/*',
        '--outfile',
        join(dir, 'partom-build')
      ],
      { cwd: ROOT, encoding: 'utf8' }
    )
    expect(build.status).toBe(0)
    const exe = join(dir, 'partom')
    copyFileSync(join(dir, 'partom-build'), exe)
    expect(spawnSync(exe, ['--version'], { cwd: dir, encoding: 'utf8' }).stdout.trim()).toBe(
      '0.0.1'
    )
    const out = join(dir, 'drafts')
    const extracted = spawnSync(
      exe,
      ['extract', join(FIXTURES, 'extract', 'button.tsx'), '--out', out],
      { cwd: dir, encoding: 'utf8' }
    )
    expect(extracted.status).toBe(0)
    const draft = readFileSync(join(out, 'button.part.ts'), 'utf8')
    for (const value of ['default', 'destructive', 'outline', 'ghost', 'sm', 'lg', 'icon'])
      expect(draft).toContain(JSON.stringify(value))
    const doctor = spawnSync(exe, ['doctor'], { cwd: dir, encoding: 'utf8' })
    expect(doctor.status).toBe(2)
    expect(JSON.parse(doctor.stderr.trim()).error.code).toBe('PROJECT_DEPENDENCY_MISSING')
  })
})

describe('package shape', () => {
  it('exposes the partom bin and bundles only the parser and browser driver', () => {
    expect(manifest.bin).toEqual({ partom: './src/cli.ts' })
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['oxc-parser', 'playwright-core'])
  })
})
