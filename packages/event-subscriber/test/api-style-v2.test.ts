/** Event API style surface projection. Cases preserve the existing behavioral assertions. */
import { describe, expect, it, vi } from 'vitest'
import {
  createEventChannel,
  createEventHub,
  EventApiStyle,
  EventSubscriberErrorCode
} from '../src/index.ts'
import type { IEventApiStyleNames, IEventContext } from '../src/index.ts'
import { normalizeEventApiStyle } from '../src/style.ts'

describe('event API style surface projection', () => {
  it('normalizes cancellation names for presets and custom styles', () => {
    expect(normalizeEventApiStyle(undefined)).toEqual({
      subscribe: 'subscribe',
      publish: 'publish',
      unsubscribe: 'unsubscribe'
    })
    expect(normalizeEventApiStyle('subscribe-publish')).toEqual({
      subscribe: 'subscribe',
      publish: 'publish',
      unsubscribe: 'unsubscribe'
    })
    expect(normalizeEventApiStyle('on-emit')).toEqual({
      subscribe: 'on',
      publish: 'emit',
      unsubscribe: 'off'
    })
    expect(normalizeEventApiStyle('on-trigger')).toEqual({
      subscribe: 'on',
      publish: 'trigger',
      unsubscribe: 'off'
    })
    expect(normalizeEventApiStyle('listen-fire')).toEqual({
      subscribe: 'listen',
      publish: 'fire',
      unsubscribe: 'unlisten'
    })
    expect(normalizeEventApiStyle({ subscribe: 'observe', publish: 'dispatch' })).toEqual({
      subscribe: 'observe',
      publish: 'dispatch',
      unsubscribe: 'unsubscribe'
    })
    expect(
      normalizeEventApiStyle({ subscribe: 'observe', publish: 'dispatch', unsubscribe: 'dispose' })
    ).toEqual({ subscribe: 'observe', publish: 'dispatch', unsubscribe: 'dispose' })
    expect(() => normalizeEventApiStyle('emit-on')).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions })
    )
  })

  it('projects styled Channel aliases onto one callable handle', () => {
    const channel = createEventChannel<number>({ style: 'on-emit' })
    const seen: number[] = []
    const handle = channel
      .on((event) => {
        seen.push(event.value)
      })
      .on((event) => {
        seen.push(event.value)
      })

    expect(handle.on).toBe(handle.subscribe)
    expect(handle.off).toBe(handle)
    expect(handle.unsubscribe).toBe(handle)
    expect(Object.getOwnPropertyDescriptor(handle, 'on')).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
      value: handle.subscribe
    })
    expect(Object.getOwnPropertyDescriptor(handle, 'off')).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
      value: handle
    })

    channel.emit(7)
    expect(seen).toEqual([7, 7])
    handle.off()
    expect(channel.size).toBe(0)
  })

  it('projects styled Hub aliases across finite key chains', () => {
    const hub = createEventHub<{ ready: number; done: string }>({ style: 'on-emit' })
    const seen: string[] = []
    const handle = hub
      .on('ready', (event) => {
        seen.push(String(event.value))
      })
      .on('done', (event) => {
        seen.push(event.value)
      })

    expect(handle.on).toBe(handle.subscribe)
    expect(handle.off).toBe(handle)
    const sendEvent = hub.emit
    sendEvent('ready', 3)
    sendEvent('done', 'ok')
    expect(seen).toEqual(['3', 'ok'])
    handle.off()
    expect(hub.size()).toBe(0)
  })

  it('closed styled handles reject before reading hostile arguments', () => {
    const hub = createEventHub<{ ready: number }>({ style: 'on-emit' })
    const handle = hub.on('ready', () => undefined)
    handle.off()
    let reads = 0
    const hostile = new Proxy(
      {},
      {
        get() {
          reads += 1
          throw new Error('closed alias read')
        }
      }
    )

    expect(() => handle.on('ready' as never, hostile as never)).toThrowError(
      expect.objectContaining({ code: EventSubscriberErrorCode.subscriptionClosed })
    )
    expect(reads).toBe(0)
  })

  it('projects custom and listen-fire cancellation identities', () => {
    const customStyle = {
      subscribe: 'observe',
      publish: 'dispatch',
      unsubscribe: 'dispose'
    } as const satisfies IEventApiStyleNames
    const customChannel = createEventChannel<number, void, typeof customStyle>({
      style: customStyle
    })
    const customHandle = customChannel.observe(() => undefined)

    expect(customHandle.dispose).toBe(customHandle)
    expect(customHandle.unsubscribe).toBe(customHandle)
    expect(Object.getOwnPropertyDescriptor(customHandle, 'dispose')).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
      value: customHandle
    })
    customHandle.dispose()
    customHandle.unsubscribe()
    expect(customChannel.size).toBe(0)

    const listenChannel = createEventChannel<number>({ style: 'listen-fire' })
    const listenHandle = listenChannel.listen(() => undefined)
    expect(listenHandle.unlisten).toBe(listenHandle)
    expect(listenHandle.unsubscribe).toBe(listenHandle)
    expect(Object.getOwnPropertyDescriptor(listenHandle, 'unlisten')).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
      value: listenHandle
    })
    listenHandle.unlisten()
    expect(listenChannel.size).toBe(0)
  })

  it('preserves mixed chain identity and default handle shape', () => {
    const channel = createEventChannel<number>({ style: 'on-emit' })
    const seen: number[] = []
    const mixedFromCanonical = channel
      .subscribe((event) => {
        seen.push(event.value)
      })
      .on((event) => {
        seen.push(event.value * 10)
      })
    expect(mixedFromCanonical).toBe(mixedFromCanonical.subscribe(() => undefined))
    expect(mixedFromCanonical.on).toBe(mixedFromCanonical.subscribe)

    const mixedFromAlias = channel.on((event) => {
      seen.push(event.value * 100)
    })
    expect(mixedFromAlias).toBe(mixedFromAlias.subscribe(() => undefined))
    channel.emit(2)
    expect(seen).toEqual([2, 20, 200])
    mixedFromCanonical.off()
    mixedFromAlias.off()
    expect(channel.size).toBe(0)

    const defaultHandle = createEventChannel<number>({ style: 'subscribe-publish' }).subscribe(
      () => undefined
    )
    expect(Object.keys(defaultHandle)).toEqual([])
    expect(Object.getOwnPropertyNames(defaultHandle).sort()).toEqual(
      ['length', 'name', 'subscribe', 'unsubscribe'].sort()
    )
    expect(defaultHandle.subscribe).toBeTypeOf('function')
    expect(defaultHandle.unsubscribe).toBe(defaultHandle)
    defaultHandle()
  })

  it('keeps the default surface unchanged', () => {
    const omitted = createEventChannel<number>()
    const explicit = createEventChannel<number>({ style: 'subscribe-publish' })

    expect(Object.keys(omitted)).toEqual(['subscribe', 'publish', 'filterTaskId', 'clear', 'size'])
    expect(Object.keys(explicit)).toEqual(Object.keys(omitted))
    expect(Object.getOwnPropertyDescriptor(explicit, 'publish')).toMatchObject({
      configurable: true,
      enumerable: true,
      writable: true
    })
    expect(EventApiStyle.onEmit).toBe('on-emit')
  })

  it('maps channel presets to canonical identities', () => {
    const onEmit = createEventChannel<number>({ style: 'on-emit' })
    const onTrigger = createEventChannel<number>({ style: 'on-trigger' })
    const listenFire = createEventChannel<number>({ style: 'listen-fire' })
    const seen: number[] = []
    const onEmitStop = onEmit.on((event: IEventContext<number>) => {
      seen.push(event.value)
    })
    const onTriggerStop = onTrigger.on((event: IEventContext<number>) => {
      seen.push(event.value)
    })
    const listenStop = listenFire.listen((event: IEventContext<number>) => {
      seen.push(event.value)
    })

    expect(onEmit.on).toBe(onEmit.subscribe)
    expect(onEmit.emit).toBe(onEmit.publish)
    expect(onTrigger.on).toBe(onTrigger.subscribe)
    expect(onTrigger.trigger).toBe(onTrigger.publish)
    expect(listenFire.listen).toBe(listenFire.subscribe)
    expect(listenFire.fire).toBe(listenFire.publish)
    onEmit.emit(1)
    onTrigger.trigger(2)
    listenFire.fire(3)
    expect(seen).toEqual([1, 2, 3])
    onEmitStop()
    onTriggerStop()
    listenStop()
  })

  it('maps Hub presets while preserving keyed payload routing', () => {
    const hub = createEventHub<{ ready: number; warning: string }>({ style: 'on-emit' })
    const values: string[] = []
    const warningKey = 'warning' as const
    const subscription = hub.on(warningKey, (event) => {
      values.push(event.value)
    })

    expect(hub.on).toBe(hub.subscribe)
    expect(hub.emit).toBe(hub.publish)
    hub.emit(warningKey, 'ready')
    expect(values).toEqual(['ready'])
    expect(hub.size(warningKey)).toBe(1)
    subscription.unsubscribe()
    const style = {
      subscribe: 'observe',
      publish: 'dispatch'
    } as const satisfies IEventApiStyleNames
    const styledHub = createEventHub<{ ready: number }, typeof style>({ style })
    const styledValues: number[] = []
    const stop = styledHub.observe('ready', (event) => {
      styledValues.push(event.value)
    })

    expect(styledHub.observe).toBe(styledHub.subscribe)
    expect(styledHub.dispatch).toBe(styledHub.publish)
    expect(Object.keys(styledHub)).toEqual(['subscribe', 'publish', 'clear', 'size'])
    expect(Object.getOwnPropertyDescriptor(styledHub, 'observe')).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
      value: styledHub.subscribe
    })

    styledHub.dispatch('ready', 7)
    expect(styledValues).toEqual([7])
    expect(styledHub.size('ready')).toBe(1)
    stop()
    expect(styledHub.size()).toBe(0)
  })

  it('preserves custom literals inline and with as const satisfies', () => {
    const inline = createEventChannel<
      number,
      void,
      {
        readonly subscribe: 'observe'
        readonly publish: 'dispatch'
      }
    >({
      style: { subscribe: 'observe', publish: 'dispatch' }
    })
    const style = { subscribe: 'flush', publish: 'fire' } as const satisfies IEventApiStyleNames
    const declared = createEventChannel<number, void, typeof style>({ style })
    const observed: number[] = []

    inline.observe((event) => {
      observed.push(event.value)
    })
    declared.flush((event) => {
      observed.push(event.value)
    })
    inline.dispatch(1)
    declared.fire(2)
    expect(observed).toEqual([1, 2])
  })

  it('installs custom aliases as immutable non-enumerable data properties', () => {
    const channel = createEventChannel<
      number,
      void,
      {
        readonly subscribe: 'observe'
        readonly publish: 'dispatch'
      }
    >({
      style: { subscribe: 'observe', publish: 'dispatch' }
    })
    const observeDescriptor = Object.getOwnPropertyDescriptor(channel, 'observe')
    const dispatchDescriptor = Object.getOwnPropertyDescriptor(channel, 'dispatch')

    expect(observeDescriptor).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
      value: channel.subscribe
    })
    expect(dispatchDescriptor).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
      value: channel.publish
    })
    expect({ ...channel }).not.toHaveProperty('observe')
  })

  it('does not alter canonical helper behavior for styled channels', () => {
    const report = vi.fn()
    const channel = createEventChannel<number>({ style: 'on-emit', report })
    const handle = channel.on(() => undefined)
    channel.emit(1)
    expect(channel.size).toBe(1)
    handle.unsubscribe()
    expect(channel.size).toBe(0)
    expect(report).not.toHaveBeenCalled()
  })
})
