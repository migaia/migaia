import { describe, expect, it } from 'vitest'
import { sliceByFrameBudget } from '../src/index.js'
import { readReason } from '../src/signal-snapshot.js'
import { createSerializeTypeError, SerializeErrorCode, SerializeErrorText } from '../src/errors.js'

/** Structural signal with a reason accessor whose failure identity is observable. */
function throwingReason(cause: unknown, initialAborted = false) {
  let aborted = initialAborted
  let listener: (() => void) | undefined
  let reads = 0
  return {
    signal: {
      get aborted() {
        return aborted
      },
      get reason(): never {
        reads++
        throw cause
      },
      addEventListener: (_type: 'abort', callback: () => void) => {
        listener = callback
      },
      removeEventListener: () => {
        listener = undefined
      }
    },
    get reads() {
      return reads
    },
    fire() {
      aborted = true
      listener?.()
    }
  }
}

describe('A4 serialize abort reason policies', () => {
  it('preserves the snapshot distinction between tagged and untagged failures', () => {
    const cause = new Error('reason getter')
    const untagged = throwingReason(cause)
    expect(() => readReason(untagged.signal)).toThrowError(
      expect.objectContaining({
        code: SerializeErrorCode.invalidOption,
        message: SerializeErrorText.signalReasonReadFailed,
        cause
      })
    )
    expect(untagged.reads).toBe(1)

    const tagged = createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalInvalid
    )
    const source = throwingReason(tagged)
    expect(() => readReason(source.signal)).toThrow(tagged)
    expect(source.reads).toBe(1)
  })

  it('keeps the stream wrapper chain when cancellation wins an owned yield', async () => {
    const cause = new Error('stream reason getter')
    const source = throwingReason(cause)
    const iterator = sliceByFrameBudget([{ id: 0 }, { id: 1 }], {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      signal: source.signal,
      scheduler: { now: () => 0, schedule: () => ({ cancel: () => undefined }) }
    })
    await iterator.next()
    const pending = iterator.next()
    await Promise.resolve()
    source.fire()
    const error = await pending.catch((value: unknown) => value)
    expect(error).toMatchObject({ code: 'INVALID_OPTION' })
    expect(source.reads).toBe(1)
    /** Preserve each package wrapper and the original getter failure. */
    const chain: unknown[] = []
    let current: unknown = error
    while (current !== undefined && chain.length < 5) {
      chain.push(current)
      current = (current as { cause?: unknown }).cause
    }
    expect(chain).toContain(cause)
    expect(chain.slice(0, -1).map((value) => (value as { code?: unknown }).code)).toEqual([
      'INVALID_OPTION',
      'INVALID_OPTION'
    ])
  })
})
