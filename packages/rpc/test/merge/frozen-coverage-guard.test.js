import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  frozenMergeCoverageFiles,
  retiredMergeCoverageFiles
} from '../fixtures/frozen-merge-coverage.js'
import { assertFrozenMergeCoverage } from './frozen-coverage-guard.js'

/** Use the real signed baseline and immutable legacy thresholds, not a synthetic lower target. */
const baseline = JSON.parse(
  readFileSync(new URL('../../../../coverage-baseline.json', import.meta.url), 'utf8')
)
/** The original merge threshold fixture remains untouched. */
const legacy = JSON.parse(
  readFileSync(new URL('../fixtures/legacy-coverage.json', import.meta.url), 'utf8')
)

describe('K217 frozen merge coverage guard', () => {
  it('rejects a frozen file decline that pulls its aggregate below the original threshold', () => {
    /** A single frozen source retains its counts but gains uncovered executable statements. */
    const files = structuredClone(baseline.files)
    /** Deliberately perturb data only; production source and the signed baseline stay untouched. */
    const path = frozenMergeCoverageFiles.find(
      (name) => !Object.hasOwn(retiredMergeCoverageFiles, name)
    )
    files[path].statements.total += 10_000
    assert.throws(() => assertFrozenMergeCoverage(files, legacy), /statements: frozen pct/)
  })

  it('ignores only new file additions, even when the new file has no covered statements', () => {
    /** This input changes no historical metrics, and therefore must yield identical aggregates. */
    const files = structuredClone(baseline.files)
    files['packages/rpc/src/process/fixture-new-module.ts'] = Object.fromEntries(
      ['lines', 'statements', 'functions', 'branches'].map((metric) => [
        metric,
        { covered: 0, total: 1_000_000, pct: 0 }
      ])
    )
    assert.deepEqual(
      assertFrozenMergeCoverage(files, legacy),
      assertFrozenMergeCoverage(baseline.files, legacy)
    )
  })

  it('rejects an unapproved missing frozen file instead of shrinking its denominator', () => {
    /** Missing historical evidence is a failure, rather than an implicit retirement. */
    const files = structuredClone(baseline.files)
    /** Select a live frozen member independently of the approved historical deletions. */
    const path = frozenMergeCoverageFiles.find(
      (name) => !Object.hasOwn(retiredMergeCoverageFiles, name)
    )
    delete files[path]
    assert.throws(() => assertFrozenMergeCoverage(files, legacy), /missing frozen coverage file/)
  })
})
