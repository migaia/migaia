import { expect, it } from 'vitest'
import { build } from 'vite'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Measure only host-owned root code using the repository's established externalized library build. */
async function rootSize(): Promise<void> {
  /** Package location remains portable across worktrees and consumer checkouts. */
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  /**
   * No files are written; the already-built ESM root is bundled with workspace dependencies
   * external.
   */
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: { entry: resolve(packageRoot, 'dist/index.js'), formats: ['es'] },
      rollupOptions: { external: [/^@migaia\//] }
    }
  })
  /** One final concatenation measures every emitted code chunk without repeated buffer copies. */
  const chunks: string[] = []
  for (const output of Array.isArray(result) ? result : [result])
    if ('output' in output)
      for (const chunk of output.output) if ('code' in chunk) chunks.push(chunk.code)
  /** Gzip level defaults match the size contract rather than an altered compression budget. */
  const bytes = gzipSync(chunks.join('\n')).byteLength
  expect(bytes).toBeLessThanOrEqual(10240)
  console.info(`log-host root gzip bytes: ${bytes}`)
  /** Runtime dependency metadata must remain entirely within the established lower-level family. */
  const metadata = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  for (const name of Object.keys(metadata.dependencies))
    expect(name.startsWith('@migaia/')).toBe(true)
}
it('keeps externalized root gzip within its declared dependency and size budget', rootSize)
