import { describe, expect, it } from 'vitest'
import { createMessageListenerHub } from '../../src/internal/message-listener-hub.js'

describe('message listener hub', () => {
  it('keeps a dispatch snapshot stable across reentrant membership changes', () => {
    const hub = createMessageListenerHub<number>()
    const calls: string[] = []
    const second = () => calls.push('second')
    const first = () => {
      calls.push('first')
      hub.remove(second, () => undefined)
      hub.add(second, () => undefined)
    }
    hub.add(first, () => undefined)
    hub.add(second, () => undefined)
    hub.dispatch(1, (listener) => listener(1))
    expect(calls).toEqual(['first', 'second'])
    expect(hub.size).toBe(2)
  })

  it('does not retain membership when first physical registration fails', () => {
    const hub = createMessageListenerHub<number>()
    const failure = new Error('attach failed')
    expect(() =>
      hub.add(
        () => undefined,
        () => {
          throw failure
        }
      )
    ).toThrow(failure)
    expect(hub.size).toBe(0)
  })

  it('keeps the final listener for retry when physical removal fails', () => {
    const hub = createMessageListenerHub<number>()
    const listener = () => undefined
    hub.add(listener, () => undefined)
    const failure = new Error('detach failed')
    expect(() =>
      hub.remove(listener, () => {
        throw failure
      })
    ).toThrow(failure)
    expect(hub.has(listener)).toBe(true)
    expect(hub.remove(listener, () => undefined)).toBe(true)
    expect(hub.size).toBe(0)
  })
})
