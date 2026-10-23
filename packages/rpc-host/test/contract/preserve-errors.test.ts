import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createSettlement } from '../../dist/core/internal/settlement.js'

it('secondary cleanup retains the original primary error independently', () => {
  /**
   * The same original graph is reached locally and retains its full serialized field vector
   * remotely.
   */
  const one = new TypeError('fixture-type')
  /** Second public request remains independently pending and settles once. */
  const two = new RangeError('fixture-range')
  /** Retain the source transport callback and restore it after this fixture. */
  const original = new AggregateError([one, two], 'fixture-primary', { cause: one })
  for (const [index, error] of [one, two, original].entries()) {
    Object.defineProperties(error, {
      source: { value: 'error-fixture', enumerable: true },
      code: { value: `R14_${index}`, enumerable: true }
    })
  }
  /** Cleanup reports its own original failure without replacing the winning primary rejection. */
  const cleanup = new RangeError('cleanup-2')
  /** Collect cleanup reports by identity and invocation count. */
  const reported: unknown[] = []
  /** Capture the original winning rejection without creating another promise owner. */
  const rejected: unknown[] = []
  /** Existing settlement primitive preserves primary failure during cleanup failure. */
  const settlement = createSettlement<never>({
    cleanup: () => {
      throw cleanup
    },
    reportCleanupError: (error) => reported.push(error),
    resolve: () => assert.fail('error-2 unexpectedly resolved'),
    reject: (error) => rejected.push(error)
  })
  assert.equal(settlement.reject(original), true)
  assert.equal(settlement.reject(cleanup), false)
  assert.deepEqual(reported, [cleanup])
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0], original, 'secondary cleanup never replaces primary')
})
