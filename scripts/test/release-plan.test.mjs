import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { verifyReleasePlan } from '../release-plan.mjs'

/** Repository root containing the Make release inventory under test. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Reads the exact ordered inventory used by `make ship`. */
function readMakeReleasePackages() {
  /** Root Makefile content containing the release inventory declaration. */
  const makefile = readFileSync(resolve(repositoryRoot, 'Makefile'), 'utf8')
  /** Single-line package inventory captured from the Makefile. */
  const match = makefile.match(/^RELEASE_PACKAGES := (.+)$/m)
  assert.ok(match, 'Makefile must declare RELEASE_PACKAGES')
  return match[1].trim().split(/\s+/)
}

test('accepts the complete dependency-topological Make release plan', () => {
  /** Current Make release inventory. */
  const packageNames = readMakeReleasePackages()
  assert.equal(verifyReleasePlan(repositoryRoot, packageNames).length, packageNames.length)
})

test('rejects a release plan that omits an internal dependency', () => {
  /** Invalid inventory with capability removed from its consumers' closure. */
  const packageNames = readMakeReleasePackages().filter((name) => name !== 'capability')
  assert.throws(
    () => verifyReleasePlan(repositoryRoot, packageNames),
    /depends on omitted release package capability/
  )
})

test('rejects a release plan whose consumer precedes its dependency', () => {
  /** Invalid inventory with capability moved before lifecycle. */
  const packageNames = readMakeReleasePackages()
  packageNames.splice(packageNames.indexOf('capability'), 1)
  packageNames.unshift('capability')
  assert.throws(
    () => verifyReleasePlan(repositoryRoot, packageNames),
    /capability appears before dependency lifecycle/
  )
})
