import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
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

/** Reads one exact single-line package inventory from the Makefile. */
function readMakePackages(variable) {
  const makefile = readFileSync(resolve(repositoryRoot, 'Makefile'), 'utf8')
  const match = makefile.match(new RegExp(`^${variable} := (.+)$`, 'm'))
  assert.ok(match, `Makefile must declare ${variable}`)
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

test('accepts the independent store plan with foundation dependencies admitted externally', () => {
  const packageNames = readMakePackages('STORE_RELEASE_PACKAGES')
  assert.equal(
    verifyReleasePlan(repositoryRoot, packageNames, {
      allowedExternalDependencies: readMakeReleasePackages()
    }).length,
    packageNames.length
  )
})

test('keeps store-wasm behind its package-owned wasm prerequisite', () => {
  const packageNames = readMakePackages('STORE_RELEASE_PACKAGES')
  packageNames.splice(packageNames.indexOf('wasm'), 1)
  assert.throws(
    () =>
      verifyReleasePlan(repositoryRoot, packageNames, {
        allowedExternalDependencies: readMakeReleasePackages()
      }),
    /store-wasm depends on omitted release package wasm/
  )
})

test('ship dry-run cannot reach release mutations', () => {
  /** Expanded dry-run command graph emitted by Make without executing recipes. */
  const commandGraph = execFileSync('make', ['-n', 'ship-dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  assert.match(commandGraph, /oxfmt --check/)
  assert.match(commandGraph, /pack --dry-run --json/)
  assert.match(commandGraph, /Missing workspace dependencies/)
  for (const forbidden of [
    'version patch',
    'git add',
    'git commit',
    'git push',
    'pnpm publish',
    'git tag',
    'pnpm whoami',
    'git fetch'
  ])
    assert.doesNotMatch(commandGraph, new RegExp(forbidden))
})

test('store ship dry-run cannot reach release mutations', () => {
  /** Expanded Store dry-run command graph emitted by Make without executing recipes. */
  const commandGraph = execFileSync('make', ['-n', 'store-ship-dry-run'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  assert.match(commandGraph, /pack --dry-run --json/)
  for (const forbidden of [
    'version patch',
    'git add',
    'git commit',
    'git push',
    'pnpm publish',
    'npm whoami'
  ]) {
    assert.doesNotMatch(commandGraph, new RegExp(forbidden))
  }
})

test('ship completes every CI and pack gate before entering resumable CD', () => {
  /** Expanded ship graph proves phase ordering without version, Git, or registry mutation. */
  const commandGraph = execFileSync('make', ['-n', 'ship'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  /** First marker owned by the all-package CI phase. */
  const ci = commandGraph.indexOf('echo "==> CI validating $package"')
  /** Artifact preview begins only after every package check has expanded. */
  const pack = commandGraph.indexOf('echo "==> previewing @migaia/$package artifact"')
  /** CD is the first phase allowed to patch or publish. */
  const cd = commandGraph.indexOf('echo "==> CD releasing $package"')
  assert.ok(ci >= 0 && pack > ci && cd > pack)
  assert.match(commandGraph, /release-progress\.mjs/)
  assert.match(commandGraph, /pnpm view/)
  assert.match(commandGraph, /already published/)
  assert.match(commandGraph, /resuming tag push/)
})

test('store ship is a separate all-CI then resumable-CD command graph', () => {
  const commandGraph = execFileSync('make', ['-n', 'store-ship'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  const ci = commandGraph.indexOf('echo "==> Store CI validating $package"')
  const pack = commandGraph.indexOf('echo "==> previewing @migaia/$package artifact"')
  const cd = commandGraph.indexOf('echo "==> Store CD releasing $package"')
  assert.ok(ci >= 0 && pack > ci && cd > pack)
  assert.match(commandGraph, /release-progress\.mjs/)
})
