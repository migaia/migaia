import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createContractError } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode } from '@migaia/rpc-contract/error-code'
import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'

it('native error vectors retain complete identity and ordered causes independently', () => {
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
  /** Original native stack is pinned before wrapping and serialization. */
  const stack = original.stack
  /** Contract factory keeps native TypeError and the exact original aggregate cause. */
  const top = createContractError(RpcContractErrorCode.invalidEnvelope, original)
  assert.ok(top instanceof TypeError)
  assert.equal(top.name, 'TypeError')
  assert.equal(top.message, 'rpc envelope is invalid')
  assert.equal(Reflect.get(top, 'source'), 'rpc.contract')
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
  assert.equal(Reflect.get(restored, 'source'), 'error-fixture')
  assert.equal(Reflect.get(restored, 'code'), 'R14_2')
  for (const [index, child] of [one, two].entries()) {
    /** Select one ordered restored aggregate child for equality assertions. */
    const result = restored.errors[index]
    assert.equal(result.constructor, child.constructor)
    for (const field of ['name', 'message', 'stack', 'source', 'code'])
      assert.equal(Reflect.get(result, field), Reflect.get(child, field))
  }
})
