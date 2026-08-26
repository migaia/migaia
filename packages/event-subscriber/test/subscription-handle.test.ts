import { describe, expect, it, vi } from 'vitest'
import {
  createEventChannel,
  createEventHub,
  EVENT_SUBSCRIBER_SOURCE,
  EventSubscriberErrorCode
} from '../src/index.js'

describe('callable subscription handles', () => {
  it('ES-T100 keeps callable self-alias and chain identity', () => {
    const channel = createEventChannel<number>()
    const handle = channel.subscribe(() => undefined)
    expect(handle.subscribe(() => undefined)).toBe(handle)
    expect(handle.unsubscribe).toBe(handle)
    expect(Object.getOwnPropertyDescriptor(handle, 'unsubscribe')).toMatchObject({
      writable: false,
      configurable: false,
      enumerable: false
    })
    expect(channel.size).toBe(2)
    handle()
    expect(channel.size).toBe(0)
  })

  it('ES-T107 rejects both closed entry points before hostile validation and mutates nothing', () => {
    for (const close of ['handle', 'unsubscribe'] as const) {
      const channel = createEventChannel<number>()
      const handle = channel.subscribe(() => undefined)
      const before = channel.size
      if (close === 'handle') handle()
      else handle.unsubscribe()
      const hostile = {
        get taskId() {
          throw new Error('must not read')
        }
      }
      for (const invoke of [
        () => handle.subscribe(null as never, hostile as never),
        () => handle.subscribe(() => undefined)
      ]) {
        try {
          invoke()
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
          expect(error).toMatchObject({
            source: EVENT_SUBSCRIBER_SOURCE,
            code: EventSubscriberErrorCode.subscriptionClosed,
            message: 'event-subscriber subscription is closed'
          })
          expect((error as Error).stack).toBeTypeOf('string')
          expect((error as Error).cause).toBeUndefined()
        }
      }
      expect(channel.size).toBe(before - 1)
    }
    for (const close of ['handle', 'unsubscribe'] as const) {
      const hub = createEventHub<{ ready: number }>()
      const hubHandle = hub.subscribe('ready', () => undefined)
      const beforeKey = hub.size('ready')
      const beforeTotal = hub.size()
      if (close === 'handle') hubHandle()
      else hubHandle.unsubscribe()
      const hostile = {
        get length() {
          throw new Error('must not read')
        }
      }
      expect(() => hubHandle.subscribe('ready' as never, hostile as never)).toThrowError(
        expect.objectContaining({
          source: EVENT_SUBSCRIBER_SOURCE,
          code: EventSubscriberErrorCode.subscriptionClosed
        })
      )
      expect(hub.size('ready')).toBe(beforeKey - 1)
      expect(hub.size()).toBe(beforeTotal - 1)
    }
  })

  it('ES-T103 keeps hub duplicate keys chain-local', () => {
    const hub = createEventHub<{ ready: number }>()
    const handle = hub.subscribe('ready', () => undefined)
    expect((handle as any).subscribe('ready', () => undefined)).toBe(handle)
    const independent = hub.subscribe('ready', () => undefined)
    expect(hub.size('ready')).toBe(3)
    handle()
    expect(hub.size('ready')).toBe(1)
    independent()
    expect(hub.size('ready')).toBe(0)
  })

  it('ES-T104 keeps independent hub chains isolated', () => {
    const hub = createEventHub<{ ready: number }>()
    const first = vi.fn()
    const second = vi.fn()
    const left = hub.subscribe('ready', (event) => first(event.value))
    const right = hub.subscribe('ready', (event) => second(event.value))
    hub.publish('ready', 7)
    left()
    hub.publish('ready', 8)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith(8)
    right.unsubscribe()
    expect(hub.size()).toBe(0)
  })

  it('ES-T108 makes stale clear handles harmless after recreation', () => {
    const channel = createEventChannel<number>()
    const staleChannel = channel.subscribe(() => undefined)
    channel.clear()
    const currentChannel = channel.subscribe(() => undefined)
    staleChannel()
    expect(channel.size).toBe(1)
    currentChannel()
    const hub = createEventHub<{ ready: number }>()
    const stale = hub.subscribe('ready', () => undefined)
    hub.clear('ready')
    const current = hub.subscribe('ready', () => undefined)
    stale()
    expect(hub.size('ready')).toBe(1)
    hub.clear()
    const recreated = hub.subscribe('ready', () => undefined)
    stale()
    expect(hub.size('ready')).toBe(1)
    recreated()
    current()
    expect(hub.size()).toBe(0)
  })

  it('ES-T119 preserves mixed-key chain state across clear and stale release races', () => {
    const hub = createEventHub<{ alpha: number; beta: number }>()
    const stale = hub.subscribe('alpha', () => undefined).subscribe('beta', () => undefined)
    const currentAlpha = hub.subscribe('alpha', () => undefined)
    hub.clear('alpha')
    const recreatedAlpha = hub.subscribe('alpha', () => undefined)
    stale()
    expect(hub.size('alpha')).toBe(1)
    expect(hub.size('beta')).toBe(0)
    currentAlpha()
    recreatedAlpha()
    expect(hub.size()).toBe(0)
  })

  it('ES-T120 rejects real Channel and Hub hostile admission without partial mutation', () => {
    const channel = createEventChannel<number>()
    const listener = vi.fn()
    const handle = channel.subscribe(listener)
    const originalOptionsError = new Error('options getter')
    const options = {
      get taskId() {
        throw originalOptionsError
      }
    }
    const optionsError = (() => {
      try {
        handle.subscribe(() => undefined, options as never)
      } catch (error) {
        return error
      }
      throw new Error('expected options admission error')
    })()
    expect(optionsError).toBe(originalOptionsError)
    expect(optionsError).toMatchObject({
      source: EVENT_SUBSCRIBER_SOURCE,
      code: EventSubscriberErrorCode.invalidOptions
    })
    expect(optionsError).toBeInstanceOf(Error)
    expect((optionsError as Error).message).toBe('options getter')
    expect((optionsError as Error).stack).toBeTypeOf('string')
    expect(channel.size).toBe(1)
    const invalidChannelListener = (() => {
      try {
        handle.subscribe(null as never)
      } catch (error) {
        return error
      }
      throw new Error('expected listener admission error')
    })()
    expect(invalidChannelListener).toMatchObject({
      source: EVENT_SUBSCRIBER_SOURCE,
      code: EventSubscriberErrorCode.invalidListener
    })
    expect((invalidChannelListener as Error).stack).toBeTypeOf('string')
    expect(channel.size).toBe(1)
    const hub = createEventHub<{ ready: number }>()
    const hubHandle = hub.subscribe('ready', listener)
    const invalidListenerError = (() => {
      try {
        ;(hubHandle as any).subscribe('ready', null as never)
      } catch (error) {
        return error
      }
      throw new Error('expected listener admission error')
    })()
    expect(invalidListenerError).toBeInstanceOf(TypeError)
    expect(invalidListenerError).toMatchObject({
      source: EVENT_SUBSCRIBER_SOURCE,
      code: EventSubscriberErrorCode.invalidListener
    })
    const invalidKeyError = (() => {
      try {
        hubHandle.subscribe({} as never, listener)
      } catch (error) {
        return error
      }
      throw new Error('expected key admission error')
    })()
    expect(invalidKeyError).toBeInstanceOf(TypeError)
    expect(invalidKeyError).toMatchObject({
      source: EVENT_SUBSCRIBER_SOURCE,
      code: EventSubscriberErrorCode.invalidEventKey
    })
    expect((invalidKeyError as Error).message).toBe('event-subscriber event key is invalid')
    expect((invalidKeyError as Error).stack).toBeTypeOf('string')
    expect((invalidListenerError as Error).message).toBe(
      'event-subscriber listener must be a function'
    )
    expect((invalidListenerError as Error).stack).toBeTypeOf('string')
    expect(hub.size('ready')).toBe(1)
    expect(hub.size()).toBe(1)
    hub.publish('ready', 1)
    expect(listener).toHaveBeenCalledTimes(1)
    hubHandle()
    let reads = 0
    const revokedTarget = Object.create(null) as object
    const revokedProxy = Proxy.revocable(revokedTarget, {
      get() {
        reads += 1
        throw new Error('closed trap read')
      },
      has() {
        reads += 1
        throw new Error('closed trap has')
      }
    })
    expect(() => hubHandle.subscribe(revokedProxy.proxy as never, listener)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.subscriptionClosed })
    )
    revokedProxy.revoke()
    expect(reads).toBe(0)
    expect(hub.size()).toBe(0)
    handle()
  })

  it('ES-T121 table-driven hostile Hub admission preserves error chain and zero mutation', () => {
    const hub = createEventHub<{ ready: number }>()
    const delivered = vi.fn()
    const handle = hub.subscribe('ready', delivered)
    const makeRevoked = (): {
      readonly proxy: object
      readonly reads: () => number
      revoke: () => void
    } => {
      let reads = 0
      const revocable = Proxy.revocable(Object.create(null), {
        get() {
          reads += 1
          return undefined
        },
        has() {
          reads += 1
          return false
        }
      })
      return { proxy: revocable.proxy, reads: () => reads, revoke: revocable.revoke }
    }
    const openCases = [
      {
        name: 'object key',
        invoke: () => handle.subscribe({} as never, delivered),
        code: EventSubscriberErrorCode.invalidEventKey,
        type: TypeError
      },
      {
        name: 'revoked key',
        invoke: () => {
          const hostile = makeRevoked()
          hostile.revoke()
          return handle.subscribe(hostile.proxy as never, delivered)
        },
        code: EventSubscriberErrorCode.invalidEventKey,
        type: TypeError
      },
      {
        name: 'invalid listener',
        invoke: () => (handle as any).subscribe('ready', null as never),
        code: EventSubscriberErrorCode.invalidListener,
        type: TypeError
      }
    ] as const
    for (const hostile of openCases) {
      let thrown: unknown
      try {
        hostile.invoke()
      } catch (error) {
        thrown = error
      }
      expect(thrown, hostile.name).toBeInstanceOf(hostile.type)
      expect(thrown).toMatchObject({ source: EVENT_SUBSCRIBER_SOURCE, code: hostile.code })
      expect((thrown as Error).message).toBeTypeOf('string')
      expect((thrown as Error).stack).toBeTypeOf('string')
      expect((thrown as Error).stack).not.toBe('')
      expect(hub.size('ready')).toBe(1)
      expect(hub.size()).toBe(1)
    }
    hub.publish('ready', 1)
    expect(delivered).toHaveBeenCalledOnce()
    for (const close of ['direct', 'unsubscribe'] as const) {
      const closedHub = createEventHub<{ ready: number }>()
      const closed = closedHub.subscribe('ready', () => undefined)
      if (close === 'direct') closed()
      else closed.unsubscribe()
      const key = makeRevoked()
      const listener = makeRevoked()
      key.revoke()
      listener.revoke()
      expect(() => closed.subscribe(key.proxy as never, listener.proxy as never)).toThrowError(
        expect.objectContaining({
          source: EVENT_SUBSCRIBER_SOURCE,
          code: EventSubscriberErrorCode.subscriptionClosed
        })
      )
      expect(key.reads()).toBe(0)
      expect(listener.reads()).toBe(0)
      expect(closedHub.size()).toBe(0)
    }
  })

  it('ES-T101 gives both owners exact self identity and reverse exact-once release', () => {
    const channel = createEventChannel<number>()
    const order: number[] = []
    const handle = channel
      .subscribe(() => {
        order.push(1)
      })
      .subscribe(() => {
        order.push(2)
      })
    expect(handle.unsubscribe).toBe(handle)
    handle.unsubscribe()
    handle()
    expect(order).toEqual([])
    expect(channel.size).toBe(0)
  })

  it('ES-T102 preserves duplicate channel listener registrations in one chain', () => {
    const channel = createEventChannel<number>()
    const listener = vi.fn()
    const handle = channel
      .subscribe(() => {
        listener()
      })
      .subscribe(() => {
        listener()
      })
    channel.publish(1)
    expect(listener).toHaveBeenCalledTimes(2)
    handle()
  })

  it('ES-T105 keeps widened finite keys and index signatures dynamically repeatable', () => {
    const hub = createEventHub<{ alpha: number; beta: number }>()
    const key: keyof { alpha: number; beta: number } = 'alpha'
    const listener = vi.fn()
    const handle = hub.subscribe(key, listener).subscribe(key as never, listener)
    hub.publish('alpha', 1)
    expect(listener).toHaveBeenCalledTimes(2)
    handle()
  })

  it('ES-T106 releases whole chain exactly once in reverse completion order', () => {
    const releases: number[] = []
    const hub = createEventHub<{ alpha: number; beta: number; gamma: number }>()
    const hubHandle = hub
      .subscribe('alpha', () => {
        releases.push(0)
      })
      .subscribe('beta', () => {
        releases.push(1)
      })
      .subscribe('gamma', () => {
        releases.push(2)
      })
    hubHandle()
    expect(hub.size()).toBe(0)
    hubHandle.unsubscribe()
    expect(releases).toEqual([])
    const channel = createEventChannel<number>()
    const completed: number[] = []
    const channelHandle = channel
      .subscribe(() => {
        completed.push(0)
      })
      .subscribe(() => {
        completed.push(1)
      })
      .subscribe(() => {
        completed.push(2)
      })
    channelHandle.unsubscribe()
    expect(channel.size).toBe(0)
    channelHandle()
    expect(completed).toEqual([])
  })

  it('ES-T109 preserves earlier ownership when listener, key, or options admission fails', () => {
    const channel = createEventChannel<number>()
    const listener = vi.fn()
    const handle = channel.subscribe(listener)
    expect(() => handle.subscribe(null as never)).toThrow()
    expect(channel.size).toBe(1)
    channel.publish(1)
    expect(listener).toHaveBeenCalledOnce()
    const hub = createEventHub<{ ready: number }>()
    const hubHandle = hub.subscribe('ready', listener)
    const invalidKey = {}
    expect(() => (hubHandle as any).subscribe(invalidKey, listener)).toThrowError()
    expect(hub.size('ready')).toBe(1)
    expect(hub.size()).toBe(1)
    handle()
    hubHandle()
  })
})
