import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

/** Documentation executes package exports from this checkout's installed root dependencies. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
/** Only the two approved migration sections are executable documentation oracles here. */
const guides = [
  { path: 'packages/log-host/USEGUIDE.md', heading: /^## 从 `@migaia\/logger` 迁移$/gm },
  { path: 'packages/log-host/USEGUIDE.en.md', heading: /^## Migrating from `@migaia\/logger`$/gm }
]
/** The existing repository extractor owns fences and doc-test metadata. */
const extractorUrl = pathToFileURL(resolve(repositoryRoot, 'scripts/docs-examples.mjs')).href
/** A child imports the maintained JavaScript helper without adding a second Markdown parser. */
const extractionProgram = `
import { readFileSync } from 'node:fs'
import { extractExamples } from ${JSON.stringify(extractorUrl)}
const input = JSON.parse(readFileSync(0, 'utf8'))
process.stdout.write(JSON.stringify(extractExamples(input.markdown, input.path)))
`
/** This test needs only the existing extractor's public result fields. */
type IExample = { section: string; code: string; mode: string; errors: string[] }

/** Verify migration containment, then run exactly its two offline examples with native TS stdin. */
function verifyGuide(guide: (typeof guides)[number]): void {
  /** Read the authored guide without rewriting imports or constructing generated source files. */
  const markdown = readFileSync(resolve(repositoryRoot, guide.path), 'utf8')
  /** One heading also ensures old package names cannot spread across migration sections. */
  const headings = [...markdown.matchAll(guide.heading)]
  expect(headings).toHaveLength(1)
  /** The authored heading is captured rather than embedding an old package import in test data. */
  const heading = headings[0]![0]
  /** Exact splitting retains the single migration boundary without parsing code fences again. */
  const parts = markdown.split(heading)
  expect(parts).toHaveLength(2)
  /** A future following section must not inherit the migration-only name allowance. */
  const nextSection = parts[1]!.search(/^## /m)
  /** Everything outside this single section remains subject to old-name removal. */
  const outside = parts[0]! + (nextSection < 0 ? '' : parts[1]!.slice(nextSection))
  expect(outside).not.toMatch(/@migaia\/logger|packages\/logger/)
  /** Importing extractExamples has no CLI-runner side effects. */
  const extraction = spawnSync(process.execPath, ['--input-type=module', '-e', extractionProgram], {
    cwd: repositoryRoot,
    input: JSON.stringify({ markdown, path: guide.path }),
    encoding: 'utf8',
    timeout: 10000
  })
  expect(extraction.error).toBeUndefined()
  expect(extraction.status, extraction.stderr).toBe(0)
  /** Selection follows extractor-owned section identity rather than a copied fence parser. */
  const examples = (JSON.parse(extraction.stdout) as IExample[]).filter(
    (example) => example.section.endsWith(heading.slice(3)) && example.mode === 'run'
  )
  expect(examples).toHaveLength(2)
  for (const example of examples) {
    expect(example.errors).toEqual([])
    /** Native type stripping runs only selected snippets against built public package entries. */
    const execution = spawnSync(process.execPath, ['--input-type=module-typescript', '-'], {
      cwd: repositoryRoot,
      input: example.code,
      encoding: 'utf8',
      timeout: 10000
    })
    expect(execution.error).toBeUndefined()
    expect(execution.status, execution.stderr).toBe(0)
  }
}

for (const guide of guides)
  it(`runs the two contained migration examples in ${guide.path}`, () => verifyGuide(guide))
