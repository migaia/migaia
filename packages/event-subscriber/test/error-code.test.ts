import { describe, expect, it } from 'vitest'
import { EVENT_SUBSCRIBER_SOURCE, EventSubscriberErrorCode } from '../src/index.js'

describe('error code contract', () => {
  it('ES-T31 exposes one source and fourteen unique public codes', () => {
    const codes = Object.values(EventSubscriberErrorCode)
    expect(EVENT_SUBSCRIBER_SOURCE).toBe('@migaia/event-subscriber')
    expect(codes).toHaveLength(14)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
