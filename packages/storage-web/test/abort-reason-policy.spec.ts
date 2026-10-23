import { createRuntime } from '@migaia/reactive'
import { describe, expect, it } from 'vitest'
import { readAbortReason } from '@migaia/storage-host/authoring/backend'
import { createReactiveServiceFixture } from './helpers/reactive-service.js'

describe('storage operation abort reason policy', () => {
  it('returns undefined, the original reason, or the original getter failure', () => {
    const reason = { cancelled: true }
    const cause = new Error('reason getter')
    let reads = 0
    expect(readAbortReason(undefined)).toBeUndefined()
    expect(readAbortReason({ aborted: true, reason } as never)).toBe(reason)
    expect(
      readAbortReason({
        aborted: true,
        get reason(): never {
          reads++
          throw cause
        }
      } as never)
    ).toBe(cause)
    expect(reads).toBe(1)
  })
})

describe('reactive query abort reason policy', () => {
  it('wraps a pre-aborted getter failure once at admission', async () => {
    const { host, service } = await createReactiveServiceFixture({ id: 'reason-pre' })
    const cause = new Error('reason getter')
    let reads = 0
    const signal = {
      aborted: true,
      get reason(): never {
        reads++
        throw cause
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
    try {
      expect(() =>
        service.createQuery({
          backendId: 'reason-pre',
          runtime: createRuntime(),
          signal,
          query: () => 'never-started'
        })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause }))
      expect(reads).toBe(1)
    } finally {
      await host.dispose()
    }
  })

  it('reports a getter failure once when cancellation occurs during query', async () => {
    const { host, service } = await createReactiveServiceFixture({ id: 'reason-during' })
    const cause = new Error('reason getter')
    const reports: unknown[] = []
    let aborted = false
    let listener: (() => void) | undefined
    let reads = 0
    const signal = {
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
      removeEventListener: () => undefined
    }
    try {
      expect(() =>
        service.createQuery({
          backendId: 'reason-during',
          runtime: createRuntime(),
          signal,
          report: (error) => {
            reports.push(error)
          },
          query: () => {
            aborted = true
            listener?.()
            return 'never-settled'
          }
        })
      ).toThrowError(expect.objectContaining({ code: 'ABORTED' }))
      expect(reports).toEqual([cause])
      expect(reads).toBe(1)
    } finally {
      await host.dispose()
    }
  })

  it('reports a getter failure once after registration discovers an abort', async () => {
    const { host, service } = await createReactiveServiceFixture({ id: 'reason-race' })
    const cause = new Error('reason getter')
    const reports: unknown[] = []
    let aborted = false
    let reads = 0
    const signal = {
      get aborted() {
        return aborted
      },
      get reason(): never {
        reads++
        throw cause
      },
      addEventListener: () => {
        aborted = true
      },
      removeEventListener: () => undefined
    }
    try {
      expect(() =>
        service.createQuery({
          backendId: 'reason-race',
          runtime: createRuntime(),
          signal,
          report: (error) => {
            reports.push(error)
          },
          query: () => 'never-started'
        })
      ).toThrowError(expect.objectContaining({ code: 'ABORTED' }))
      expect(reports).toEqual([cause])
      expect(reads).toBe(1)
    } finally {
      await host.dispose()
    }
  })
})
