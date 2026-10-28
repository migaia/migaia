/** Hub. Cases preserve the existing behavioral assertions. */
import { describe, expect, it } from 'vitest'
import { createEventChannel, createEventHub, invokeTaskSettled } from '../src/index.js'

describe('hub', () => {
  it('keeps total size exact across clear and stale unsubscribe', () => {
    const hub = createEventHub<{ message: string }>()
    const stop = hub.subscribe('message', () => undefined)
    expect(hub.size()).toBe(1)
    hub.clear('message')
    expect(hub.size()).toBe(0)
    stop()
    expect(hub.size()).toBe(0)
  })

  it('keeps string, number, and symbol keys isolated', () => {
    const symbolKey = Symbol('message')
    const hub = createEventHub<{ message: string; 1: number; [symbolKey]: boolean }>()
    const calls = { string: 0, number: 0, symbol: 0 }
    hub.subscribe('message', () => {
      calls.string += 1
    })
    hub.subscribe(1, () => {
      calls.number += 1
    })
    hub.subscribe(symbolKey, () => {
      calls.symbol += 1
    })

    hub.publish('message', 'text')
    hub.publish(1, 1)
    hub.publish(symbolKey, true)
    expect(calls).toEqual({ string: 1, number: 1, symbol: 1 })
    expect(hub.size('message')).toBe(1)
    expect(hub.size(1)).toBe(1)
    expect(hub.size(symbolKey)).toBe(1)
  })

  it('protects a recreated hub channel from a stale disposer', () => {
    const hub = createEventHub<{ message: string }>()
    const oldStop = hub.subscribe('message', () => undefined)
    hub.clear('message')
    const currentStop = hub.subscribe('message', () => undefined)

    oldStop()
    expect(hub.size('message')).toBe(1)
    expect(hub.size()).toBe(1)
    currentStop()
    expect(hub.size()).toBe(0)
  })

  it('decrements total size once when event abort deactivates a registration', () => {
    const hub = createEventHub<{ message: string }>()
    let firstEvent!: { abort(reason?: unknown): void }
    const oldStop = hub.subscribe('message', (event) => {
      firstEvent = event
      event.abort('first')
    })

    hub.publish('message', 'one')
    expect(hub.size('message')).toBe(0)
    firstEvent.abort('repeat')
    oldStop()
    oldStop()
    expect(hub.size()).toBe(0)

    let secondEvent!: { abort(reason?: unknown): void }
    const abortStop = hub.subscribe('message', (event) => {
      secondEvent = event
      event.abort('second')
    })
    const keepStop = hub.subscribe('message', () => undefined)

    hub.publish('message', 'two')
    expect(hub.size('message')).toBe(1)
    secondEvent.abort('repeat')
    abortStop()
    abortStop()
    expect(hub.size()).toBe(1)

    hub.clear('message')
    expect(hub.size()).toBe(0)
    keepStop()

    const recreatedStop = hub.subscribe('message', () => undefined)
    oldStop()
    abortStop()
    expect(hub.size('message')).toBe(1)
    recreatedStop()
    expect(hub.size()).toBe(0)
  })

  it('separates outer and reentrant task snapshots', async () => {
    const channel = createEventChannel<number>()
    const calls: string[] = []
    let reentered = false
    channel.subscribe(
      (event) => {
        calls.push(`outer:${event.taskId}`)
        event.setTaskId('new')
        if (!reentered) {
          reentered = true
          void invokeTaskSettled(channel, 'new', event.value).then((result) => {
            if (result.status === 'fulfilled') calls.push(`inner:${result.status}`)
          })
        }
      },
      { taskId: 'old' }
    )

    channel.publish(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(['outer:old', 'outer:new', 'inner:fulfilled'])
  })
})
