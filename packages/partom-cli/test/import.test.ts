import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TempProject } from './import-support.ts'
import { FIXTURES } from './run.ts'

/** OpenAPI fixture. */
const SPEC = join(FIXTURES, 'openapi', 'orders.yaml')
/** Project shared by the cases. */
let project: TempProject

/** Report printed by `partom import`. */
type IReport = {
  readonly models: number
  readonly resources: number
  readonly commands: number
  readonly written: string[]
  readonly unchanged: string[]
  readonly takenOver: string[]
  readonly stale: string[]
  readonly uncertain: { readonly pointer: string; readonly reason: string }[]
}

/** Runs the import into `src/api` and parses the report. */
function runImport(spec = 'orders.yaml'): IReport {
  /** Process result. */
  const result = project.partom(['import', spec, '--out', 'src/api'])
  expect(result.stderr).toBe('')
  expect(result.code).toBe(0)
  return JSON.parse(result.stdout) as IReport
}

beforeAll(() => {
  project = new TempProject('import-run-')
  copyFileSync(SPEC, join(project.dir, 'orders.yaml'))
  copyFileSync(join(FIXTURES, 'openapi', 'check.ts'), join(project.dir, 'check.ts'))
})

afterAll(() => project.remove())

describe('partom import', () => {
  it('generates models, resources and commands that load, validate and invalidate', () => {
    /** Report of the first import. */
    const report = runImport()
    expect([report.models, report.resources, report.commands]).toEqual([2, 1, 2])
    expect(report.uncertain).toHaveLength(4)
    expect(report.uncertain).toEqual(
      expect.arrayContaining([
        { pointer: '/components/schemas/OrderLine', reason: 'key-guessed' },
        { pointer: '/components/schemas/Note', reason: 'key-missing' },
        {
          pointer: '/components/schemas/Order/properties/reference/pattern',
          reason: 'keyword-unsupported'
        },
        { pointer: '/components/schemas/Order/properties/external', reason: 'external-ref' }
      ])
    )
    expect(project.tsc()).toMatchObject({ code: 0 })
    /** Output of the check script. */
    const check = project.bun('check.ts')
    expect(check.stderr).toBe('')
    expect(JSON.parse(check.stdout)).toEqual({
      invalid: { ok: false, issues: [expect.objectContaining({ path: 'customer' })] },
      key: ['id'],
      createdAt: { format: 'datetime' },
      requests: ['GET /orders?status=open', 'DELETE /orders/a%2Fb', 'GET /orders?status=open'],
      status: 'empty'
    })
  })

  it('leaves edited files alone, reports stale files and rewrites untouched ones', () => {
    /** Resource file path. */
    const resources = join(project.dir, 'src/api/resources/orders.ts')
    /** Modification time before re-import. */
    const before = statSync(resources).mtimeMs
    /** Second import without changes. */
    const same = runImport()
    expect(same.written).toEqual([])
    expect(same.unchanged).toContain('resources/orders.ts')
    expect(statSync(resources).mtimeMs).toBe(before)

    /** Generated text. */
    const original = readFileSync(resources, 'utf8')
    writeFileSync(resources, original.replace('export const', '// edited\nexport const'))
    expect(runImport().takenOver).toEqual(['resources/orders.ts'])
    expect(readFileSync(resources, 'utf8')).toContain('// edited')

    writeFileSync(resources, original)
    /** Document without OrderLine. */
    const spec = readFileSync(SPEC, 'utf8').replace(/ {4}OrderLine:\n(?: {6}.*\n)+/, '')
    project.write('trimmed.yaml', spec)
    /** Report after removing a model. */
    const trimmed = runImport('trimmed.yaml')
    expect(trimmed.unchanged).toContain('resources/orders.ts')
    expect(trimmed.stale).toEqual(['models/order-line.ts'])
    expect(existsSync(join(project.dir, 'src/api/models/order-line.ts'))).toBe(true)

    project.write('renamed.yaml', readFileSync(SPEC, 'utf8').replace('name: status', 'name: state'))
    expect(runImport('renamed.yaml').written).toContain('resources/orders.ts')
  })
})
