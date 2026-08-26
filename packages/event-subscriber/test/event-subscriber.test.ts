import { describe, expect, it, vi } from 'vitest'
import {
  EventSubscriberErrorCode,
  createEventChannel,
  createEventHub,
  publishParallelSettled,
  publishSerialSettled,
  publishTask,
  publishTaskSettled,
  subscribeSubscriber,
  subscribeUntil
} from '../src/index.js'

describe('event channel', () => {
  it('ES-T28 preserves the receiver and rejects synchronous structural delivery', () => {
    const release = vi.fn()
    const channel = {
      marker: 7,
      subscribe(this: { marker: number }, callback: (event: { value: number }) => void) {
        expect(this.marker).toBe(7)
        callback({ value: 1 })
        return release
      }
    }

    expect(() =>
      subscribeUntil(
        channel as never,
        { aborted: false, addEventListener: () => undefined, removeEventListener: () => undefined },
        () => undefined
      )
    ).toThrowError(expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel }))
    expect(release).toHaveBeenCalledOnce()
  })

  it('ES-T03 publishes a stable registration snapshot in order', () => {
    const channel = createEventChannel<number, number>()
    const calls: number[] = []
    let stopSecond: () => void = () => undefined
    channel.subscribe((event) => {
      calls.push(event.value)
      stopSecond()
      channel.subscribe((nested) => calls.push(nested.value + 10))
      return 0
    })
    stopSecond = channel.subscribe((event) => {
      calls.push(event.value + 1)
      return 0
    })
    channel.publish(1)
    expect(calls).toEqual([1, 2])
    channel.publish(2)
    expect(calls).toEqual([1, 2, 2, 12])
  })

  it('ES-T06 keeps additions and removals outside the current dispatch snapshot', () => {
    const channel = createEventChannel<number>()
    const calls: string[] = []
    let stopSecond!: () => void
    channel.subscribe(() => {
      calls.push('first')
      stopSecond()
      channel.subscribe(() => {
        calls.push('added')
      })
    })
    stopSecond = channel.subscribe(() => {
      calls.push('second')
    })

    channel.publish(1)
    expect(calls).toEqual(['first', 'second'])
    channel.publish(2)
    expect(calls).toEqual(['first', 'second', 'first', 'added'])
  })

  it('ES-T29 keeps the current snapshot after clear and isolates stale unsubscribers', () => {
    const channel = createEventChannel<number>()
    const calls: string[] = []
    let releaseFirst!: () => void
    let releaseSecond!: () => void

    releaseFirst = channel.subscribe(() => {
      calls.push('first')
      channel.clear()
      releaseSecond()
    })
    releaseSecond = channel.subscribe(() => {
      calls.push('second')
    })

    channel.publish(1)
    expect(calls).toEqual(['first', 'second'])
    expect(channel.size).toBe(0)

    const releaseNew = channel.subscribe(() => {
      calls.push('new')
    })
    releaseFirst()
    releaseSecond()
    expect(channel.size).toBe(1)

    channel.publish(2)
    expect(calls).toEqual(['first', 'second', 'new'])
    releaseNew()
  })

  it('ES-T02 keeps repeated listener subscriptions independent and idempotently releasable', () => {
    const channel = createEventChannel<number>()
    const listener = vi.fn()
    const first = channel.subscribe(listener)
    const second = channel.subscribe(listener)

    expect(channel.size).toBe(2)
    first()
    first()
    expect(channel.size).toBe(1)
    channel.publish(1)
    expect(listener).toHaveBeenCalledOnce()
    second()
    expect(channel.size).toBe(0)
  })

  it('ES-T07 treats an empty channel as a synchronous and async no-op', async () => {
    const channel = createEventChannel<number>()
    expect(() => channel.publish(1)).not.toThrow()
    await expect(publishParallelSettled(channel, 1)).resolves.toEqual([])
    await expect(publishSerialSettled(channel, 1)).resolves.toEqual([])
    expect(channel.size).toBe(0)
  })

  it('ES-T08 once is removed before invocation and resists synchronous reentry', () => {
    const channel = createEventChannel<number>()
    let calls = 0
    channel.subscribeOnce((event) => {
      calls += 1
      channel.publish(event.value)
    })
    channel.publish(1)
    expect(calls).toBe(1)
  })

  it('ES-T04 aggregates synchronous failures but observes late rejection', async () => {
    const report = vi.fn()
    const channel = createEventChannel<number>({ report })
    const syncFailure = new Error('sync')
    const lateFailure = new Error('late')
    channel.subscribe(() => {
      throw syncFailure
    })
    channel.subscribe(() => Promise.reject(lateFailure))
    expect(() => channel.publish(1)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.publishFailed })
    )
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce())
    expect(report.mock.calls[0][0].error).toBe(lateFailure)
  })

  it('ES-T05 observes a hostile then getter asynchronously without an unhandled rejection', async () => {
    const report = vi.fn()
    const channel = createEventChannel<number>({ report })
    const getterFailure = new Error('then getter')
    channel.subscribe(() => {
      const hostileThenable = {}
      const thenProperty = ['t', 'h', 'e', 'n'].join('')
      Object.defineProperty(hostileThenable, thenProperty, {
        get() {
          throw getterFailure
        }
      })
      return hostileThenable as never
    })
    expect(() => channel.publish(1)).not.toThrow()
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce())
    expect(report.mock.calls[0][0].error).toBe(getterFailure)
  })

  it('ES-T80 assimilates a custom thenable with its original receiver and first settlement', async () => {
    const channel = createEventChannel<number, string>()
    const thenable = { marker: 'original' }
    const thenProperty = ['t', 'h', 'e', 'n'].join('')
    Object.defineProperty(thenable, thenProperty, {
      value(
        this: { marker: string },
        resolve: (value: string) => void,
        reject: (error: unknown) => void
      ) {
        expect(this.marker).toBe('original')
        resolve('first')
        reject(new Error('late second settlement'))
      }
    })
    channel.subscribe(() => thenable as never)

    await expect(publishParallelSettled(channel, 1)).resolves.toEqual([
      { status: 'fulfilled', value: 'first' }
    ])
  })

  it('ES-T39 supports task selection and rejects ambiguous selection synchronously', async () => {
    const channel = createEventChannel<number, number>()
    channel.subscribe((event) => event.value + 1, { taskId: 'one' })
    const settled = await publishTaskSettled(channel, 'one', 2)
    expect(settled.status).toBe('fulfilled')
    if (settled.status === 'fulfilled') expect(settled.value).toBe(3)
    await expect(publishTask(channel, 'one', 2)).resolves.toBe(3)
    expect(() => publishTaskSettled(channel, 'missing', 1)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.taskNotFound })
    )
    channel.subscribe(() => 4, { taskId: 'duplicate' })
    channel.subscribe(() => 5, { taskId: 'duplicate' })
    expect(() => publishTask(channel, 'duplicate', 1)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.taskNotUnique })
    )
  })

  it('ES-T22 supports object subscribers and read-only task views', async () => {
    const channel = createEventChannel<number, number>()
    const calls: number[] = []
    const subscriber = {
      multiplier: 2,
      handle(event: { value: number }) {
        calls.push(this.multiplier)
        return event.value * this.multiplier
      }
    }
    subscribeSubscriber(channel, subscriber)
    channel.subscribe(
      (event) => {
        calls.push(event.value)
        return event.value
      },
      { taskId: 'selected' }
    )
    const view = channel.filterTaskId('selected')

    expect('subscribe' in view).toBe(false)
    expect(await publishTaskSettled(channel, 'selected', 3)).toMatchObject({
      status: 'fulfilled',
      value: 3
    })
    expect(calls).toEqual([3])
  })

  it('ES-T38 keeps filtered views read-only while reflecting live registration state', async () => {
    const channel = createEventChannel<number, number>()
    const selected = vi.fn((event: { value: number }) => event.value + 1)
    const stop = channel.subscribe(selected, { taskId: 'selected' })
    const view = channel.filterTaskId('selected')

    expect('subscribe' in view).toBe(false)
    expect('publish' in view).toBe(false)
    await expect(publishParallelSettled(view, 4)).resolves.toMatchObject([
      { status: 'fulfilled', value: 5 }
    ])
    stop()
    await expect(publishParallelSettled(view, 4)).resolves.toEqual([])
    expect(channel.size).toBe(0)
  })

  it('ES-T11 runs parallel calls before awaiting and serial calls after settlement', async () => {
    const channel = createEventChannel<number, number>()
    const order: string[] = []
    let resolveParallel!: () => void
    const parallelGate = new Promise<void>((resolve) => {
      resolveParallel = resolve
    })
    channel.subscribe(async (event) => {
      order.push(`start-${event.value}`)
      await (event.value === 1 ? parallelGate : new Promise<void>(() => undefined))
      order.push('finish-first')
      return 1
    })
    channel.subscribe(() => {
      order.push('second')
      return 2
    })
    const parallel = publishParallelSettled(channel, 1)
    expect(order).toEqual(['start-1', 'second'])
    resolveParallel()
    await parallel
    order.length = 0
    let resolveSerial!: () => void
    const serialGate = new Promise<void>((resolve) => {
      resolveSerial = resolve
    })
    const serialChannel = createEventChannel<number, number>()
    serialChannel.subscribe(async () => {
      order.push('serial-first')
      await serialGate
      order.push('serial-finished')
      return 1
    })
    serialChannel.subscribe(() => {
      order.push('serial-second')
      return 2
    })
    const serial = publishSerialSettled(serialChannel, 2)
    await Promise.resolve()
    expect(order).toEqual(['serial-first'])
    resolveSerial()
    await serial
    expect(order).toEqual(['serial-first', 'serial-finished', 'serial-second'])
  })
})

