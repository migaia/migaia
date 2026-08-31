import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Returns the dependency-order release prefix already committed for current manifest versions. */
export function releasePatchPrefix(packageNames, versions, subjectsNewestFirst) {
  const expected = packageNames.map(
    (packageName) => `chore(release): ${packageName} v${versions.get(packageName)}`
  )
  /** The newest first-package commit anchors this run and excludes older same-version releases. */
  const runAnchor = subjectsNewestFirst.indexOf(expected[0])
  if (runAnchor === -1) return []
  /** Repair commits may sit above a partial release; only this run's release subjects matter. */
  const releaseSubjects = subjectsNewestFirst
    .slice(0, runAnchor + 1)
    .filter((subject) => expected.includes(subject))
  /** Chronological order must still be the exact dependency prefix, preventing skipped packages. */
  const chronological = releaseSubjects.toReversed()
  const prefixLength = chronological.findIndex((subject, index) => subject !== expected[index])
  const matchedLength = prefixLength === -1 ? chronological.length : prefixLength
  return packageNames.slice(0, matchedLength)
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
  /** Bounded history admits repair commits made while resuming without scanning unbounded history. */
  const historyLimit = packageNames.length * 4
  const subjects = execFileSync('git', ['log', `-n${historyLimit}`, '--format=%s'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
    .trim()
    .split('\n')
    .filter(Boolean)
  process.stdout.write(releasePatchPrefix(packageNames, versions, subjects).join(' '))
}
