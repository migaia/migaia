import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** A13 compares every built runtime export with the tracked three-package integration baseline. */
/** Repository and tracked baseline locations are independent of the caller's working directory. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const baselinePath = join(repositoryRoot, 'scripts/fixtures/public-exports.baseline.json')

/** Selects the runtime ESM target from one package export condition tree. */
const runtimeTarget = (value) => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const selected = runtimeTarget(candidate)
      if (selected !== undefined) return selected
    }
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  for (const condition of ['import', 'default', 'node', 'browser']) {
    const selected = runtimeTarget(value[condition])
    if (selected !== undefined) return selected
  }
  return undefined
}

/** Lists every built package whose manifest declares a public exports map. */
const discoverPackages = () =>
  readdirSync(join(repositoryRoot, 'packages'))
    .map((directory) => {
      const packageRoot = join(repositoryRoot, 'packages', directory)
      const manifestPath = join(packageRoot, 'package.json')
      if (!existsSync(manifestPath) || !existsSync(join(packageRoot, 'dist'))) return undefined
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (!manifest.exports || typeof manifest.name !== 'string') return undefined
      return { packageRoot, manifest }
    })
    .filter(Boolean)
    .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))

/** Captures exact runtime names for every concrete JavaScript export subpath. */
const collectBaseline = async () => {
  const packages = {}
  for (const { packageRoot, manifest } of discoverPackages()) {
    const entries = {}
    const exportMap =
      typeof manifest.exports === 'string' || Array.isArray(manifest.exports)
        ? { '.': manifest.exports }
        : manifest.exports
    for (const [subpath, conditions] of Object.entries(exportMap)) {
      if (subpath.includes('*')) continue
      const target = runtimeTarget(conditions)
      if (target === undefined || !target.endsWith('.js')) continue
      const modulePath = resolve(packageRoot, target)
      if (!existsSync(modulePath)) continue
      const module = await import(`${pathToFileURL(modulePath).href}?exports-baseline`)
      entries[subpath] = Object.keys(module).sort()
    }
    packages[manifest.name] = entries
  }
  return { packages }
}

if (process.argv.includes('--write')) {
  const baseline = await collectBaseline()
  mkdirSync(dirname(baselinePath), { recursive: true })
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
}

test('tracked public export baseline covers every built package and exact concrete subpath', async () => {
  const expected = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const actual = await collectBaseline()
  assert.equal(Object.keys(actual.packages).length, discoverPackages().length)
  assert.deepEqual(actual, expected)
})
