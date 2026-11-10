import { describe, expect, it } from 'vitest'
import { StoreReactErrorCode } from '../src/error-code.ts'
import { normalizeStoreReadyError } from '../src/StoreProvider.tsx'

describe('StoreProvider ready rejection normalization', () => {
  it('keeps an uncoded Error rejection identity and attaches READY_REJECTED to it', () => {
    const reason = new Error('ready failed')
    expect(normalizeStoreReadyError(reason)).toBe(reason)
    expect(reason).toMatchObject({ source: 'store.react', code: StoreReactErrorCode.readyRejected })
  })

  it('keeps a complete foreign identity unchanged', () => {
    const reason = Object.assign(new Error('foreign'), { source: 'foreign.domain', code: 'X' })
    expect(normalizeStoreReadyError(reason)).toBe(reason)
    expect(reason.code).toBe('X')
  })

  it('wraps a frozen Error it cannot tag, keeping it on cause', () => {
    const reason = Object.freeze(new Error('ready failed'))
    const normalized = normalizeStoreReadyError(reason) as Error & { readonly code: string }
    expect(normalized).not.toBe(reason)
    expect(normalized.code).toBe(StoreReactErrorCode.readyRejected)
    expect(normalized.cause).toBe(reason)
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
    expect(normalized.source).toBe('store.react')
    expect(normalized.code).toBe(StoreReactErrorCode.readyRejected)
    expect(normalized.cause).toBe(reason)
  })
})
