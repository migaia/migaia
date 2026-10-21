import { describe, expect, it } from 'vitest'
import { createRuntime } from '../src/index.js'
import { createBatchedOperation } from '../src/entry/extension.js'

/** Bound internal operations own balanced batching while legacy public callbacks keep their arity. */
describe('bound batched operations', () => {
  it('passes one operation argument and preserves zero arguments on public callbacks', () => {
    const runtime = createRuntime()
    let batchArgs = -1
    let untrackedArgs = -1
    runtime.batch(function () {
      batchArgs = arguments.length
    })
    runtime.untracked(function () {
      untrackedArgs = arguments.length
    })
    const operation = createBatchedOperation(runtime, function (value: number) {
      expect(arguments.length).toBe(1)
      return value + 1
    })
    expect(operation(2)).toBe(3)
    expect(batchArgs).toBe(0)
    expect(untrackedArgs).toBe(0)
  })
})
