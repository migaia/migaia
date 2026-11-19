import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync } from 'oxc-parser'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  LandingProject,
  lastJson,
  nodesOf,
  type ITestNode,
  type IUsageReport
} from './landing-support.ts'

/** Project shared by the usage cases. */
let project: LandingProject

/** Runs the usage conversion of pages into `src/blueprints`. */
function convert(pages: readonly string[]): { code: number; report: IUsageReport } {
  /** Process result. */
  const result = project.partom([
    'extract',
    '--usage',
    ...pages,
    '--parts',
    'src/parts',
    '--out',
    'src/blueprints'
  ])
  return { code: result.code, report: lastJson<IUsageReport>(result) }
}

/** The generated orders-page blueprint root. */
function ordersRoot(): ITestNode {
  return (
    JSON.parse(project.read('src/blueprints/orders-page.blueprint.json')) as { root: ITestNode }
  ).root
}

/** The node with an id. */
function node(root: ITestNode, id: string): ITestNode {
  return nodesOf(root).find((entry) => entry.id === id) as ITestNode
}

beforeAll(() => {
  project = new LandingProject('landing-usage-')
  expect(project.partom(['extract', ...project.componentFiles(), '--out', 'src/parts']).code).toBe(
    0
  )
})

afterAll(() => project.remove())

