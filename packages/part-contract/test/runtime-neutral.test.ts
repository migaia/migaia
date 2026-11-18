import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Source root of this package. */
const SOURCE = join(import.meta.dirname, '..', 'src')
/** Host globals a runtime-neutral contract must not reference. */
const HOST_GLOBALS = /\b(document|window|process|Bun|Deno)(\.[A-Za-z_]|\[)/

/** Lists every TypeScript source file under a directory. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(directory, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(directory, entry.name)]
        : []
  )
}

describe('runtime neutrality', () => {
  it('references no DOM, Node, Bun or Deno globals', () => {
    const offenders = sourceFiles(SOURCE).filter((file) =>
      HOST_GLOBALS.test(readFileSync(file, 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})
