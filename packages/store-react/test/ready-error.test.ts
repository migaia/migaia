import { describe, expect, it } from 'vitest'
import { StoreReactErrorCode } from '../src/error-code.js'
import { normalizeStoreReadyError } from '../src/StoreProvider.js'

describe('StoreProvider ready rejection normalization', () => {
  it('preserves an Error rejection identity, including frozen Errors', () => {
    const reason = Object.freeze(new Error('ready failed'))
    expect(normalizeStoreReadyError(reason)).toBe(reason)
  })

  it('keeps a hostile non-Error reason reachable without string coercion', () => {
    const reason = {
      get toString(): never {
        throw new Error('toString must not run')
      }
    }
    const normalized = normalizeStoreReadyError(reason) as Error & {
      readonly source: string
      readonly code: string
      readonly cause: unknown
    }
    expect(normalized.source).toBe('@migaia/store-react')
    expect(normalized.code).toBe(StoreReactErrorCode.readyRejected)
    expect(normalized.cause).toBe(reason)
  })
})
