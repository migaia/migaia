import { expect, it } from 'vitest'
import { normalizePortable } from '@migaia/rpc-contract/portable'

it('retains the bare native-input guard receiver and root error identity', () => {
  for (const value of [new Uint8Array(), new ArrayBuffer(0)]) {
    /** The old public callback receives no context receiver and propagates this exact failure. */
    const original = new RangeError('native guard receiver')
    /** One invocation is required for each genuine binary shape. */
    let calls = 0
    /** Ordinary functions expose an accidental method call that arrow callbacks cannot observe. */
    function guard(this: unknown): never {
      calls++
      expect(this).toBeUndefined()
      throw original
    }
    /** Capture exact identity rather than only comparing the native message or class. */
    let rejected: unknown
    try {
      normalizePortable(value, 0, new Set<object>(), guard)
    } catch (error) {
      rejected = error
    }
    expect(rejected).toBe(original)
    expect(calls).toBe(1)
  }
})
