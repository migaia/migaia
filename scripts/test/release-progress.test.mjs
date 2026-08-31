import assert from 'node:assert/strict'
import { test } from 'node:test'

import { releasePatchPrefix } from '../release-progress.mjs'

/** Minimal topological inventory used to prove restart classification. */
const packages = ['utils', 'event-subscriber', 'lifecycle']
/** Versions visible after the first two packages have been patched. */
const versions = new Map([
  ['utils', '0.0.3'],
  ['event-subscriber', '0.0.4'],
  ['lifecycle', '0.0.2']
])

test('returns the contiguous release prefix committed at HEAD', () => {
  assert.deepEqual(
    releasePatchPrefix(packages, versions, [
      'chore(release): event-subscriber v0.0.4',
      'chore(release): utils v0.0.3',
      'test: close release gates'
    ]),
    ['utils', 'event-subscriber']
  )
})

test('resumes a current-version release across intervening repair commits', () => {
  assert.deepEqual(
    releasePatchPrefix(packages, versions, [
      'fix: unrelated change',
      'chore(release): utils v0.0.3'
    ]),
    ['utils']
  )
})

test('does not skip a missing dependency-order release commit', () => {
  assert.deepEqual(
    releasePatchPrefix(packages, versions, [
      'chore(release): lifecycle v0.0.2',
      'fix: unrelated change',
      'chore(release): utils v0.0.3'
    ]),
    ['utils']
  )
})

test('ignores matching historical releases before the current run anchor', () => {
  assert.deepEqual(
    releasePatchPrefix(packages, versions, [
      'fix: current repair',
      'chore(release): utils v0.0.3',
      'chore(release): lifecycle v0.0.2',
      'chore(release): event-subscriber v0.0.4'
    ]),
    ['utils']
  )
})

test('keeps an already completed release idempotent', () => {
  assert.deepEqual(
    releasePatchPrefix(packages, versions, [
      'chore(release): lifecycle v0.0.2',
      'chore(release): event-subscriber v0.0.4',
      'chore(release): utils v0.0.3'
    ]),
    packages
  )
})
