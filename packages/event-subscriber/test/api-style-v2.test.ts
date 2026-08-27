import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import {
  createEventChannel,
  createEventHub,
  defineEventApiStyle,
  EventApiStyle,
  EventSubscriberErrorCode
} from '../src/index.js'
import type { IEventContext } from '../src/index.js'
import { normalizeEventApiStyle, projectEventApiStyle } from '../src/style.js'

/** Invokes the public factory at its JavaScript boundary for hostile-value coverage. */
const callUntrustedChannel = (options: unknown): unknown =>
  (createEventChannel as unknown as (options: unknown) => unknown)(options)

/** Invokes the public Hub factory at its JavaScript boundary for hostile-value coverage. */
const callUntrustedHub = (options: unknown): unknown =>
  (createEventHub as unknown as (options: unknown) => unknown)(options)

describe('event API style projection', () => {
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
