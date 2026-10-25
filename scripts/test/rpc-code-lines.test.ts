/**
 * Enforce the core SDD's eight-package production budget using parsed comment spans. Reports
 * distinguish code, comment-only and blank lines; mixed lines count as code.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync } from 'oxc-parser'

/** The immutable baseline is 59,454 code lines; the authorized 65% ceiling is rounded down. */
const maximumCodeLines = 38_645
/** These are exactly the eight production packages named by R11, without integration stubs. */
const packages = [
  'rpc-host',
  'rpc-contract',
  'rpc-plugin-process',
  'rpc-plugin-thread',
  'rpc-plugin-browser',
  'rpc-plugin-coroutines',
  'rpc-plugin-pool',
  'rpc-plugin-devtools'
] as const
/** Mutually exclusive line kinds preserve the audit's original accounting convention. */
type ILineCounts = {
  files: number
  physical: number
  code: number
  commentOnly: number
  blank: number
}

/** Remove only parser-identified comments; strings and regular expressions retain their bytes. */
export function countRpcCodeLines(path: string, source: string): ILineCounts {
  /** Oxc's spans follow the same source units as slicing this complete maintained source. */
  const parsed = parseSync(path, source)
  assert.equal(parsed.errors.length, 0, `Cannot count unparseable source: ${path}`)
  /** Slices are joined once, avoiding repeated concatenation of a growing source prefix. */
  const chunks: string[] = []
  /** The cursor owns the next source byte not yet copied into the comment-free view. */
  let cursor = 0
  for (const comment of parsed.comments) {
    /** Line endings stay in place so each code line maps to its original physical line. */
    const original = source.slice(comment.start, comment.end)
    assert.ok(original.startsWith('//') || original.startsWith('/*'), path)
    chunks.push(source.slice(cursor, comment.start), original.replace(/[^\r\n]/g, ' '))
    cursor = comment.end
  }
  chunks.push(source.slice(cursor))
  /** A terminal newline ends the final line; it does not add a second empty line. */
  const originalLines = source.split('\n')
  /** Every non-whitespace character left after parsed comments identifies a real code line. */
  const codeLines = chunks.join('').split('\n')
  if (source.endsWith('\n')) {
    originalLines.pop()
    codeLines.pop()
  }
  /** Each file contributes to exactly one aggregate and every physical line to exactly one kind. */
  const result: ILineCounts = {
    files: 1,
    physical: originalLines.length,
    code: 0,
    commentOnly: 0,
    blank: 0
  }
  for (let index = 0; index < originalLines.length; index++) {
    if (!originalLines[index]!.trim()) result.blank += 1
    else if (!codeLines[index]!.trim()) result.commentOnly += 1
    else result.code += 1
  }
  return result
}

/** Visit maintained files once; generated dist, README and foreign-language fixtures stay out. */
function measureDirectory(directory: string): ILineCounts {
  /** A cursor-free stack visits directories without shifting or copying a growing file prefix. */
  const remaining = [directory]
  /** Counts are accumulated directly instead of retaining another copy of every source string. */
  const total: ILineCounts = { files: 0, physical: 0, code: 0, commentOnly: 0, blank: 0 }
  while (remaining.length) {
    for (const entry of readdirSync(remaining.pop()!, { withFileTypes: true })) {
      /** Only source/test files under the explicit owning package directory enter this report. */
      const path = join(entry.parentPath, entry.name)
      if (entry.isDirectory()) remaining.push(path)
      else if (entry.isFile() && /\.(?:ts|tsx|mts|mjs)$/.test(entry.name)) {
        /** Each actual file uses the same parsed-comment classification as the historical audit. */
        const counts = countRpcCodeLines(path, readFileSync(path, 'utf8'))
        for (const key of Object.keys(total) as (keyof ILineCounts)[]) total[key] += counts[key]
      }
    }
  }
  return total
}

test('eight RPC production packages fit the core code-line budget', () => {
  /** Per-package source and test counts support the required three-column delivery comparison. */
  const measured = packages.map((name) => ({
    package: name,
    source: measureDirectory(`packages/${name}/src`),
    test: measureDirectory(`packages/${name}/test`)
  }))
  /** Integration has no production budget, but its maintained test code is reported explicitly. */
  const integrationTests = measureDirectory('packages/rpc-integration/test')
  /** Only the eight source directories contribute to the hard production ceiling. */
  const codeLines = measured.reduce((total, item) => total + item.source.code, 0)
  /** A caller may retain the raw observed RED baseline without changing the actual assertion. */
  const report = process.env.RPC_CODE_LINES_REPORT
  if (report)
    writeFileSync(
      report,
      `${JSON.stringify(
        {
          date: new Date().toISOString(),
          method: 'Oxc parsed comment spans; mixed lines count as code',
          maximumCodeLines,
          codeLines,
          packages: measured,
          integrationTests
        },
        null,
        2
      )}\n`
    )
  console.log(JSON.stringify({ maximumCodeLines, codeLines, packages: measured }))
  assert.ok(codeLines <= maximumCodeLines, `${codeLines} exceeds ${maximumCodeLines}`)
})
