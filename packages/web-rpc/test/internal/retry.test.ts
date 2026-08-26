import { describe, expect, it } from 'vitest'
import { executeWithRetry } from '../../src/internal/retry'

describe('retry utility', () => {
  it('uses total attempt count and cancellable delay', async () => {
    let attempts = 0
    await expect(
      executeWithRetry({
        maxAttempts: 2,
        signals: [],
        createAbortError: () => new Error('aborted'),
        createTimeoutError: () => new Error('timeout'),
        attempt: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('temporary')
          return 'ok'
        },
        decide: async () => ({ retry: true, delayMs: 0 })
      })
    ).resolves.toBe('ok')
    expect(attempts).toBe(2)
  })
  it('cancels an async retry policy that never settles', async () => {
    const controller = new AbortController()
    let attempts = 0
    const pending = executeWithRetry({
      maxAttempts: 2,
      signals: [controller.signal],
      createAbortError: () => new Error('aborted'),
      createTimeoutError: () => new Error('timeout'),
      attempt: async () => {
        attempts += 1
        throw new Error('temporary')
      },
      decide: () => new Promise<never>(() => undefined)
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
    expect(attempts).toBe(1)
  })
  it('forwards backoff cleanup diagnostics without changing retry results', async () => {
    const diagnostics: unknown[] = []
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {
        throw new Error('remove failed')
      }
    } as unknown as AbortSignal
    let attempts = 0
    await expect(
      executeWithRetry({
        maxAttempts: 2,
        signals: [signal],
        createAbortError: () => new Error('aborted'),
        createTimeoutError: () => new Error('timeout'),
        onDiagnostic: (error) => diagnostics.push(error),
        attempt: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('temporary')
          return 'ok'
        },
        decide: async () => ({ retry: true, delayMs: 0 })
      })
    ).resolves.toBe('ok')
    expect(diagnostics).toHaveLength(1)
  })
  it('stops without another attempt when retry policy throws', async () => {
    let attempts = 0
    await expect(
      executeWithRetry({
        maxAttempts: 3,
        signals: [],
        createAbortError: () => new Error('aborted'),
        createTimeoutError: () => new Error('timeout'),
        attempt: async () => {
          attempts += 1
          throw new Error('attempt failed')
        },
        decide: async () => {
          throw new Error('policy failed')
        }
      })
    ).rejects.toThrow('policy failed')
    expect(attempts).toBe(1)
  })
  it('stops without another attempt when retry backoff rejects', async () => {
    let attempts = 0
    await expect(
      executeWithRetry({
        maxAttempts: 3,
        signals: [],
        createAbortError: () => new Error('aborted'),
        createTimeoutError: () => new Error('timeout'),
        attempt: async () => {
          attempts += 1
          throw new Error('attempt failed')
        },
        decide: async () => ({ retry: true, delayMs: -1 })
      })
    ).rejects.toThrow('delay must be non-negative')
    expect(attempts).toBe(1)
  })
})
