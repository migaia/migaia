import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  reviewedRetainedInventory,
  type IRetainedConsumer
} from '../fixtures/tree-shaking/retained-inventory.js'

/** Retained consumers whose runtime module sets are reviewed in S8. */
const consumers: readonly IRetainedConsumer[] = ['core', 'client', 'provider', 'full', 'custom']
/** Package root used by the canonical Vite retained-graph measurement. */
const packageRoot = resolve(import.meta.dirname, '../../..')
/**
 * Unreviewed modules a consumer may retain beyond the reviewed list. Small growth from ordinary
 * merges passes without a re-pin; larger growth fails and lists the new modules for review.
 */
const allowedUnreviewedModules = 5
/** Bundler content hashes (8 chars, at least one uppercase letter or digit) change on every rebuild. */
const chunkHash = /-(?=[A-Za-z0-9_]*[A-Z0-9])[A-Za-z0-9_]{8}\.js$/

/** Drops the bundler content hash so a rebuilt shared chunk keeps its reviewed identity. */
function normalizeModule(module: string): string {
  return module.replace(chunkHash, '.js')
}

/** Returns measured modules that are not in the reviewed list, compared without chunk hashes. */
function unreviewedModules(reviewed: readonly string[], measured: readonly string[]): string[] {
  const reviewedSet = new Set(reviewed.map(normalizeModule))
  return measured.filter((module) => !reviewedSet.has(normalizeModule(module)))
}

describe('A12 retained inventory', () => {
  it('keeps every consumer within the reviewed module set plus a small allowance', () => {
    const run = spawnSync('node', ['test/core/tree-shaking-retained.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    expect(run.status, `${run.stdout.slice(-1000)}\n${run.stderr.slice(-1000)}`).toBe(0)
    const measured = JSON.parse(run.stdout) as Record<IRetainedConsumer, { modules: string[] }>
    for (const consumer of consumers) {
      const current = measured[consumer].modules
      const unreviewed = unreviewedModules(reviewedRetainedInventory[consumer], current)
      expect(unreviewed.length, `${consumer}: ${unreviewed.join(', ')}`).toBeLessThanOrEqual(
        allowedUnreviewedModules
      )
      expect(current, consumer).not.toContain('dist/core/error-serialization.js')
    }
  }, 30_000)

  it('compares rebuilt chunks by name and reports additions', () => {
    const reviewed = ['dist/a.js', 'utils/dist/error-B4iC5cDy.js']
    expect(unreviewedModules(reviewed, ['dist/a.js', 'utils/dist/error-tLXBvoy2.js'])).toEqual([])
    expect(unreviewedModules(reviewed, ['dist/a.js', 'dist/b.js'])).toEqual(['dist/b.js'])
    expect(unreviewedModules(reviewed, [])).toEqual([])
  })
})
