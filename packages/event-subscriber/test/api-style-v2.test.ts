import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import {
  createEventChannel,
  createEventHub,
  defineEventApiStyle,
  EventApiStyle,
  EventSubscriberErrorCode,
  invokeParallelSettled,
  subscribeOnce,
  subscribeSubscriber,
  subscribeUntil
} from '../src/index.js'
import type { IEventContext } from '../src/index.js'
import { createRawSubscriptionOwner } from '../src/internal/subscription.js'
import { normalizeEventApiStyle, projectEventApiStyle } from '../src/style.js'

/** Invokes the public factory at its JavaScript boundary for hostile-value coverage. */
const callUntrustedChannel = (options: unknown): unknown =>
  (createEventChannel as unknown as (options: unknown) => unknown)(options)

/** Invokes the public Hub factory at its JavaScript boundary for hostile-value coverage. */
const callUntrustedHub = (options: unknown): unknown =>
  (createEventHub as unknown as (options: unknown) => unknown)(options)

describe('event API style projection', () => {
  it('ES-T134 ESV2H-T01/T02: normalizes cancellation names for presets and custom styles', () => {
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

  it('ES-T135 ESV2H-T03/T05/T09/T10: projects styled Channel aliases onto one callable handle', () => {
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

  it('ES-T136 ESV2H-T04/T08/T15: projects styled Hub aliases across finite key chains', () => {
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

  it('ES-T137 ESV2H-T15: closed styled handles reject before reading hostile arguments', () => {
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

  it('ES-T138 ESV2H-T16: rolls back first registration when handle projection fails', () => {
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

  it('ES-T139 ESV2H-T09/T10: projects custom and listen-fire cancellation identities', () => {
    const customStyle = defineEventApiStyle({
      subscribe: 'observe',
      publish: 'dispatch',
      unsubscribe: 'dispose'
    })
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

  it('ES-T140 ESV2H-T09/T11/T12: preserves mixed chain identity and default handle shape', () => {
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

  it('ES-T141 ESV2H-T09/T16: releases owner registrations in reverse order and preserves both rollback errors', () => {
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

  it('ES-T142 ESV2H-T17/T18: keeps helpers and filtered views canonical on styled channels', async () => {
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

  it('ES-T123 ESV2-T01/T02/T16: keeps the default surface unchanged', () => {
    const omitted = createEventChannel<number>()
    const explicit = createEventChannel<number>({ style: 'subscribe-publish' })

    expect(Object.keys(omitted)).toEqual([
      'subscribe',
      'subscribeOnce',
      'subscribeUntil',
      'publish',
      'filterTaskId',
      'clear',
      'size'
    ])
    expect(Object.keys(explicit)).toEqual(Object.keys(omitted))
    expect(Object.getOwnPropertyDescriptor(explicit, 'publish')).toMatchObject({
      configurable: true,
      enumerable: true,
      writable: true
    })
    expect(EventApiStyle.onEmit).toBe('on-emit')
  })

  it('ES-T124 ESV2-T03/T05/T10/T11: maps channel presets to canonical identities', () => {
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

  it('ES-T125 ESV2-T05/T12/T13: maps Hub presets while preserving keyed payload routing', () => {
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
    const style = defineEventApiStyle({ subscribe: 'observe', publish: 'dispatch' })
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

  it('ES-T126 ESV2-T06/T07: preserves custom literals inline and through the helper', () => {
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
    const style = defineEventApiStyle({ subscribe: 'flush', publish: 'fire' })
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
    expect(defineEventApiStyle(style)).toBe(style)
  })

  it('ES-T127 ESV2-T02/T09/T16: installs custom aliases as immutable non-enumerable data properties', () => {
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

  it('ES-T128 ESV2-T08/T18: rejects invalid styles before returning a projected surface', () => {
    const invalidStyles: unknown[] = [
      { subscribe: '', publish: 'emit' },
      { subscribe: 'same', publish: 'same' },
      { subscribe: 'publish', publish: 'emit' },
      { subscribe: 'observe', publish: 'subscribe' },
      { subscribe: 'subscribeOnce', publish: 'emit' },
      { subscribe: 'subscribeUntil', publish: 'emit' },
      { subscribe: 'filterTaskId', publish: 'emit' },
      { subscribe: 'clear', publish: 'emit' },
      { subscribe: 'size', publish: 'emit' },
      { subscribe: '__proto__', publish: 'emit' },
      { subscribe: 'prototype', publish: 'emit' },
      { subscribe: 'observe', publish: 'constructor' },
      { subscribe: 'observe', publish: 'subscribeOnce' },
      { subscribe: 'observe', publish: 'subscribeUntil' },
      { subscribe: 'observe', publish: 'filterTaskId' },
      { subscribe: 'observe', publish: 'clear' },
      { subscribe: 'observe', publish: 'size' },
      { subscribe: 'observe', publish: '__proto__' },
      { subscribe: 'observe', publish: 'prototype' },
      { subscribe: 'observe', publish: 'emit', unsubscribe: '' },
      { subscribe: 'observe', publish: 'emit', unsubscribe: 'observe' },
      { subscribe: 'observe', publish: 'emit', unsubscribe: 'publish' },
      { subscribe: 'observe', publish: 'emit', unsubscribe: 'subscribe' },
      { subscribe: 'observe', publish: 'emit', unsubscribe: '__proto__' },
      { subscribe: 'observe', publish: 'emit', unsubscribe: 'prototype' },
      { subscribe: 'observe', publish: 'emit', unsubscribe: 'constructor' },
      { subscribe: 'observe', publish: 'emit', unsubscribe: 1 },
      { subscribe: 1, publish: 'emit' },
      null,
      'unknown-preset'
    ]

    for (const style of invalidStyles) {
      expect(() => callUntrustedChannel({ style })).toThrowError(
        expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions })
      )
    }
    for (const style of ['__proto__', 'constructor', 'toString']) {
      expect(() => callUntrustedChannel({ style })).toThrowError(
        expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions })
      )
    }
  })

  it('ES-T129 ESV2-T08/T18: reads style and custom names once and preserves getter cause', () => {
    const sequence: string[] = []
    const original = new Error('style getter failed')
    const style = {
      get subscribe() {
        sequence.push('subscribe')
        throw original
      },
      get publish() {
        sequence.push('publish')
        return 'emit'
      }
    }
    let styleReads = 0
    const options = {
      get style() {
        styleReads += 1
        sequence.push('style')
        return style
      }
    }

    expect(() => callUntrustedChannel(options)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidOptions,
        cause: original
      })
    )
    expect(styleReads).toBe(1)
    expect(sequence).toEqual(['style', 'subscribe'])
    expect(original.stack).toBeTruthy()

    const orderedReads: string[] = []
    const orderedStyle = {
      get subscribe() {
        orderedReads.push('subscribe')
        return 'observe'
      },
      get publish() {
        orderedReads.push('publish')
        return 'dispatch'
      },
      get unsubscribe() {
        orderedReads.push('unsubscribe')
        return 'dispose'
      }
    }
    const orderedOptions = {
      get style() {
        orderedReads.push('style')
        return orderedStyle
      }
    }
    expect(() => callUntrustedChannel(orderedOptions)).not.toThrow()
    expect(orderedReads).toEqual(['style', 'subscribe', 'publish', 'unsubscribe'])

    const unsubscribeOriginal = new Error('unsubscribe getter failed')
    const unsubscribeStyle = {
      subscribe: 'observe',
      publish: 'dispatch',
      get unsubscribe() {
        throw unsubscribeOriginal
      }
    }
    expect(() => callUntrustedChannel({ style: unsubscribeStyle })).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidOptions,
        cause: unsubscribeOriginal
      })
    )
    expect(unsubscribeOriginal.stack).toBeTruthy()

    const proxyOriginal = new Error('options proxy failed')
    const proxiedOptions = new Proxy(
      { style: 'on-emit' },
      {
        get(_target, property) {
          if (property === 'style') throw proxyOriginal
          return undefined
        }
      }
    )
    expect(() => callUntrustedChannel(proxiedOptions)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidOptions,
        cause: proxyOriginal
      })
    )
    expect(proxyOriginal.stack).toBeTruthy()

    const hubOriginal = new Error('hub style getter failed')
    let hubStyleReads = 0
    const hubOptions = {
      get style() {
        hubStyleReads += 1
        return {
          subscribe: 'observe',
          get publish() {
            throw hubOriginal
          }
        }
      }
    }
    expect(() => callUntrustedHub(hubOptions)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidOptions,
        cause: hubOriginal
      })
    )
    expect(hubStyleReads).toBe(1)
    expect(hubOriginal.stack).toBeTruthy()

    const hubProxyOriginal = new Error('hub options proxy failed')
    const proxiedHubOptions = new Proxy(
      { style: 'on-emit' },
      {
        get(_target, property) {
          if (property === 'style') throw hubProxyOriginal
          return undefined
        }
      }
    )
    expect(() => callUntrustedHub(proxiedHubOptions)).toThrowError(
      expect.objectContaining({
        code: EventSubscriberErrorCode.invalidOptions,
        cause: hubProxyOriginal
      })
    )
    expect(hubProxyOriginal.stack).toBeTruthy()
  })

  it('ES-T130 ESV2-T17: does not alter canonical helper behavior for styled channels', () => {
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

it('ES-T131 ESV2-T09/T21: rejects literal cross-semantic aliases at the options boundary', () => {
  expect(() => {
    // @ts-expect-error publish is reserved for the publish semantic.
    createEventChannel<number>({ style: { subscribe: 'publish', publish: 'emit' } })
  }).toThrowError(/event-subscriber options are invalid/)
  expect(() => {
    // @ts-expect-error the two aliases must be distinct.
    createEventChannel<number>({ style: { subscribe: 'observe', publish: 'observe' } })
  }).toThrowError(/event-subscriber options are invalid/)
})

it('ES-T132 ESV2-T19: preflights descriptor commit and leaks no partial alias surface', () => {
  const surface: {
    subscribe: () => undefined
    publish: () => undefined
    readonly [key: string]: unknown
  } = {
    subscribe: () => undefined,
    publish: () => undefined
  }
  Object.defineProperty(surface, 'observe', {
    configurable: false,
    value: 'occupied'
  })
  const plan = normalizeEventApiStyle({ subscribe: 'observe', publish: 'dispatch' })

  expect(() => projectEventApiStyle(surface, plan)).toThrowError(
    expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions })
  )
  expect(surface.observe).toBe('occupied')
  expect(Object.hasOwn(surface, 'dispatch')).toBe(false)

  const nonExtensibleSurface: {
    subscribe: () => undefined
    publish: () => undefined
    readonly [key: string]: unknown
  } = {
    subscribe: () => undefined,
    publish: () => undefined
  }
  Object.preventExtensions(nonExtensibleSurface)
  expect(() => projectEventApiStyle(nonExtensibleSurface, plan)).toThrowError(
    expect.objectContaining({ code: EventSubscriberErrorCode.invalidOptions })
  )
  expect(Object.hasOwn(nonExtensibleSurface, 'observe')).toBe(false)
  expect(Object.hasOwn(nonExtensibleSurface, 'dispatch')).toBe(false)
})

it('ES-T133 ESV2-T22: proves the default hot path is style-free and stays within the bundle bound', () => {
  const packageRoot = resolve(import.meta.dirname, '..')
  const source = readFileSync(resolve(packageRoot, 'src/channel.ts'), 'utf8')
  const dispatchStart = source.indexOf('const dispatchValue')
  const publishStart = source.indexOf('const publishValue', dispatchStart)
  const hotPath = source.slice(dispatchStart, publishStart)
  expect(hotPath).not.toContain('style')
  expect(hotPath).not.toContain('projectEventApiStyle')

  const baseline = JSON.parse(
    readFileSync(resolve(packageRoot, 'test/fixtures/bundle-size-baseline.json'), 'utf8')
  ) as { readonly bytes: number; readonly absoluteLimitBytes: number }
  const observed = gzipSync(readFileSync(resolve(packageRoot, 'dist/index.js'))).byteLength
  expect(observed).toBeLessThanOrEqual(baseline.absoluteLimitBytes)
  expect(observed).toBeLessThanOrEqual(
    baseline.bytes + Math.max(Math.ceil(baseline.bytes * 0.1), 1024)
  )
})
