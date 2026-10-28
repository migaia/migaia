import { expect, it } from 'vitest'
import { LogHostErrorText } from '../../src/error-text.ts'
import { LogHostErrorCode, LOG_HOST_ERROR_SOURCE } from '../../src/index.ts'
import { tagLogError } from '../../src/errors.ts'

/** Frozen native errors force the package's existing metadata fallback without changing their stack. */
function wrapperStacks(): void {
  /** Frozen native error retains its original runtime identity beneath the new wrapper. */
  const original = Object.freeze(new TypeError('original'))
  /** The original stack must remain unchanged after metadata fallback. */
  const originalStack = original.stack
  /** This internal helper is the same owner used by actual final batch cleanup. */
  const wrapper = tagLogError(
    original,
    LogHostErrorCode.pluginUninstallCleanupFailed
  ) as TypeError & { source: string; code: string }
  expect(wrapper).toBeInstanceOf(TypeError)
  expect(Object.getPrototypeOf(wrapper)).toBe(TypeError.prototype)
  expect(wrapper.name).toBe('TypeError')
  expect(wrapper.message).toBe(LogHostErrorText.errorTaggingFailed)
  expect(wrapper.source).toBe(LOG_HOST_ERROR_SOURCE)
  expect(wrapper.code).toBe(LogHostErrorCode.pluginUninstallCleanupFailed)
  expect(Object.hasOwn(wrapper, 'stack')).toBe(true)
  expect(typeof wrapper.stack).toBe('string')
  expect(wrapper.stack).not.toBe('')
  expect(wrapper.stack).not.toBe(originalStack)
  expect(wrapper.stack).toContain(LogHostErrorText.errorTaggingFailed)
  expect(wrapper.cause).toBe(original)
  expect(original.stack).toBe(originalStack)
  /** Ordered nested failures must remain reachable without flattening or copying the errors array. */
  const nestedEntries = [new Error('primary'), new RangeError('cleanup')] as const
  /** The aggregate itself also refuses metadata writes. */
  const nested = Object.freeze(new AggregateError(nestedEntries, 'nested'))
  /** Original errors array identity is observable independently of content/order. */
  const nestedErrors = nested.errors
  /** Wrapper construction must not overwrite the original aggregate's stack. */
  const nestedStack = nested.stack
  /** Native prototype and exact original array are preserved by the actual package helper. */
  const nestedWrapper = tagLogError(nested, LogHostErrorCode.pluginUninstallCleanupFailed)
  expect(nestedWrapper).toBeInstanceOf(AggregateError)
  expect(Object.getPrototypeOf(nestedWrapper)).toBe(AggregateError.prototype)
  expect(nestedWrapper.name).toBe('AggregateError')
  expect(nestedWrapper.message).toBe(LogHostErrorText.errorTaggingFailed)
  expect(nestedWrapper.errors).toBe(nestedErrors)
  expect(nestedWrapper.errors).toEqual([nestedEntries[0], nestedEntries[1]])
  expect(nestedWrapper.cause).toBe(nested)
  expect(nestedWrapper.stack).not.toBe(nestedStack)
  expect(nested.stack).toBe(nestedStack)
}
it('keeps wrapper construction stack and nested aggregate order', wrapperStacks)
