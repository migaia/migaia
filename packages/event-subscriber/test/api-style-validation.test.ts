/** Event API style boundary validation. Cases preserve the existing behavioral assertions. */
import { describe, expect, it } from 'vitest'
import { createEventChannel, createEventHub, EventSubscriberErrorCode } from '../src/index.ts'
import { normalizeEventApiStyle, projectEventApiStyle } from '../src/style.ts'

/** Invokes the public factory at its JavaScript boundary for hostile-value coverage. */
const callUntrustedChannel = (options: unknown): unknown =>
  (createEventChannel as unknown as (options: unknown) => unknown)(options)

/** Invokes the public Hub factory at its JavaScript boundary for hostile-value coverage. */
const callUntrustedHub = (options: unknown): unknown =>
  (createEventHub as unknown as (options: unknown) => unknown)(options)

describe('event API style boundary validation', () => {
  it('rejects invalid styles before returning a projected surface', () => {
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

  it('reads style and custom names once and preserves getter cause', () => {
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
})

it('rejects literal cross-semantic aliases at the options boundary', () => {
  expect(() => {
    // @ts-expect-error publish is reserved for the publish semantic.
    createEventChannel<number>({ style: { subscribe: 'publish', publish: 'emit' } })
  }).toThrowError(/event-subscriber options are invalid/)
  expect(() => {
    // @ts-expect-error the two aliases must be distinct.
    createEventChannel<number>({ style: { subscribe: 'observe', publish: 'observe' } })
  }).toThrowError(/event-subscriber options are invalid/)
})

it('preflights descriptor commit and leaks no partial alias surface', () => {
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
