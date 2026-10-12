import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Returns the dependency-order release prefix already committed for current manifest versions.
 *
 * @param {readonly string[]} packageNames Topological release plan
 * @param {ReadonlyMap<string, string>} versions Current manifest version per package
 * @param {readonly string[]} subjectsNewestFirst Recent commit subjects, newest first
 * @param {{ newRun?: boolean; lastTagPushed?: () => boolean }} [options] `newRun` is set only by a
 *   full ship after its gates: a stale or finished previous run then yields `[]`, so the new run
 *   patches fresh versions. `lastTagPushed` reports whether the plan's final package tag is on the
 *   remote, which is the last mutation of a finished run. Without `newRun` a finished run stays an
 *   idempotent resume.
 * @returns {readonly string[]} Packages whose patch commit already exists in the live run
 */
export function releasePatchPrefix(packageNames, versions, subjectsNewestFirst, options = {}) {
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
  if (options.newRun) {
    /** Later release commits beyond the prefix mean another plan released after it: stale run. */
    if (chronological.length > matchedLength) return []
    /** A complete prefix whose final tag is pushed belongs to a finished run. */
    if (matchedLength === packageNames.length && options.lastTagPushed?.()) return []
  }
  return packageNames.slice(0, matchedLength)
}

/** Whether Node invoked this module as the release-progress command. */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  /** Repository whose manifests and release commits define resumable progress. */
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  /** Full ship passes this after its gates; bare `ship-cd` keeps pure resume semantics. */
  const newRun = process.argv.includes('--new-run-if-finished')
  /** Dependency-topological package inventory supplied by Make. */
  const packageNames = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
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
  /** The plan's final package defines the tag pushed last by a finished run. */
  const lastPackage = packageNames.at(-1)
  /** Queried lazily so resume-only invocations never touch the remote. */
  const lastTagPushed = () =>
    execFileSync(
      'git',
      ['ls-remote', '--tags', 'origin', `refs/tags/${lastPackage}-v${versions.get(lastPackage)}`],
      { cwd: repositoryRoot, encoding: 'utf8' }
    ).trim() !== ''
  process.stdout.write(
    releasePatchPrefix(packageNames, versions, subjects, { newRun, lastTagPushed }).join(' ')
  )
}
