import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Returns the contiguous dependency-order release prefix already committed at HEAD. */
export function releasePatchPrefix(packageNames, versions, subjectsNewestFirst) {
  const expected = packageNames.map(
    (packageName) => `chore(release): ${packageName} v${versions.get(packageName)}`
  )
  const limit = Math.min(expected.length, subjectsNewestFirst.length)
  for (let length = limit; length > 0; length -= 1) {
    const chronological = subjectsNewestFirst.slice(0, length).toReversed()
    if (chronological.every((subject, index) => subject === expected[index]))
      return packageNames.slice(0, length)
  }
  return []
}

/** Whether Node invoked this module as the release-progress command. */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  /** Repository whose manifests and release commits define resumable progress. */
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  /** Dependency-topological package inventory supplied by Make. */
  const packageNames = process.argv.slice(2)
  /** Current source-manifest versions keyed by release package directory. */
  const versions = new Map(
    packageNames.map((packageName) => {
      /** Manifest is the source authority for the version committed by patch. */
      const manifest = JSON.parse(
        readFileSync(resolve(repositoryRoot, 'packages', packageName, 'package.json'), 'utf8')
      )
      if (typeof manifest.version !== 'string')
        throw new Error(`invalid release package version: ${packageName}`)
      return [packageName, manifest.version]
    })
  )
  /** Recent subjects are sufficient because a release run owns one contiguous commit per package. */
  const subjects = execFileSync('git', ['log', `-n${packageNames.length}`, '--format=%s'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
    .trim()
    .split('\n')
    .filter(Boolean)
  process.stdout.write(releasePatchPrefix(packageNames, versions, subjects).join(' '))
}
