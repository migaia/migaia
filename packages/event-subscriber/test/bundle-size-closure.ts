/** Owns static-chunk traversal for the existing gzip budget; it never builds or rewrites bundles. */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

/** Measures the runtime code reachable through the root entry's static chunk imports. */
export function measureRootClosure(packageRoot: string): {
  readonly bytes: number
  readonly indexOnlyBytes: number
  readonly files: readonly string[]
} {
  return new BundleClosure().measure(packageRoot)
}

/** Holds traversal state explicitly so each emitted chunk contributes exactly once. */
class BundleClosure {
  /** Each emitted chunk contributes to the budget exactly once. */
  readonly #visited = new Set<string>()
  /** Postorder keeps dependencies before the entry, matching the frozen baseline. */
  readonly #buffers: Buffer[] = []

  /** Adds a chunk and its local static imports to the measured runtime closure. */
  #visit(filePath: string): void {
    if (this.#visited.has(filePath)) return
    this.#visited.add(filePath)
    /** Emitted JS is read as text so its static imports can be followed. */
    const source = readFileSync(filePath, 'utf8')
    for (const match of source.matchAll(/\bfrom\s+['"](\.\/[^'"]+\.js)['"]/g)) {
      this.#visit(resolve(dirname(filePath), match[1]!))
    }
    this.#buffers.push(Buffer.from(source))
  }

  /** Measures the same dependency postorder and gzip input as the frozen baseline. */
  measure(packageRoot: string): ReturnType<typeof measureRootClosure> {
    /** The package root is the only entry covered by this budget. */
    const entry = resolve(packageRoot, 'dist/index.js')
    this.#visit(entry)
    return {
      bytes: gzipSync(Buffer.concat(this.#buffers)).byteLength,
      indexOnlyBytes: gzipSync(readFileSync(entry)).byteLength,
      files: [...this.#visited]
    }
  }
}
