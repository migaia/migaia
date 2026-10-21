import { describe, expect, it } from 'vitest'
import { createRpcDevtools } from '../../src/index.js'
import { collectorView } from './fixture.js'

describe('collector bounded interning', () => {
  it('records twenty methods with overflow id 0 while retaining earlier interned names', () => {
    /** The shared string table is deliberately smaller than the method input vocabulary. */
    const devtools = createRpcDevtools({ maxInterned: 8, maxEvents: 20 })
    /** Only endpoint and method consume the long-lived name table in this bounded fixture. */
    const view = collectorView()
    view.senderId = undefined
    view.targetId = undefined
    view.receiverId = undefined
    view.peerId = undefined
    view.trace = undefined
    view.carrier = undefined
    try {
      for (let i = 0; i < 20; i++) {
        view.seq = i + 1
        view.messageId = `bounded-message-${i}`
        view.method = `bounded-method-${i}`
        devtools.emit(view)
      }
      /** Names at the beginning survive later overflow; missing new names share the overflow id. */
      const page = devtools.query()
      expect(page.events).toHaveLength(20)
      expect(page.events[0]!.method).toBe('bounded-method-0')
      expect(page.events[0]!.endpointId).toBe(view.endpointId)
      expect(page.events[19]!.method).toBe(page.events[18]!.method)
      expect(page.events[19]!.method).not.toBe('bounded-method-19')
      expect(page.counters.internOverflow).toBeGreaterThan(0)
      expect(page.events.map((event) => event.messageId)).toEqual(
        Array.from({ length: 20 }, (_, index) => `bounded-message-${index}`)
      )
    } finally {
      devtools.close()
    }
  })
})