describe('partom extract --usage', () => {
  it('converts the orders page into a blueprint, seed, drafts and one black box that pass doctor', () => {
    /** First conversion. */
    const { code, report } = convert(['pages/orders-page.tsx'])
    expect(code).toBe(0)
    expect(report.failed).toEqual([])
    expect(report.pages).toEqual([
      {
        file: project.path('pages/orders-page.tsx'),
        blueprint: 'orders-page',
        seeds: { 'page.status': 'open', 'page.orders': [] }
      }
    ])

    /** Doctor of the conversion with every generated plugin installed. */
    const doctor = project.partom(['doctor', '--json', '--config', 'usage.config.ts'])
    expect(doctor.code).toBe(0)
    expect(
      lastJson<{ issues: { severity: string }[] }>(doctor).issues.filter(
        (issue) => issue.severity === 'error'
      )
    ).toEqual([])

    /** Blueprint root. */
    const root = ordersRoot()
    /** Status filter. */
    const select = node(root, 'select-0')
    expect(select.tag).toBe('select@1')
    expect(select.facets?.props?.value).toEqual({ $state: 'page.status' })
    expect(select.facets?.events).toBeUndefined()

    /** Seeded state after installing the seed plugin. */
    project.write(
      'seed-check.ts',
      [
        "import { createPartHost } from '@migaia/part-host'",
        "import seed from './src/blueprints/orders-page.seed.ts'",
        'const host = await createPartHost({ plugins: [seed] })',
        "console.log(JSON.stringify(host.state.read('page.status')))",
        'await host.dispose()'
      ].join('\n')
    )
    expect(project.bun('seed-check.ts')).toMatchObject({ code: 0, stdout: '"open"\n' })

    /** Orders table. */
    const table = node(root, 'data-table-0')
    expect(table.tag).toBe('data-table@1')
    expect(table.facets?.props?.columns).toEqual([
      { key: 'id', header: 'Order' },
      { key: 'customer', header: 'Customer' }
    ])
    expect(table.template?.rowKey).toBe('id')
    expect(table.template?.node.tag).toBe('table-row@1')
    expect(
      table.template?.node.children?.map((cell) => [cell.tag, cell.facets?.props?.children])
    ).toEqual([
      ['table-cell@1', { $row: 'id' }],
      ['table-cell@1', { $row: 'customer' }],
      ['table-cell@1', { $row: 'status' }]
    ])
    /** Reasons reported for the table line. */
    const reasons = report.uncertain.map((item) => item.reason)
    expect(reasons).toEqual(expect.arrayContaining(['cell-dropped', 'bind-resource']))
    expect(reasons).not.toContain('row-key-guessed')

    expect(node(root, 'input-0').facets?.props?.value).toEqual({ $state: 'page.form.customer' })
    expect(node(root, 'form-message-0').facets?.props?.message).toEqual({
      $state: 'page.form-errors.customer'
    })
    expect(node(root, 'form-0').facets?.events).toEqual({
      'submit.prevent': { handler: 'orders-page.onSubmit@1' }
    })

    /** Effects module text. */
    const effects = project.read('src/blueprints/effects/orders-page.ts')
    /** Lines containing the original handler code. */
    const lines = effects.split('\n').filter((line) => line.includes("fetch('/api/orders'"))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^export const onSubmitSource = "/)
    project.write(
      'draft-check.ts',
      [
        "import { onSubmitEffect } from './src/blueprints/effects/orders-page.ts'",
        'try { await onSubmitEffect.run({} as never, {} as never); console.log("ran") } catch (error) { console.log((error as Error).message) }'
      ].join('\n')
    )
    expect(project.bun('draft-check.ts').stdout.trim()).toBe(
      'partom: this effect was generated from page code and needs review'
    )

    expect(project.read('src/blueprints/blackbox/orders-page-1.tsx')).toContain(
      '<Chart key={summary.label}'
    )
    expect(nodesOf(root).filter((entry) => entry.tag === 'orders-page-blackbox-1@1')).toHaveLength(
      1
    )
    // Elements by hand: main, h1, p, Select, SelectTrigger, SelectValue, SelectContent, three
    // SelectItem, DataTable, section and Chart (one black box), form, FormItem, FormLabel,
    // FormControl, Input, FormMessage, Button = 20; Form and FormField are structural wrappers.
    // Not clean: DataTable (uncertain items), section and Chart (black box), form (effect draft).
    expect(report.summary).toEqual({ usageNodes: 20, usageConverted: 16, blackboxes: 1 })
  })

  it('leaves unchanged files alone and never overwrites an edited one', () => {
    /** Second conversion without changes. */
    const same = convert(['pages/orders-page.tsx']).report
    expect(same.written).toEqual([])
    expect(same.unchanged.sort()).toEqual([
      'blackbox/orders-page-1.tsx',
      'effects/orders-page.ts',
      'orders-page.blueprint.json',
      'orders-page.seed.ts',
      'parts/html.ts'
    ])
    /** Edited effects text. */
    const edited = `${project.read('src/blueprints/effects/orders-page.ts')}// reviewed\n`
    project.write('src/blueprints/effects/orders-page.ts', edited)
    expect(convert(['pages/orders-page.tsx']).report.takenOver).toEqual(['effects/orders-page.ts'])
    expect(project.read('src/blueprints/effects/orders-page.ts')).toBe(edited)
  })

  it('keeps hostile page text inside string literals and refuses a missing component report', () => {
    /** Handler source with comment terminators, a line comment and line separators. */
    const handler = `function handleClick() {\n    const note = '*/   process.exit(9)   process.exit(9)'\n    // x\n    console.log(note)\n  }`
    mkdirSync(project.path('evil'), { recursive: true })
    project.write(
      'evil/evil-page.tsx',
      [
        "import { Button } from '../components/ui/button.tsx'",
        '',
        "const prefix = 'Panel: '",
        'const registry = { Panel: (props: { label: string }) => <div>{prefix + props.label}</div> }',
        '',
        'export function EvilPage() {',
        `  ${handler}`,
        '',
        '  return (',
        '    <main>',
        `      <Button title='"}); process.exit(9); ({"'>Go</Button>`,
        "      <Button onClick={handleClick}>Run</Button>{' '}",
        '      <>',
        '        <Button>Nested</Button>',
        '      </>',
        '      <registry.Panel label="x" />',
        '    </main>',
        '  )',
        '}',
        ''
      ].join('\n')
    )
    /** Conversion of the hostile page. */
    const { code, report } = convert(['evil/evil-page.tsx'])
    expect(code).toBe(0)
    // Only the dynamic element is a black box: blank spacing and a nested fragment of converted
    // elements keep `main` convertible, and the box copies `prefix` because `registry` reads it.
    expect(report.summary.blackboxes).toBe(1)
    expect(project.read('src/blueprints/blackbox/evil-page-1.tsx')).toContain(
      "const prefix = 'Panel: '"
    )
    /** Strict type check of everything generated. */
    project.write(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2024',
          module: 'esnext',
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          jsx: 'react-jsx',
          lib: ['ES2024', 'DOM'],
          types: []
        },
        include: ['src/blueprints']
      })
    )
    /** Type-check result. */
    const checked = project.tsc()
    expect(checked.stdout).toBe('')
    expect(checked.code).toBe(0)
    project.write(
      'evil-check.ts',
      [
        "import { handleClickSource } from './src/blueprints/effects/evil-page.ts'",
        'console.log(JSON.stringify(handleClickSource))'
      ].join('\n')
    )
    /** Import of the generated effects. */
    const imported = project.bun('evil-check.ts')
    expect(imported.code).toBe(0)
    expect(JSON.parse(imported.stdout) as string).toBe(handler)
    expect(
      JSON.stringify(JSON.parse(project.read('src/blueprints/evil-page.blueprint.json')))
    ).toContain('process.exit(9)')
    for (const file of [
      'effects/evil-page.ts',
      'evil-page.seed.ts',
      'blackbox/evil-page-1.tsx',
      'parts/html.ts'
    ])
      expect(processExitCalls(join(project.dir, 'src/blueprints', file))).toBe(0)

    /** Run against an empty parts directory. */
    mkdirSync(project.path('empty-parts'), { recursive: true })
    /** Failure result. */
    const failed = project.partom([
      'extract',
      '--usage',
      'evil/evil-page.tsx',
      '--parts',
      'empty-parts',
      '--out',
      'other'
    ])
    expect(failed.code).toBe(2)
    expect((JSON.parse(failed.stderr.trim()) as { error: { code: string } }).error.code).toBe(
      'CONFIG_INVALID'
    )
  })
})

/** Number of `process.exit` member expressions in a file's syntax tree, outside string literals. */
function processExitCalls(file: string): number {
  /** Parsed program. */
  const program = parseSync(file, readFileSync(file, 'utf8')).program
  /** Matches found. */
  let count = 0
  /** Nodes left to visit. */
  const pending: unknown[] = [program]
  while (pending.length > 0) {
    /** Current value. */
    const value = pending.pop()
    if (typeof value !== 'object' || value === null) continue
    /** Node view. */
    const entry = value as Record<string, unknown>
    if (
      entry.type === 'MemberExpression' &&
      (entry.object as { name?: unknown } | undefined)?.name === 'process' &&
      (entry.property as { name?: unknown } | undefined)?.name === 'exit'
    )
      count += 1
    for (const child of Object.values(entry))
      if (typeof child === 'object' && child !== null) pending.push(child)
  }
  return count
}
