import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/** Package directory. */
const PACKAGE = join(import.meta.dirname, '..')
/** Fixture project. */
const FIXTURE = join(PACKAGE, 'test', 'fixtures', 'remote-modules')
/** Remote-module root of the fixture. */
const ROOT = join(FIXTURE, 'remote')
/** Directories to remove after each test. */
const temporary: string[] = []

/** New temporary directory outside the repository. */
function tempDir(): string {
  /** Created directory. */
  const dir = mkdtempSync(join(tmpdir(), 'partom-remote-'))
  temporary.push(dir)
  return dir
}

/** Runs `partom remote build` from source and parses its JSON output. */
function build(
  entries: string[],
  out: string,
  options: { root?: string; project?: string; env?: Record<string, string> } = {}
) {
  /** Child result. */
  const result = spawnSync(
    'bun',
    [
      join(PACKAGE, 'src', 'cli.ts'),
      'remote',
      'build',
      ...entries,
      '--out',
      out,
      '--root',
      options.root ?? ROOT,
      '--project',
      options.project ?? FIXTURE
    ],
    { encoding: 'utf8', env: { ...process.env, ...options.env }, timeout: 120000 }
  )
  /** Parsed stdout, when JSON. */
  let json:
    | {
        modules: { name: string; id: string; url: string; integrity: string; exports: unknown[] }[]
        failed: string[]
        issues: { path: string; rule: string; basis?: string }[]
      }
    | undefined
  try {
    json = JSON.parse(result.stdout)
  } catch {
    json = undefined
  }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr }
}

/** Fixture entry path. */
const entry = (name: string): string => join(ROOT, name)

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('partom remote build', () => {
  it('builds reproducible modules with hashes and shims instead of bare imports', () => {
    /** Output directory. */
    const out = tempDir()
    /** Entries in order. */
    const entries = ['effects/notify.ts', 'enhancers/label.ts', 'derives/total.ts'].map(entry)
    /** First run. */
    const first = build(entries, out)
    expect(first.status).toBe(0)
    expect(first.json?.modules.map((module) => [module.name, module.exports])).toEqual([
      ['effects/notify.ts', [{ id: 'notify@1', kind: 'effect' }]],
      ['enhancers/label.ts', [{ id: 'label@1', kind: 'enhancer' }]],
      ['derives/total.ts', [{ id: 'total@1', kind: 'derive' }]]
    ])
    expect(JSON.parse(readFileSync(join(out, 'modules.json'), 'utf8'))).toEqual(first.json?.modules)
    for (const module of first.json?.modules ?? []) {
      expect(module.url).toMatch(/^m\/[A-Za-z0-9_-]+\.js$/)
      /** Built bytes. */
      const bytes = readFileSync(join(out, module.url))
      expect(module.integrity).toBe(`sha384-${createHash('sha384').update(bytes).digest('base64')}`)
      expect(module.id).toBe(`sha256-${createHash('sha256').update(bytes).digest('base64url')}`)
      /** Module text. */
      const text = bytes.toString('utf8')
      expect(text).not.toMatch(/from\s+["']@migaia\/part-host["']/)
      expect(text).toContain('Symbol.for("migaia.part.shared")')
      expect(text).not.toContain('class PartCatalog')
    }
    /** Second run. */
    const second = build(entries, tempDir())
    expect(second.json?.modules).toEqual(first.json?.modules)
  })

  it('reports every rule, type and purity problem at its line and still builds valid entries', () => {
    /** Run over the problem modules plus one valid one. */
    const run = build(
      [
        'bad-state.ts',
        'bad-import.ts',
        'bad-window.ts',
        'bad-process.ts',
        'bad-dynamic.ts',
        'bad-types.ts',
        'bad-impure.ts',
        'derives/total.ts'
      ].map(entry),
      tempDir()
    )
    expect(run.status).toBe(1)
    /** `path rule` pairs. */
    const found = run.json?.issues.map((issue) => `${issue.path} ${issue.rule}`) ?? []
    expect(found).toEqual(
      expect.arrayContaining([
        'bad-state.ts:3:1 remote.module-state',
        'bad-import.ts:1:1 remote.import',
        'bad-import.ts:2:1 remote.import',
        'bad-window.ts:6:10 remote.global',
        'bad-process.ts:6:10 remote.global',
        'bad-dynamic.ts:6:11 remote.import',
        'bad-types.ts:3:7 remote.types',
        'bad-impure.ts remote.impure'
      ])
    )
    expect(run.json?.failed).toHaveLength(7)
    expect(run.json?.modules.map((module) => module.name)).toEqual(['derives/total.ts'])
    expect(existsSync(join(FIXTURE, '.partom-tmp'))).toBe(false)
  })

  it('rejects entries outside the root, needs TypeScript, times out and keeps tokens out', () => {
    /** Entry outside the root but inside the project. */
    const stray = build([join(FIXTURE, 'outside', 'stray.ts')], tempDir())
    expect(stray.status).toBe(1)
    expect(stray.json?.issues[0]?.rule).toBe('REMOTE_ENTRY_OUTSIDE')
    /** Root outside the project. */
    const outsideRoot = build([entry('derives/total.ts')], tempDir(), {
      project: join(FIXTURE, 'outside')
    })
    expect(outsideRoot.json?.issues[0]?.rule).toBe('REMOTE_ENTRY_OUTSIDE')
    /** Project without TypeScript, outside the repository. */
    const bare = tempDir()
    writeFileSync(
      join(bare, 'module.ts'),
      "export default { descriptor: { kind: 'effect', id: 'x@1' } }\n"
    )
    /** Run in the bare project. */
    const missing = build([join(bare, 'module.ts')], tempDir(), { root: bare, project: bare })
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('PROJECT_DEPENDENCY_MISSING')
    /** Hanging and leaking effects with a token in the parent environment. */
    const contract = build([entry('hang.ts'), entry('leak.ts')], tempDir(), {
      env: { PARTOM_TOKEN: 'sentinel-123' }
    })
    expect(contract.json?.issues.map((issue) => issue.rule)).toEqual([
      'remote.contract-timeout',
      'remote.contract-failed'
    ])
    expect(contract.stdout + contract.stderr).not.toContain('sentinel-123')
    expect(existsSync(join(FIXTURE, '.partom-tmp'))).toBe(false)
  })
})
