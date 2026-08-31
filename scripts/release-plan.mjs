import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Scripts every publishable workspace member must own. */
const requiredScripts = [
  'fmt',
  'lint',
  'typecheck',
  'test',
  'build',
  'release:patch',
  'release:publish'
]

/**
 * Validates a closed topological release plan against workspace manifests.
 *
 * @param {string} repositoryRoot Absolute repository root
 * @param {readonly string[]} packageNames Ordered unscoped package names
 * @returns {readonly { name: string; dependencies: readonly string[] }[]} Normalized plan
 * @throws {Error} When the plan is duplicated, incomplete, out of order, or not publishable
 */
export function verifyReleasePlan(repositoryRoot, packageNames) {
  /** Workspace registry authority inherited by packages without an override. */
  const npmConfig = readFileSync(resolve(repositoryRoot, '.npmrc'), 'utf8')
  if (!/^@migaia:registry=https:\/\/npm\.pkg\.github\.com$/m.test(npmConfig))
    throw new Error('Workspace does not target GitHub Packages')
  const seen = new Set()
  return packageNames.map((name) => {
    if (seen.has(name)) throw new Error(`Duplicate release package: ${name}`)
    const manifestPath = resolve(repositoryRoot, 'packages', name, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== `@migaia/${name}`)
      throw new Error(`Release package name mismatch: ${name} -> ${manifest.name}`)
    for (const script of requiredScripts)
      if (!manifest.scripts?.[script]) throw new Error(`${name} is missing script ${script}`)
    if (
      manifest.publishConfig?.registry &&
      manifest.publishConfig.registry !== 'https://npm.pkg.github.com'
    )
      throw new Error(`${name} does not target GitHub Packages`)
    const dependencyMap = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies
    }
    const dependencies = Object.keys(dependencyMap)
      .filter((dependency) => dependency.startsWith('@migaia/'))
      .map((dependency) => dependency.slice('@migaia/'.length))
      .sort()
    for (const dependency of dependencies) {
      if (!packageNames.includes(dependency))
        throw new Error(`${name} depends on omitted release package ${dependency}`)
      if (!seen.has(dependency)) throw new Error(`${name} appears before dependency ${dependency}`)
    }
    seen.add(name)
    return { name, dependencies }
  })
}

/** Whether Node invoked this module as the executable release-plan command. */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  /** Repository root owned by the executable entry point. */
  const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  /** Ordered package names supplied by Make. */
  const packageNames = process.argv.slice(2)
  if (packageNames.length === 0) throw new Error('Release plan is empty')
  /** Validated release plan printed for operator review before mutation. */
  const plan = verifyReleasePlan(repositoryRoot, packageNames)
  console.log(`Release plan OK: ${plan.map(({ name }) => name).join(' -> ')}`)
}
