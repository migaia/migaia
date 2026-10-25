import { describe, expect, expectTypeOf, it } from 'vitest'
import { assertVersionedEnvelope, StorageContractErrorCode } from '@migaia/storage-contract'

describe('versioned envelope admission', () => {
  it('preserves caller-owned state and inferred value types', () => {
    /** Caller-owned state remains the same business value after shape validation. */
    const state = { name: 'Ada' }
    /** A plain persisted archive is the supported admission input. */
    const input = { version: 2, state }
    /** Observed public result for this migration invocation. */
    const result = assertVersionedEnvelope(input)
    expect(result.state).toBe(state)
    expectTypeOf(result.state).toEqualTypeOf<{ name: string }>()
    expectTypeOf(
      assertVersionedEnvelope({ version: 0, state: 'value' }).state
    ).toEqualTypeOf<string>()
    expectTypeOf(
      assertVersionedEnvelope({ version: 0, state: new Uint8Array() }).state
    ).toEqualTypeOf<Uint8Array<ArrayBuffer>>()
  })

  it.each([
    null,
    [],
    new (class {
      version = 1
      state = {}
    })(),
    { version: -1, state: {} },
    { version: 1.5, state: {} },
    { version: Number.MAX_SAFE_INTEGER + 1, state: {} },
    { version: NaN, state: {} },
    { version: Infinity, state: {} },
    { version: 0 },
    { version: 0, state: null },
    { version: 0, state: undefined },
    Object.create({ version: 0, state: {} })
  ])('rejects invalid envelope %#', (input) => {
    expect(() => assertVersionedEnvelope(input)).toThrow(
      expect.objectContaining({
        source: '@migaia/storage-contract',
        code: StorageContractErrorCode.envelopeInvalid
      })
    )
  })

  it('accepts safe version boundaries', () => {
    expect(assertVersionedEnvelope({ version: 0, state: false }).version).toBe(0)
    expect(assertVersionedEnvelope({ version: Number.MAX_SAFE_INTEGER, state: 0 }).version).toBe(
      Number.MAX_SAFE_INTEGER
    )
    /** Unknown archive input must retain an unknown state type. */
    const unknownValue: unknown = { version: 1, state: {} }
    expectTypeOf(assertVersionedEnvelope(unknownValue).state).toEqualTypeOf<unknown>()
  })
})
