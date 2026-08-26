import { describe, expect, it } from 'vitest'
import { LoggerErrorText } from '../src/error-text.js'
import { LoggerErrorCode, LOGGER_SOURCE, tagLoggerError } from '../src/errors.js'

type ITaggedError = Error & {
  readonly cause?: unknown
  readonly code?: string
  readonly source?: string
}

describe('Round28 logger cleanup wrapper stack contract', () => {
  it('LG-T51 / LG-R34 keeps wrapper construction stack and nested aggregate order', () => {
    /** Frozen native error that forces metadata tagging onto a wrapper. */
    const original = Object.freeze(new TypeError('round28-original'))
    /** Original stack captured before wrapper construction. */
    const originalStack = original.stack
    /** Wrapper produced when the frozen error rejects metadata attachment. */
    const wrapper = tagLoggerError(
      original,
      LoggerErrorCode.pluginUninstallCleanupFailed
    ) as ITaggedError

    expect(wrapper).toBeInstanceOf(TypeError)
    expect(Object.getPrototypeOf(wrapper)).toBe(TypeError.prototype)
    expect(wrapper.name).toBe('TypeError')
    expect(wrapper.message).toBe(LoggerErrorText.errorTaggingFailed)
    expect(wrapper.source).toBe(LOGGER_SOURCE)
    expect(wrapper.code).toBe(LoggerErrorCode.pluginUninstallCleanupFailed)
    expect(Object.prototype.hasOwnProperty.call(wrapper, 'stack')).toBe(true)
    expect(typeof wrapper.stack).toBe('string')
    expect(wrapper.stack).not.toBe('')
    expect(wrapper.stack).not.toBe(originalStack)
    expect(wrapper.stack).toContain(LoggerErrorText.errorTaggingFailed)
    expect(wrapper.cause).toBe(original)
    expect(original.stack).toBe(originalStack)

    /** Ordered cleanup errors retained by the frozen nested aggregate. */
    const nestedEntries = [new Error('round28-primary'), new RangeError('round28-cleanup')] as const
    /** Frozen aggregate whose errors array must remain ordered and reachable. */
    const nested = Object.freeze(new AggregateError(nestedEntries, 'round28-nested'))
    /** Original aggregate errors array retained for exact wrapper reachability checks. */
    const nestedErrors = nested.errors
    /** Original nested aggregate stack captured before wrapper construction. */
    const nestedStack = nested.stack
    /** Wrapper carrying the frozen aggregate's native prototype and errors array. */
    const nestedWrapper = tagLoggerError(
      nested,
      LoggerErrorCode.pluginUninstallCleanupFailed
    ) as ITaggedError & AggregateError

    expect(nestedWrapper).toBeInstanceOf(AggregateError)
    expect(Object.getPrototypeOf(nestedWrapper)).toBe(AggregateError.prototype)
    expect(nestedWrapper.name).toBe('AggregateError')
    expect(nestedWrapper.message).toBe(LoggerErrorText.errorTaggingFailed)
    expect(nestedWrapper.errors).toBe(nestedErrors)
    expect(nestedWrapper.errors).toEqual([nestedEntries[0], nestedEntries[1]])
    expect(nestedWrapper.cause).toBe(nested)
    expect(nestedWrapper.stack).not.toBe(nestedStack)
    expect(nested.stack).toBe(nestedStack)
  })
})
