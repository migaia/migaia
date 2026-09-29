import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  reviewedRetainedInventory,
  type IRetainedConsumer
} from '../fixtures/tree-shaking/retained-inventory.js'

/** Retained consumers whose exact runtime module sets are reviewed in S8. */
const consumers: readonly IRetainedConsumer[] = ['core', 'client', 'provider', 'full', 'custom']
/** Package root used by the canonical Vite retained-graph measurement. */
const packageRoot = resolve(import.meta.dirname, '../../..')

/** Returns both directions of a module-set mismatch, including duplicate-count drift. */
function compareInventory(reviewed: readonly string[], measured: readonly string[]) {
  const reviewedSet = new Set(reviewed)
  const measuredSet = new Set(measured)
  return {
    missing: reviewed.filter((module) => !measuredSet.has(module)),
    unexpected: measured.filter((module) => !reviewedSet.has(module)),
    countMatches: reviewed.length === measured.length
  }
}

describe('A12 retained inventory equality', () => {
  it('matches all five current module sets and detects either inventory mutation', () => {
    const run = spawnSync('node', ['test/core/tree-shaking-retained.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    expect(run.status, `${run.stdout.slice(-1000)}\n${run.stderr.slice(-1000)}`).toBe(0)
    const measured = JSON.parse(run.stdout) as Record<IRetainedConsumer, { modules: string[] }>
    for (const consumer of consumers) {
      const reviewed = reviewedRetainedInventory[consumer]
      const current = measured[consumer].modules
      expect(compareInventory(reviewed, current), consumer).toEqual({
        missing: [],
        unexpected: [],
        countMatches: true
      })
      expect(current, consumer).not.toContain('src/core/error-serialization.ts')

      const added = [...reviewed, 'src/core/not-retained.ts']
      expect(compareInventory(added, current)).toEqual({
        missing: ['src/core/not-retained.ts'],
        unexpected: [],
        countMatches: false
      })
      const removed = reviewed.slice(1)
      expect(compareInventory(removed, current)).toEqual({
        missing: [],
        unexpected: [reviewed[0]],
        countMatches: false
      })
    }
  }, 30_000)
})
