/** Event-subscriber boundary hardening. Cases preserve the existing behavioral assertions. */
import { subscribeOnce, subscribeSubscriber } from '../src/subscriber.ts'
import { describe, expect, it, vi } from 'vitest'
import {
  EventSubscriberErrorCode,
  createEventChannel,
  createEventHub,
  invokeParallelSettled
} from '../src/index.ts'

describe('event-subscriber boundary hardening', () => {
  it('rejects malformed public boundaries before registration', () => {
    expect(() => createEventChannel({ report: true } as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidReporter })
    )
    expect(() => createEventChannel().subscribe(null as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidListener })
    )
    expect(() => subscribeOnce({ subscribe: null } as never, () => undefined)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel })
    )
  })

  it('preserves a hostile option getter as the primary coded error', () => {
    const failure = new Error('option getter')
    const options = {
      get taskId() {
        throw failure
      }
    }
    try {
      createEventChannel().subscribe(() => undefined, options as never)
      throw new Error('expected hostile getter to throw')
    } catch (error) {
      expect(error).toBe(failure)
      expect(error).toMatchObject({ code: EventSubscriberErrorCode.invalidOptions })
    }
  })

  it('preserves class private state and subscriber receiver identity', () => {
    const channel = createEventChannel<number, number>()
    class Subscriber {
      #multiplier = 3
      #receiver!: Subscriber

      handle(event: { value: number }): number {
        this.#receiver = this
        return this.#multiplier * event.value
      }

      receiver(): Subscriber {
        return this.#receiver
      }
    }
    const subscriber = new Subscriber()
    subscribeSubscriber(channel, subscriber)
    channel.publish(2)
    expect(subscriber.receiver()).toBe(subscriber)
  })

  it('uses direct structural method lookup without cached method identity', () => {
    const release = vi.fn()
    let reads = 0
    const channel = {
      get subscribe() {
        reads += 1
        return function (this: { marker: number }, callback: () => void) {
          expect(this.marker).toBe(7)
          callback()
          return release
        }
      },
      marker: 7
    }
    expect(() => subscribeOnce(channel as never, () => undefined)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidChannel })
    )
    expect(reads).toBe(1)
    expect(release).toHaveBeenCalledOnce()
  })

  it('keeps hub key routing and size accounting exact', () => {
    const hub = createEventHub<{ alpha: number; beta: string }>()
    const alpha = vi.fn()
    const beta = vi.fn()
    const stopAlpha = hub.subscribe('alpha', (event) => {
      alpha(event.value)
    })
    hub.subscribe('beta', (event) => beta(event.value))
    hub.publish('alpha', 1)
    hub.publish('beta', 'two')
    expect(alpha).toHaveBeenCalledWith(1)
    expect(beta).toHaveBeenCalledWith('two')
    expect(hub.size()).toBe(2)
    stopAlpha()
    expect(hub.size('alpha')).toBe(0)
    hub.clear()
    expect(hub.size()).toBe(0)
  })

  it('validates hub listeners before lazy channel creation and releases channel state', async () => {
    const report = vi.fn()
    const hub = createEventHub<{ alpha: number }>({ report })
    expect(() => hub.subscribe('alpha', null as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidListener })
    )
    expect(hub.size()).toBe(0)
    expect(hub.size('alpha')).toBe(0)

    const stop = hub.subscribe('alpha', () => undefined)
    stop()
    expect(hub.size()).toBe(0)
    const currentStop = hub.subscribe('alpha', () => Promise.reject(new Error('late failure')))
    hub.publish('alpha', 1)
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce())
    expect(report.mock.calls[0][0].key).toBe('alpha')
    currentStop()
  })

  it('codes revoked hub options proxies and preserves the proxy failure', () => {
    const revocable = Proxy.revocable({}, {})
    revocable.revoke()
    expect(() => createEventHub(revocable.proxy as never)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidOptions,
        cause: expect.any(TypeError)
      })
    )
  })

  it('does not invoke user cleanup from clear and makes unsubscribe idempotent', () => {
    const channel = createEventChannel<number>()
    const listener = vi.fn()
    const stop = channel.subscribe(listener)
    channel.clear()
    stop()
    stop()
    channel.publish(1)
    expect(listener).not.toHaveBeenCalled()
    expect(channel.size).toBe(0)
  })

  it('keeps event abort state live through synchronous reentry', () => {
    const channel = createEventChannel<number>()
    const calls: string[] = []
    channel.subscribe((event) => {
      calls.push(`outer:${event.aborted}`)
      event.abort('cancelled')
      calls.push(`after:${event.aborted}:${event.abortReason}`)
      channel.publish(event.value)
    })
    channel.publish(1)
    expect(calls).toEqual(['outer:false', 'after:true:cancelled'])
    expect(channel.size).toBe(0)
  })

  it('ignores task retagging after a registration becomes inactive', async () => {
    const channel = createEventChannel<number>()
    let release!: () => void
    const calls: string[] = []
    release = channel.subscribe(
      (event) => {
        calls.push(event.taskId ?? 'none')
        event.setTaskId('retagged')
      },
      { taskId: 'initial' }
    )
    release()
    await expect(invokeParallelSettled(channel.filterTaskId('retagged'), 1)).resolves.toEqual([])
    expect(calls).toEqual([])
  })
})
