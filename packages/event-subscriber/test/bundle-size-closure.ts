import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

/** Measures the runtime code reachable through the root entry's static chunk imports. */
export function measureRootClosure(packageRoot: string): {
  readonly bytes: number
  readonly indexOnlyBytes: number
  readonly files: readonly string[]
} {
  /** Each emitted chunk contributes to the budget exactly once. */
  const visited = new Set<string>()
  /** Postorder keeps dependencies before the entry, matching the frozen baseline. */
  const buffers: Buffer[] = []

  /** Adds a chunk and its local static imports to the measured runtime closure. */
  const visit = (filePath: string): void => {
    if (visited.has(filePath)) return
    visited.add(filePath)
    /** Emitted JS is read as text so its static imports can be followed. */
    const source = readFileSync(filePath, 'utf8')
    for (const match of source.matchAll(/\bfrom\s+['"](\.\/[^'"]+\.js)['"]/g)) {
      visit(resolve(dirname(filePath), match[1]!))
    }
    buffers.push(Buffer.from(source))
  }

  /** The package root is the only entry covered by this budget. */
  const entry = resolve(packageRoot, 'dist/index.js')
  visit(entry)
  return {
    bytes: gzipSync(Buffer.concat(buffers)).byteLength,
    indexOnlyBytes: gzipSync(readFileSync(entry)).byteLength,
    files: [...visited]
  }
}
