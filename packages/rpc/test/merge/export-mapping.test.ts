import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyExports from '../fixtures/legacy-exports.json'

/** Package root whose manifest and built files define the new public surface. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Walk compiled core files to reject a second copy of the contract implementation. */
function compiledCoreFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? compiledCoreFiles(path) : entry.name.endsWith('.js') ? [path] : []
  })
}

describe('A1 merged public exports', () => {
  it('preserves all 24 runtime export name sets through manifest resolution', async () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, { default: string; types: string }>
    }
    const expected = Object.keys(legacyExports).sort()
    expect(expected).toHaveLength(24)
    expect(Object.keys(manifest.exports).sort()).toEqual(
      expected.map((name) => `.${name.slice('@migaia/rpc'.length)}`).sort()
    )
    for (const [name, baseline] of Object.entries(legacyExports)) {
      const key = `.${name.slice('@migaia/rpc'.length)}`
      const entry = manifest.exports[key]
      expect(entry, name).toBeDefined()
      const relative = entry.default.replace(/^\.\//, '')
      const suffix = name.slice('@migaia/rpc/'.length)
      const indexed = new Set(['contract', 'contract/v1', 'contract/framing', 'core'])
      const expectedRelative = `dist/${suffix}${indexed.has(suffix) ? '/index' : ''}.js`
      expect(relative.startsWith('dist/'), name).toBe(true)
      expect(relative.endsWith('.js'), name).toBe(true)
      expect(entry.types, name).toBe(entry.default.replace(/\.js$/, '.d.ts'))
      expect(existsSync(join(packageRoot, relative)), name).toBe(true)
      expect(existsSync(join(packageRoot, entry.types)), name).toBe(true)
      expect(
        Object.keys(await import(pathToFileURL(join(packageRoot, relative)).href)).sort(),
        name
      ).toEqual(baseline.names)
      // A leaf export maps to its own source path; index entries map to directory roots.
      expect(relative, name).toBe(expectedRelative)
    }
  })

  it('keeps contract protocol and normalizer implementations outside compiled core', () => {
    expect(existsSync(join(packageRoot, 'dist/core'))).toBe(true)
    expect(existsSync(join(packageRoot, 'dist/contract'))).toBe(true)
    const offenders = compiledCoreFiles(join(packageRoot, 'dist/core')).filter((path) => {
      const source = readFileSync(path, 'utf8')
      return /(?:function|const|class)\s+(?:rpcProtocolV1|normalizeRpcEnvelope)\b/.test(source)
    })
    expect(offenders).toEqual([])
  })
})
