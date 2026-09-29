import { describe, expect, it } from 'vitest'
import { observeAbortSubscription } from '../src/observed-subscription.js'

describe('A5 lifecycle abort listener reason policy', () => {
  it.each([false, true])(
    'reports before callback and contains a throwing sink (%s)',
    (sinkThrows) => {
      const cause = new Error('reason getter')
      const sinkFailure = new Error('sink failure')
      const calls: unknown[] = []
      let listener: (() => void) | undefined
      let reads = 0
      const signal = {
        aborted: false,
        get reason(): never {
          reads++
          throw cause
        },
        addEventListener: (_type: 'abort', callback: () => void) => {
          listener = callback
        },
        removeEventListener: () => {
          calls.push('remove')
        }
      }
      const subscription = observeAbortSubscription(
        signal,
        (reason) => calls.push(['callback', reason]),
        (error) => {
          calls.push(['report', error])
          if (sinkThrows) throw sinkFailure
        }
      )
      expect(() => listener?.()).not.toThrow()
      expect(reads).toBe(1)
      expect(calls).toEqual([['report', cause], ['callback', cause], 'remove'])
      subscription.unsubscribe()
      expect(calls).toHaveLength(3)
    }
  )
})
