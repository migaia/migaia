import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createContractError } from '../../src/contract/contract-error.js'
import { RpcContractErrorCode } from '../../src/contract/error-code.js'
import { serializeRpcError, deserializeRpcError } from '../../src/contract/index.js'
import { createSettlement } from '../../src/core/internal/settlement.js'

it('[R14-A6] native error vectors retain complete identity, ordered causes and secondary cleanup independently', () => {
  /**
   * The same original graph is reached locally and retains its full serialized field vector
   * remotely.
   */
  const one = new TypeError('r14-type')
  /** Second public request remains independently pending and settles once. */
  const two = new RangeError('r14-range')
  /** Retain the source transport callback and restore it after this fixture. */
  const original = new AggregateError([one, two], 'r14-primary', { cause: one })
  for (const [index, error] of [one, two, original].entries()) {
    Object.defineProperties(error, {
      source: { value: 'r14-error-fixture', enumerable: true },
      code: { value: `R14_${index}`, enumerable: true }
    })
  }
  /** Original native stack is pinned before wrapping and serialization. */
  const stack = original.stack
  /** Contract factory keeps native TypeError and the exact original aggregate cause. */
  const top = createContractError(RpcContractErrorCode.invalidEnvelope, original)
  assert.ok(top instanceof TypeError)
  assert.equal(top.name, 'TypeError')
  assert.equal(top.message, 'rpc envelope is invalid')
  assert.equal(Reflect.get(top, 'source'), '@migaia/rpc/contract')
  assert.equal(Reflect.get(top, 'code'), 'INVALID_ENVELOPE')
  assert.ok(top.stack && top.stack.length > 0)
  assert.equal(top.cause, original)
  assert.equal((top.cause as AggregateError).cause, one)
  assert.equal((top.cause as AggregateError).errors[0], one)
  assert.equal((top.cause as AggregateError).errors[1], two)
  assert.equal(original.stack, stack)
  /** Cross-realm reconstruction must preserve each complete native field vector. */
  const restored = deserializeRpcError(
    serializeRpcError(original, {
      report: (error) => {
        throw error
      }
    })
  ) as AggregateError
  assert.ok(restored instanceof AggregateError)
  assert.equal(restored.message, original.message)
  assert.equal(restored.stack, stack)
  assert.equal(Reflect.get(restored, 'source'), 'r14-error-fixture')
  assert.equal(Reflect.get(restored, 'code'), 'R14_2')
  for (const [index, child] of [one, two].entries()) {
    /** Select one ordered restored aggregate child for equality assertions. */
    const result = restored.errors[index]
    assert.equal(result.constructor, child.constructor)
    for (const field of ['name', 'message', 'stack', 'source', 'code'])
      assert.equal(Reflect.get(result, field), Reflect.get(child, field))
  }
  /** Cleanup reports its own original failure without replacing the winning primary rejection. */
  const cleanup = new RangeError('r14-cleanup')
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
    resolve: () => assert.fail('r14-error unexpectedly resolved'),
    reject: (error) => rejected.push(error)
  })
  assert.equal(settlement.reject(original), true)
  assert.equal(settlement.reject(cleanup), false)
  assert.deepEqual(reported, [cleanup])
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0], original, '[R14-A6] secondary cleanup never replaces primary')
})
