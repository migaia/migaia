import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

/** This consumer needs authored source and admission diagnostics from the existing JS extractor. */
type IExample = Readonly<{
  mode: string
  line: number
  file?: string
  code: string
  errors: readonly string[]
}>
/** The existing group owner chooses resource membership and executable entry names. */
type IExampleGroup = Readonly<{
  directory: string
  examples: readonly IExample[]
  entries: readonly string[]
}>
/** The JavaScript tooling entry has JSDoc but emits no TypeScript declarations for package tests. */
const { extractExamples, groupExamples } = (await import(
  new URL('../../../../scripts/docs-examples.mjs', import.meta.url).href
)) as {
  extractExamples(markdown: string, path: string): readonly IExample[]
  groupExamples(examples: readonly IExample[]): readonly IExampleGroup[]
}

/** Documentation runs use the existing Bun toolchain and ordinary built package exports. */
const execute = promisify(execFile)
/** Scratch ownership stays inside the checkout's ignored dependency directory. */
const workspace = resolve(import.meta.dirname, '../../../..')
/** Both maintained languages must carry executable migration evidence. */
const documents = ['USEGUIDE.md', 'USEGUIDE.en.md'] as const

it.each(documents)(
  'executes the maintained Host migration examples in %s',
  async (document) => {
    /** The existing extractor owns fence metadata and exact authored source locations. */
    const path = `packages/rpc-host/${document}`
    /** The migration section owns this acceptance rather than unrelated guide examples. */
    const markdown = await readFile(join(workspace, path), 'utf8')
    /** Language-specific headings remain authored prose, not a new extractor convention. */
    const heading = document === 'USEGUIDE.md' ? '## 从旧包迁移' : '## Migrating from old packages'
    /** Preserve original source line numbers when selecting the existing extractor's results. */
    const start = markdown.indexOf(heading)
    expect(start).toBeGreaterThanOrEqual(0)
    /** The next peer section ends this migration's scope. */
    const end = markdown.indexOf('\n## ', start + heading.length)
    /** Existing source positions identify runnable blocks within this section. */
    const firstLine = markdown.slice(0, start).split('\n').length
    /** A later guide section cannot contribute migration examples. */
    const lastLine = end < 0 ? Infinity : markdown.slice(0, end).split('\n').length
    /** Execute every block explicitly marked runnable inside the migration section. */
    const examples = extractExamples(markdown, path).filter(
      (example) => example.mode === 'run' && example.line >= firstLine && example.line <= lastLine
    )
    expect(examples.length).toBeGreaterThan(0)
    /** Existing grouping rules retain named modules and select only their declared entry. */
    const groups = groupExamples(examples)
    /** No package output, source, or existing node_modules link is changed. */
    const scratch = await mkdtemp(join(workspace, 'node_modules/.rpc-host-migration-'))
    try {
      await writeFile(join(scratch, 'package.json'), '{"type":"module"}\n')
      await mkdir(join(scratch, 'node_modules/@migaia'), { recursive: true })
      for (const name of ['rpc-host', 'rpc-contract', 'rpc-plugin-coroutines'])
        await symlink(
          join(workspace, 'packages', name),
          join(scratch, 'node_modules/@migaia', name)
        )
      for (const group of groups) {
        /** The group directory isolates authored declarations without rewriting their imports. */
        const directory = join(scratch, group.directory)
        await mkdir(directory)
        expect(group.entries.length).toBeGreaterThan(0)
        for (const example of group.examples) {
          expect(example.errors, `${path}:${example.line}`).toEqual([])
          /** Unnamed fences follow the same block filename convention as the existing runner. */
          const file = join(directory, example.file ?? `block-${example.line}.ts`)
          await mkdir(dirname(file), { recursive: true })
          await writeFile(file, `${example.code}\nexport {}\n`)
        }
        for (const entry of group.entries) {
          /** Bun executes real public Host/plugin/feature code with a finite example deadline. */
          const result = await execute('bun', [join(directory, entry)], {
            cwd: directory,
            timeout: 30_000,
            maxBuffer: 1024 * 1024
          })
          expect(result.stdout.trim(), `${path}: ${entry}`).toBe('42')
        }
      }
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  },
  60_000
)
