import { describe, expect, it } from 'vitest'
import { createEventChannel, EventDispatchPolicy } from '../src/index.js'

describe('SWV2-B00 event ownership reset', () => {
  it('ES-T122 SWV2-T45 preserves canonical and explicit queued nested publish traces', () => {
    const channel = createEventChannel<number>()
    const trace: string[] = []

    channel.subscribe((event) => {
      trace.push(`first:${event.value}`)
      if (event.value === 1) channel.publish(2)
    })
    channel.subscribe((event) => {
      trace.push(`second:${event.value}`)
    })

    channel.publish(1)

    expect(trace).toEqual(['first:1', 'first:2', 'second:2', 'second:1'])

    const queuedChannel = createEventChannel<number>({
      dispatchPolicy: EventDispatchPolicy.queued
    })
    const queuedTrace: string[] = []

    queuedChannel.subscribe((event) => {
      queuedTrace.push(`first:${event.value}`)
      if (event.value === 1) queuedChannel.publish(2)
    })
    queuedChannel.subscribe((event) => {
      queuedTrace.push(`second:${event.value}`)
    })

    queuedChannel.publish(1)

    expect(queuedTrace).toEqual(['first:1', 'second:1', 'first:2', 'second:2'])
  })
})
