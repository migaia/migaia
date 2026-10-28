import { expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import * as root from '../src/index.ts'
import * as features from '../src/features/index.ts'
import retryDefault from '../src/features/retry.ts'
import { projectLogEntry } from '../src/plugin.ts'

/** Public root state and factory layout retain their exact approved names. */
function publicExports(): void {
  expect(Object.keys(root.LogHostStatus)).toEqual(['active', 'flushing', 'shuttingDown', 'closed'])
  for (const [key, value] of Object.entries(root.LogHostStatus)) expect(value).toBe(key)
  expect(root.LogHostStatus.shuttingDown).toBe('shuttingDown')
  expect(root.defaultLogFailureReporter).toBeTypeOf('function')
  expect(projectLogEntry).toBeTypeOf('function')
  expect(features.retryFeature).toBe(retryDefault)
  for (const retired of [
    'Logger',
    'getLoggerRuntimeManager',
    'setLoggerRuntimeManager',
    'extends',
    'raw'
  ])
    expect(root).not.toHaveProperty(retired)
  /** A frozen facade exposes no retired output or forwarding methods. */
  const host = root.createLogHost()
  expect(host).not.toHaveProperty('raw')
  expect(host).not.toHaveProperty('extends')
}

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

/** Native Node proves the emitted relative extensions without a TypeScript runtime loader. */
function nodeBuiltImport(): void {
  /** Tests run only after the package build under its guarded test script. */
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  /** Native imports exercise package self-reference, features aggregate and named default subpath. */
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const root=await import('@migaia/log-host'); const all=await import('@migaia/log-host/features');const one=await import('@migaia/log-host/features/retry');if(typeof root.createLogHost!=='function'||all.retryFeature!==one.default)process.exit(1)"
    ],
    { cwd: packageRoot, encoding: 'utf8' }
  )
  expect(result.status, result.stderr).toBe(0)
}
it('exposes exact host constants and approved factory entries', publicExports)
it('uses real TypeScript relative module specifiers throughout source and tests', sourceSpecifiers)
it('imports built package entries in native Node', nodeBuiltImport)
