import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TempProject } from './import-support.ts'
import { BUN } from './run.ts'

/** Projects to remove after the file. */
const projects: TempProject[] = []

afterAll(() => {
  for (const project of projects) project.remove()
})

/** Hostile OpenAPI document: path-like names, colliding names, prototype refs, injection text. */
const HOSTILE = {
  openapi: '3.0.3',
  paths: {
    '/things': {
      get: {
        operationId: 'x y',
        tags: ['../../src/index'],
        responses: {
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/constructor' } }
            }
          }
        }
      }
    },
    '/order': {
      get: { operationId: 'order', tags: ['orders'], responses: {} }
    }
  },
  components: {
    schemas: {
      'a-b': { type: 'object', properties: { id: { type: 'string' } } },
      '../../evil': { type: 'object', properties: { id: { type: 'string' } } },
      OrderLine: { type: 'object', properties: { id: { type: 'string' } } },
      'order-line': { type: 'object', properties: { id: { type: 'string' } } },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          '}; process.exit(9); ({': { type: 'string', enum: ['*/ process.exit(9) /*'] }
        }
      }
    }
  }
}

/** Every file under a directory, relative. */
function listFiles(dir: string, prefix = ''): string[] {
  /** Collected paths. */
  const found: string[] = []
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    /** Relative path. */
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) found.push(...listFiles(dir, path))
    else found.push(path)
  }
  return found
}

describe('partom import safety', () => {
  it('keeps every file inside --out and every hostile string inside a literal', () => {
    const project = new TempProject('import-hostile-')
    projects.push(project)
    project.write('hostile.json', JSON.stringify(HOSTILE))
    /** Import result. */
    const result = project.partom(['import', 'hostile.json', '--out', 'src/api'])
    expect(result.code).toBe(0)
    /** Report. */
    const report = JSON.parse(result.stdout) as {
      readonly written: string[]
      readonly uncertain: { readonly pointer: string; readonly reason: string }[]
    }
    expect(listFiles(project.dir).sort()).toEqual(
      [
        'hostile.json',
        'tsconfig.json',
        ...report.written.map((path) => join('src/api', path))
      ].sort()
    )
    expect(report.written).toContain('resources/src-index.ts')
    expect(report.written).toContain('models/evil.ts')
    /** Collision reasons. */
    const reasons = report.uncertain.map((item) => item.reason)
    expect(reasons.filter((reason) => reason === 'name-collision')).toHaveLength(2)
    expect(reasons).toContain('missing-ref')
    expect(report.written).toContain('models/order-line.ts')
    expect(report.written).toContain('models/order-line-2.ts')
    expect(readFileSync(join(project.dir, 'src/api/resources/orders.ts'), 'utf8')).toContain(
      '"order-2@1"'
    )
    expect(project.tsc()).toMatchObject({ code: 0 })
    project.write(
      'load.ts',
      "import { apiPlugin } from './src/api/index.ts'\nconsole.log(apiPlugin.name)\n"
    )
    /** Loading the generated modules. */
    const load = project.bun('load.ts')
    expect(load).toMatchObject({ code: 0, stdout: 'api\n' })
  })

  it('rejects documents that are not OpenAPI 3.x and projects without zod', () => {
    const project = new TempProject('import-invalid-')
    projects.push(project)
    project.write('swagger.json', JSON.stringify({ swagger: '2.0', openapi: '2.0', paths: {} }))
    /** Result for the old document. */
    const old = project.partom(['import', 'swagger.json', '--out', 'src/api'])
    expect(old.code).toBe(2)
    expect(old.stderr).toContain('IMPORT_INVALID')

    /** A project outside the repository, where zod cannot be resolved. */
    const outside = mkdtempSync(join(tmpdir(), 'partom-import-'))
    try {
      writeFileSync(join(outside, 'api.json'), JSON.stringify(HOSTILE))
      /** Result without zod. */
      const missing = spawnSync(
        BUN,
        [join(import.meta.dirname, '..', 'src', 'cli.ts'), 'import', 'api.json', '--out', 'out'],
        { cwd: outside, encoding: 'utf8' }
      )
      expect(missing.status).toBe(2)
      expect(missing.stderr).toContain('PROJECT_DEPENDENCY_MISSING')
      expect(existsSync(join(outside, 'out'))).toBe(false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
