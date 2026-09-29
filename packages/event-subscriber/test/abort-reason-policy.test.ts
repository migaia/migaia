import { describe, expect, it, vi } from 'vitest'
import { subscribeUntil } from '../src/index.js'
import { EventSubscriberErrorCode } from '../src/error-code.js'

describe('A6 event subscriber reason capture', () => {
  it('ES-T196 caches a getter failure by identity and still releases the subscription', () => {
    const cause = new Error('reason getter')
    let abortListener!: () => void
    let reads = 0
    const release = vi.fn()
    const remove = vi.fn()
    const listener = vi.fn()
    const stop = subscribeUntil(
      { subscribe: () => release } as never,
      {
        aborted: false,
        get reason(): never {
          reads++
          throw cause
        },
        addEventListener: (_type: string, callback: () => void) => {
          abortListener = callback
        },
        removeEventListener: remove
      },
      listener
    )
    let observed: unknown
    try {
      abortListener()
    } catch (error) {
      observed = error
    }
    expect(observed).toMatchObject({ code: EventSubscriberErrorCode.invalidSignal })
    expect((observed as { cause?: unknown }).cause).toBe(cause)
    expect(reads).toBe(1)
    expect(listener).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    expect(() => stop()).not.toThrow()
  })
})
