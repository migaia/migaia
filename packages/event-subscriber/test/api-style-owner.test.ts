/** Event API style subscription ownership. Cases preserve the existing behavioral assertions. */
import { subscribeOnce, subscribeSubscriber, subscribeUntil } from '../src/subscriber.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createEventChannel,
  EventSubscriberErrorCode,
  invokeParallelSettled
} from '../src/index.js'
import type { IEventContext } from '../src/index.js'
import { createRawSubscriptionOwner } from '../src/internal/subscription.js'
import { normalizeEventApiStyle } from '../src/style.js'

describe('event API style subscription ownership', () => {
  it('rolls back first registration when handle projection fails', () => {
    const first = vi.fn()
    const extend = vi.fn()
    const projectionOriginal = new Error('projection plan failed')
    const stylePlan = {
      get subscribe() {
        throw projectionOriginal
      },
      publish: 'emit',
      unsubscribe: 'off'
    }

    expect(() => createRawSubscriptionOwner(first, extend, stylePlan as never)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.subscriptionHandleProjectionFailed,
        cause: projectionOriginal
      })
    )
    expect(first).toHaveBeenCalledTimes(1)
    expect(extend).not.toHaveBeenCalled()
  })

  it('releases owner registrations in reverse order and preserves both rollback errors', () => {
    const registered: string[] = []
    const released: string[] = []
    const owner = createRawSubscriptionOwner(
      () => {
        released.push('first')
      },
      (...args: never[]) => {
        const name = args[0] as unknown as string
        registered.push(name)
        return () => {
          released.push(name)
        }
      },
      normalizeEventApiStyle('on-emit')
    )
    owner.subscribe('second' as never)
    owner.subscribe('third' as never)
    owner()
    owner()
    expect(registered).toEqual(['second', 'third'])
    expect(released).toEqual(['third', 'second', 'first'])

    const projectionOriginal = new Error('projection failed')
    const rollbackOriginal = new Error('rollback failed')
    let rollbackError: unknown
    try {
      createRawSubscriptionOwner(
        () => {
          throw rollbackOriginal
        },
        () => undefined,
        {
          get subscribe() {
            throw projectionOriginal
          },
          publish: 'emit',
          unsubscribe: 'off'
        } as never
      )
    } catch (error) {
      rollbackError = error
    }
    expect(rollbackError).toBeInstanceOf(AggregateError)
    expect(rollbackError).toMatchObject({
      source: expect.any(String),
      code: EventSubscriberErrorCode.subscriptionHandleProjectionFailed,
      cause: projectionOriginal
    })
    expect((rollbackError as AggregateError).errors).toEqual([projectionOriginal, rollbackOriginal])
  })

  it('keeps helpers and filtered views canonical on styled channels', async () => {
    const channel = createEventChannel<number>({ style: 'on-emit' })
    const onceListener = vi.fn((event: IEventContext<number>) => {
      void event.value
    })
    const onceStop = subscribeOnce(channel, onceListener)
    const subscriberHandle = vi.fn((event: IEventContext<number>) => {
      void event.value
    })
    const subscriberStop = subscribeSubscriber(channel, { handle: subscriberHandle })
    const addAbortListener = vi.fn()
    const removeAbortListener = vi.fn()
    const untilStop = subscribeUntil(
      channel,
      {
        aborted: false,
        addEventListener: addAbortListener,
        removeEventListener: removeAbortListener
      } as never,
      () => undefined
    )

    expect(onceStop).toBeTypeOf('function')
    expect(subscriberStop).toBeTypeOf('function')
    expect(untilStop).toBeTypeOf('function')
    expect('on' in onceStop).toBe(false)
    expect('off' in subscriberStop).toBe(false)
    expect('on' in untilStop).toBe(false)
    channel.emit(3)
    channel.emit(4)
    expect(onceListener).toHaveBeenCalledTimes(1)
    expect(subscriberHandle).toHaveBeenCalledTimes(2)
    onceStop()
    subscriberStop()
    untilStop()
    expect(removeAbortListener).toHaveBeenCalledTimes(1)

    const filteredChannel = createEventChannel<number, number>({ style: 'on-emit' })
    const selectedListener = vi.fn((event: IEventContext<number>) => event.value)
    const selectedStop = filteredChannel.on(selectedListener, { taskId: 'selected' })
    const selected = filteredChannel.filterTaskId('selected')
    expect(Object.keys(selected)).toEqual([])
    expect('on' in selected).toBe(false)
    expect('off' in selected).toBe(false)
    await expect(invokeParallelSettled(selected, 9)).resolves.toMatchObject([
      { status: 'fulfilled', value: 9 }
    ])
    expect(selectedListener).toHaveBeenCalledTimes(1)
    selectedStop()
  })
})
