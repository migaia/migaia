import { expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/** Walk source/test files once so every relative source module specifier has an actual target. */
function sourceSpecifiers(): void {
  /** Package location is derived from the test module rather than a user-machine absolute path. */
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  /** An explicit stack keeps this test's traversal linear and avoids recursive local functions. */
  const pending = [join(packageRoot, 'src'), join(packageRoot, 'test')]
  for (let cursor = 0; cursor < pending.length; cursor++) {
    /** Each directory contributes its children once. */
    const path = pending[cursor]
    if (statSync(path).isDirectory()) {
      for (const child of readdirSync(path)) pending.push(join(path, child))
      continue
    }
    if (extname(path) !== '.ts' && extname(path) !== '.tsx') continue
    /** Static import/export, bare import and dynamic import share the real relative target rule. */
    const source = readFileSync(path, 'utf8')
    /** The scanner deliberately matches both quote styles and every supported module syntax. */
    const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.[^'"\n]+)\1/g
    for (const match of source.matchAll(pattern)) {
      /** Only relative module specifiers participate; package entries stay untouched. */
      const specifier = match[2]
      expect(specifier, `${path}: ${specifier}`).not.toMatch(/\.js$/)
      expect(specifier, `${path}: ${specifier}`).toMatch(/\.(?:ts|tsx)$/)
      expect(existsSync(resolve(dirname(path), specifier)), `${path}: ${specifier}`).toBe(true)
    }
  }
}

/** Native Node imports the built root without a TypeScript runtime loader. */
function builtEntry(): void {
  /** Self-reference resolves only the package's published condition map. */
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  /** The child imports the actual built JavaScript root. */
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('@migaia/log-plugin-file')"],
    { cwd: packageRoot, encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(0)
}
it('uses real source extensions for every relative module specifier', sourceSpecifiers)
it('imports the built root directly in native Node', builtEntry)