describe('abort overlay', () => {
  it('ES-T54 marks canonical event context aborted and releases once on signal abort', () => {
    let abortListener!: () => void
    const remove = vi.fn()
    const signal = {
      aborted: false,
      reason: 'cancelled',
      addEventListener: vi.fn((_type: 'abort', listener: () => void) => {
        abortListener = listener
      }),
      removeEventListener: remove
    }
    const channel = createEventChannel<number>()
    const release = subscribeUntil(channel, signal, (event) => {
      expect(event.aborted).toBe(false)
      abortListener()
      expect(event.aborted).toBe(true)
      expect(event.abortReason).toBe('cancelled')
    })

    channel.publish(1)
    expect(channel.size).toBe(0)
    release()
    expect(remove).toHaveBeenCalledOnce()
  })

  it('ES-T32 releases a structural registration when abort fires during listener installation', () => {
    let abortListener!: () => void
    const release = vi.fn()
    const signal = {
      aborted: false,
      reason: 'during-install',
      addEventListener(_type: 'abort', listener: () => void) {
        abortListener = listener
        listener()
      },
      removeEventListener: vi.fn()
    }
    const channel = {
      subscribe() {
        return release
      }
    }

    subscribeUntil(channel as never, signal, () => undefined)
    abortListener()

    expect(release).toHaveBeenCalledOnce()
  })

  it('ES-T45 copies reason once and exposes it to a running structural subscription', () => {
    let abortListener!: () => void
    let reasonReads = 0
    const reason = new Error('cancel')
    const signal = {
      get aborted() {
        return false
      },
      get reason() {
        reasonReads += 1
        return reason
      },
      addEventListener(_type: 'abort', listener: () => void) {
        abortListener = listener
      },
      removeEventListener() {
        abortListener = () => undefined
      }
    }
    let subscribed!: (event: {
      value: number
      aborted: boolean
      abortReason: unknown
      abort(): void
      taskId: string | undefined
      setTaskId(taskId: string | undefined): void
    }) => void
    const listener = vi.fn((event: { aborted: boolean; abortReason: unknown }) => {
      abortListener()
      expect(event.aborted).toBe(true)
      expect(event.abortReason).toBe(reason)
    })
    const channel = {
      subscribe(
        callback: (event: {
          value: number
          aborted: boolean
          abortReason: unknown
          abort(): void
          taskId: string | undefined
          setTaskId(taskId: string | undefined): void
        }) => void
      ) {
        subscribed = callback
        return () => undefined
      }
    }
    subscribeUntil(channel as never, signal, listener as never)
    subscribed({
      value: 1,
      aborted: false,
      abortReason: undefined,
      abort: () => undefined,
      taskId: undefined,
      setTaskId: () => undefined
    })
    expect(reasonReads).toBe(1)
  })
})

describe('hub', () => {
  it('ES-T33 keeps total size exact across clear and stale unsubscribe', () => {
    const hub = createEventHub<{ message: string }>()
    const stop = hub.subscribe('message', () => undefined)
    expect(hub.size()).toBe(1)
    hub.clear('message')
    expect(hub.size()).toBe(0)
    stop()
    expect(hub.size()).toBe(0)
  })

  it('ES-T10 keeps string, number, and symbol keys isolated', () => {
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

  it('ES-T34 protects a recreated hub channel from a stale disposer', () => {
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

  it('ES-T59 decrements total size once when event abort deactivates a registration', () => {
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

  it('ES-T57 separates outer and reentrant task snapshots', async () => {
    const channel = createEventChannel<number>()
    const calls: string[] = []
    let reentered = false
    channel.subscribe(
      (event) => {
        calls.push(`outer:${event.taskId}`)
        event.setTaskId('new')
        if (!reentered) {
          reentered = true
          void publishTaskSettled(channel, 'new', event.value).then((result) => {
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
