import assert from 'node:assert/strict'
import {
  frozenMergeCoverageFiles,
  retiredMergeCoverageFiles
} from '../fixtures/frozen-merge-coverage.js'

/** @typedef {{ covered: number; total: number; pct: number }} ICoverageMetric */
/** @typedef {Record<string,Record<string,ICoverageMetric>>} IFileCoverage */

/**
 * Sum only merge-delivery files; never dilute the guard with subsequent runtime modules. Approved
 * retired paths are explicit, and a missing live file cannot silently shrink the set.
 *
 * @param {IFileCoverage} files Current signed per-file coverage.
 * @returns {Record<string,ICoverageMetric>} Exact aggregate counts and rounded percentages.
 * @throws {Error} An assertion error when a historical live file is missing or a retired file
 *   returns.
 */
export function frozenMergeCoverage(files) {
  /** Four custody metrics use their existing two-decimal percentage contract. */
  const result = {}
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    /** Accumulate present historical code independently of new package files. */
    let covered = 0
    /** Approved deletions have no executable statements left in this file set. */
    let total = 0
    for (const path of frozenMergeCoverageFiles) {
      if (Object.hasOwn(retiredMergeCoverageFiles, path)) {
        assert.equal(Object.hasOwn(files, path), false, `retired frozen file reappeared: ${path}`)
        continue
      }
      assert.ok(Object.hasOwn(files, path), `missing frozen coverage file: ${path}`)
      covered += files[path][metric].covered
      total += files[path][metric].total
    }
    result[metric] = { covered, total, pct: Math.round((covered / total) * 10_000) / 100 }
  }
  return result
}

/**
 * Enforce the unchanged old-package percentages on the frozen merge-delivery set.
 *
 * @param {IFileCoverage} files Current signed per-file coverage.
 * @param {Record<string,Record<string,ICoverageMetric>>} legacy Frozen old-package metrics.
 * @returns {Record<string,ICoverageMetric>} Aggregates, or a metric-specific assertion failure.
 * @throws {Error} An assertion error when any unchanged legacy percentage is violated.
 */
export function assertFrozenMergeCoverage(files, legacy) {
  /** The denominator comes solely from the frozen source set above. */
  const current = frozenMergeCoverage(files)
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    /** Preserve the original combined old-package threshold, without a new allowance. */
    const covered = legacy['rpc-contract'][metric].covered + legacy['web-rpc'][metric].covered
    /** Both legacy packages still define the original threshold denominator. */
    const total = legacy['rpc-contract'][metric].total + legacy['web-rpc'][metric].total
    /** Match A10's original rounding exactly. */
    const pct = Math.round((covered / total) * 10_000) / 100
    assert.ok(current[metric].pct >= pct, `${metric}: frozen pct ${current[metric].pct} < ${pct}`)
  }
  return current
}
