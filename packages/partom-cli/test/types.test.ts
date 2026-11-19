import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUN, FIXTURES } from './run.ts'

/** CLI source entry. */
const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts')
/** TypeScript compiler of this package. */
const TSC = join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsc')
/** Copy of the fixture project. */
let dir = ''

/** Runs a command in the copy. */
function run(
  command: string,
  args: readonly string[]
): { code: number; stdout: string; stderr: string } {
  /** Child result. */
  const result = spawnSync(command, [...args], { cwd: dir, encoding: 'utf8', timeout: 240000 })
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

/** Generated file path. */
function generated(): string {
  return join(dir, 'partom-env.d.ts')
}

beforeAll(() => {
  dir = mkdtempSync(join(FIXTURES, 'types-run-'))
  cpSync(join(FIXTURES, 'types-app'), dir, { recursive: true })
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('partom types', () => {
  it('generates a registry that types effects; without it any string is accepted', () => {
    expect(run(BUN, [CLI, 'types'])).toMatchObject({ code: 0 })
    /** Strict check of the effects against the generated file. */
    const typed = run(TSC, ['--noEmit', '-p', 'tsconfig.json'])
    expect(typed.stdout).toBe('')
    expect(typed.code).toBe(0)
    rmSync(generated())
    expect(run(TSC, ['--noEmit', '-p', 'tsconfig.plain.json'])).toMatchObject({ code: 0 })
  })

  it('is stable, checks freshness, keeps hand edits and leaves doctor issues unchanged', () => {
    expect(run(BUN, [CLI, 'types']).code).toBe(0)
    /** First text and time. */
    const first = readFileSync(generated(), 'utf8')
    /** Modification time after the first run. */
    const mtime = statSync(generated()).mtimeMs
    expect(run(BUN, [CLI, 'types']).code).toBe(0)
    expect(readFileSync(generated(), 'utf8')).toBe(first)
    expect(statSync(generated()).mtimeMs).toBe(mtime)
    expect(run(BUN, [CLI, 'types', '--check']).code).toBe(0)

    /** Blueprint text. */
    const blueprint = readFileSync(join(dir, 'page.blueprint.json'), 'utf8')
    writeFileSync(
      join(dir, 'page.blueprint.json'),
      blueprint.replace(
        '{ "tag": "dialog@1", "id": "dialog" }',
        '{ "tag": "dialog@1", "id": "dialog" }, { "tag": "box@1", "id": "extra" }'
      )
    )
    expect(run(BUN, [CLI, 'types', '--check']).code).toBe(1)
    expect(readFileSync(generated(), 'utf8')).toBe(first)
    writeFileSync(join(dir, 'page.blueprint.json'), blueprint)

    writeFileSync(generated(), `${first}// edited\n`)
    expect(run(BUN, [CLI, 'types']).code).toBe(1)
    expect(readFileSync(generated(), 'utf8')).toContain('// edited')
    rmSync(generated())

    /** Doctor issues without and with type data. */
    const plain = JSON.parse(run(BUN, [CLI, 'doctor', '--json']).stdout) as Record<string, unknown>
    const typed = JSON.parse(run(BUN, [CLI, 'doctor', '--json', '--types']).stdout) as Record<
      string,
      unknown
    >
    expect(typed.issues).toEqual(plain.issues)
    expect('types' in plain).toBe(false)
    expect(typed.types).toBeDefined()

    /** Config text. */
    const config = readFileSync(join(dir, 'partom.config.ts'), 'utf8')
    writeFileSync(
      join(dir, 'partom.config.ts'),
      config
        .replace(
          "import { z } from 'zod'",
          "import { defineModel } from '@migaia/part-contract'\nimport { z } from 'zod'"
        )
        .replace(
          'resources: [orders] })',
          "resources: [orders], models: [defineModel({ id: 'order@1', schema: z.object({ id: z.string() }), key: ['id'], relations: { lines: { target: 'line@1', cardinality: 'many', via: ['id'] } } })] })"
        )
    )
    /** Doctor result with the broken relation. */
    const broken = JSON.parse(run(BUN, [CLI, 'doctor', '--json']).stdout) as {
      issues: { rule: string }[]
    }
    expect(broken.issues.filter((issue) => issue.rule === 'model.relation-target')).toHaveLength(1)
    expect(run(BUN, [CLI, 'types']).code).toBe(0)
    writeFileSync(join(dir, 'partom.config.ts'), config)
  })
})
