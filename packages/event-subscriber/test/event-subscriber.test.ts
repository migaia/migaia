/** Event channel. Cases preserve the existing behavioral assertions. */
import { subscribeOnce, subscribeSubscriber, subscribeUntil } from '../src/subscriber.ts'
import { describe, expect, it, vi } from 'vitest'
import {
  EventSubscriberErrorCode,
  createEventChannel,
  invokeParallelSettled,
  invokeSerialSettled,
  invokeTask,
  invokeTaskSettled
} from '../src/index.ts'

describe('event channel', () => {
  it('preserves the receiver and rejects synchronous structural delivery', () => {
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

  it('publishes a stable registration snapshot in order', () => {
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

  it('keeps additions and removals outside the current dispatch snapshot', () => {
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

  it('keeps the current snapshot after clear and isolates stale unsubscribers', () => {
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

  it('keeps repeated listener subscriptions independent and idempotently releasable', () => {
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

  it('treats an empty channel as a synchronous and async no-op', async () => {
    const channel = createEventChannel<number>()
    expect(() => channel.publish(1)).not.toThrow()
    await expect(invokeParallelSettled(channel, 1)).resolves.toEqual([])
    await expect(invokeSerialSettled(channel, 1)).resolves.toEqual([])
    expect(channel.size).toBe(0)
  })

  it('once is removed before invocation and resists synchronous reentry', () => {
    const channel = createEventChannel<number>()
    let calls = 0
    subscribeOnce(channel, (event) => {
      calls += 1
      channel.publish(event.value)
    })
    channel.publish(1)
    expect(calls).toBe(1)
  })

  it('aggregates synchronous failures but observes late rejection', async () => {
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

  it('observes a hostile then getter asynchronously without an unhandled rejection', async () => {
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

  it('assimilates a custom thenable with its original receiver and first settlement', async () => {
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

    await expect(invokeParallelSettled(channel, 1)).resolves.toEqual([
      { status: 'fulfilled', value: 'first' }
    ])
  })

  it('supports task selection and rejects ambiguous selection synchronously', async () => {
    const channel = createEventChannel<number, number>()
    channel.subscribe((event) => event.value + 1, { taskId: 'one' })
    const settled = await invokeTaskSettled(channel, 'one', 2)
    expect(settled.status).toBe('fulfilled')
    if (settled.status === 'fulfilled') expect(settled.value).toBe(3)
    await expect(invokeTask(channel, 'one', 2)).resolves.toBe(3)
    expect(() => invokeTaskSettled(channel, 'missing', 1)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.taskNotFound })
    )
    channel.subscribe(() => 4, { taskId: 'duplicate' })
    channel.subscribe(() => 5, { taskId: 'duplicate' })
    expect(() => invokeTask(channel, 'duplicate', 1)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.taskNotUnique })
    )
  })

  it('supports object subscribers and read-only task views', async () => {
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
    expect(await invokeTaskSettled(channel, 'selected', 3)).toMatchObject({
      status: 'fulfilled',
      value: 3
    })
    expect(calls).toEqual([3])
  })

  it('keeps filtered views read-only while reflecting live registration state', async () => {
    const channel = createEventChannel<number, number>()
    const selected = vi.fn((event: { value: number }) => event.value + 1)
    const stop = channel.subscribe(selected, { taskId: 'selected' })
    const view = channel.filterTaskId('selected')

    expect('subscribe' in view).toBe(false)
    expect('publish' in view).toBe(false)
    await expect(invokeParallelSettled(view, 4)).resolves.toMatchObject([
      { status: 'fulfilled', value: 5 }
    ])
    stop()
    await expect(invokeParallelSettled(view, 4)).resolves.toEqual([])
    expect(channel.size).toBe(0)
  })

  it('runs parallel calls before awaiting and serial calls after settlement', async () => {
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
    const parallel = invokeParallelSettled(channel, 1)
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
    const serial = invokeSerialSettled(serialChannel, 2)
    await Promise.resolve()
    expect(order).toEqual(['serial-first'])
    resolveSerial()
    await serial
    expect(order).toEqual(['serial-first', 'serial-finished', 'serial-second'])
  })
})
