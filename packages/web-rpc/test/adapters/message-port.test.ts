import { describe, expect, it } from 'vitest'
import {
  createBrowserMessagePortTransport,
  createNodeMessagePortTransport
} from '../../src/adapters/message-port.js'

describe('message-port adapter', () => {
  it('rejects send and subscribe after the terminal close event', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const port = {
      postMessage() {},
      on(event: string, listener: (...args: unknown[]) => void) {
        listeners.set(event, listener)
      },
      off(event: string) {
        listeners.delete(event)
      }
    }
    const transport = createNodeMessagePortTransport(port)
    transport.onTransportError?.(() => undefined)
    listeners.get('close')?.()

    expect(transport.closed).toBe(true)
    expect(() => transport.send('late')).toThrow('closed')
    expect(() => transport.subscribe(() => undefined)).toThrow('closed')
  })

  it('replays a terminal close to late transport-error subscribers', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const port = {
      postMessage() {},
      on(event: string, listener: (...args: unknown[]) => void) {
        listeners.set(event, listener)
      },
      off(event: string) {
        listeners.delete(event)
      }
    }
    const transport = createNodeMessagePortTransport(port)
    transport.onTransportError?.(() => undefined)
    listeners.get('close')?.()

    const lateErrors: unknown[] = []
    transport.onTransportError?.((error) => lateErrors.push(error))
    expect(lateErrors).toHaveLength(1)
    expect(lateErrors[0]).toMatchObject({ message: '[rpc] message port closed' })
  })

  it('forwards data and transfer while sharing Node listeners', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const added: string[] = []
    const removed: string[] = []
    const sent: unknown[][] = []
    const port = {
      postMessage(...args: unknown[]) {
        sent.push(args)
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        added.push(event)
        listeners.set(event, listener)
      },
      off(event: string) {
        removed.push(event)
        listeners.delete(event)
      }
    }
    const transport = createNodeMessagePortTransport(port)
    const listenerFailures: unknown[] = []
    const transportFailures: unknown[] = []
    const stopFailures = transport.onTransportError?.((error) => transportFailures.push(error))
    const stopThrowingFailures = transport.onTransportError?.(() => {
      throw new Error('reporter failed')
    })
    transport.onListenerError?.((error) => listenerFailures.push(error))
    const stopFirst = transport.subscribe(() => {
      throw new Error('listener failed')
    })
    const received: unknown[] = []
    const stopSecond = transport.subscribe((message) => received.push(message.data))
    const transfer = {}
    transport.send('outbound', { transfer: [transfer] })
    listeners.get('message')?.('inbound')
    listeners.get('messageerror')?.()
    listeners.get('messageerror')?.({ toString: () => 'bad clone' })
    listeners.get('close')?.()
    listeners.get('close')?.()
    expect(added).toEqual(['messageerror', 'close', 'message'])
    expect(sent).toEqual([['outbound', [transfer]]])
    expect(received).toEqual(['inbound'])
    expect(listenerFailures).toHaveLength(1)
    expect(transportFailures).toHaveLength(3)
    let reporterFailure: unknown
    try {
      stopFirst()
    } catch (error) {
      reporterFailure = error
    }
    expect(reporterFailure).toBeInstanceOf(AggregateError)
    expect((reporterFailure as AggregateError).errors).toHaveLength(3)
    expect(reporterFailure).toMatchObject({ code: 'TRANSPORT' })
    expect(removed).toEqual([])
    stopSecond()
    stopFailures?.()
    stopThrowingFailures?.()
    expect(removed).toEqual(['message', 'close', 'messageerror'])
  })

  it('rolls back the first Node error listener when close registration fails', () => {
    const added: string[] = []
    const removed: string[] = []
    const port = {
      postMessage() {},
      on(event: string) {
        if (event === 'close') throw new Error('close listener failed')
        added.push(event)
      },
      off(event: string) {
        removed.push(event)
      }
    }
    const transport = createNodeMessagePortTransport(port)
    expect(() => transport.onTransportError?.(() => undefined)).toThrow('close listener failed')
    expect(added).toEqual(['messageerror'])
    expect(removed).toEqual(['messageerror'])
  })

  it('retains a Node subscription when final listener removal fails', () => {
    let removals = 0
    const port = {
      postMessage() {},
      on() {},
      off(event: string) {
        if (event !== 'message') return
        removals += 1
        if (removals === 1) throw new Error('message removal failed')
      }
    }
    const transport = createNodeMessagePortTransport(port)
    const unsubscribe = transport.subscribe(() => undefined)

    expect(() => unsubscribe()).toThrow('message removal failed')
    expect(() => unsubscribe()).not.toThrow()
    expect(removals).toBe(2)
  })
})

describe('browser message-port adapter', () => {
  it('owns start, delivery, transfer and close lifecycle', () => {
    const listeners = new Map<string, (event: MessageEvent<unknown> | Event) => void>()
    const sent: unknown[] = []
    let starts = 0
    let closes = 0
    const port = {
      postMessage(message: unknown) {
        sent.push(message)
      },
      start() {
        starts += 1
      },
      close() {
        closes += 1
      },
      addEventListener(
        type: 'message' | 'messageerror',
        listener: (event: MessageEvent<unknown> | Event) => void
      ) {
        listeners.set(type, listener)
      },
      removeEventListener(type: 'message' | 'messageerror') {
        listeners.delete(type)
      }
    }
    const transport = createBrowserMessagePortTransport(port)
    const received: unknown[] = []
    transport.subscribe((message) => received.push(message.data))
    transport.send('outbound')
    listeners.get('message')?.({ data: 'inbound' } as MessageEvent)
    expect(starts).toBe(1)
    expect(sent).toEqual(['outbound'])
    expect(received).toEqual(['inbound'])
    transport.close?.()
    expect(closes).toBe(1)
    expect(transport.closed).toBe(true)
    expect(() => transport.send('late')).toThrow('closed')
    expect(() => transport.subscribe(() => undefined)).toThrow('closed')
    transport.close?.()
    expect(closes).toBe(1)
  })

  it('keeps browser transport open for diagnostic messageerror events', () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const port = {
      postMessage() {},
      start() {},
      close() {},
      addEventListener(type: 'message' | 'messageerror', listener: (event: unknown) => void) {
        listeners.set(type, listener)
      },
      removeEventListener() {}
    }
    const transport = createBrowserMessagePortTransport(port)
    const errors: unknown[] = []
    transport.onTransportError?.((error) => errors.push(error))
    transport.subscribe(() => undefined)

    listeners.get('messageerror')?.({})

    expect(errors).toHaveLength(1)
    expect(transport.closed).toBe(false)
    expect(() => transport.send('still-open')).not.toThrow()
  })

  it('isolates listener and messageerror reporters and detaches on last unsubscribe', () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const removed: string[] = []
    const port = {
      postMessage() {},
      start() {},
      close() {},
      addEventListener(type: 'message' | 'messageerror', listener: (event: unknown) => void) {
        listeners.set(type, listener)
      },
      removeEventListener(type: 'message' | 'messageerror') {
        removed.push(type)
        listeners.delete(type)
      }
    }
    const transport = createBrowserMessagePortTransport(port)
    const listenerFailures: unknown[] = []
    const transportFailures: unknown[] = []
    const stopListenerFailures = transport.onListenerError?.((error) =>
      listenerFailures.push(error)
    )
    const stopTransportFailures = transport.onTransportError?.((error) =>
      transportFailures.push(error)
    )
    transport.onListenerError?.(() => {
      throw new Error('listener reporter failed')
    })
    transport.onTransportError?.(() => {
      throw new Error('transport reporter failed')
    })
    const stopFirst = transport.subscribe(() => {
      throw new Error('listener failed')
    })
    const stopSecond = transport.subscribe(() => undefined)
    expect(() => listeners.get('message')?.({ data: 'value' })).not.toThrow()
    expect(() => listeners.get('messageerror')?.({})).not.toThrow()
    expect(listenerFailures).toHaveLength(1)
    expect(transportFailures).toHaveLength(1)
    let reporterFailure: unknown
    try {
      stopFirst()
    } catch (error) {
      reporterFailure = error
    }
    expect(reporterFailure).toBeInstanceOf(AggregateError)
    expect((reporterFailure as AggregateError).errors).toHaveLength(2)
    expect(reporterFailure).toMatchObject({ code: 'TRANSPORT' })
    expect(removed).toEqual([])
    stopSecond()
    expect(removed).toEqual(['messageerror', 'message'])
    stopListenerFailures?.()
    stopTransportFailures?.()
  })

  it('does not close a borrowed browser port', () => {
    let closes = 0
    const port = {
      postMessage() {},
      start() {},
      close() {
        closes += 1
      },
      addEventListener() {},
      removeEventListener() {}
    }
    const transport = createBrowserMessagePortTransport(port, { ownership: 'borrowed' })
    transport.subscribe(() => undefined)
    transport.close?.()
    expect(transport.ownership).toBe('borrowed')
    expect(closes).toBe(0)
  })

  it('closes an owned browser port even when listener removal fails', () => {
    let closes = 0
    const port = {
      postMessage() {},
      start() {},
      close() {
        closes += 1
      },
      addEventListener() {},
      removeEventListener() {
        throw new Error('listener removal failed')
      }
    }
    const transport = createBrowserMessagePortTransport(port)
    transport.subscribe(() => undefined)

    expect(() => transport.close?.()).toThrow('message port cleanup failed')
    expect(closes).toBe(1)
    expect(transport.closed).toBe(true)
  })

  it('aggregates listener and owned-port cleanup failures', () => {
    const listenerFailure = new Error('listener removal failed')
    const closeFailure = new Error('port close failed')
    const port = {
      postMessage() {},
      start() {},
      close() {
        throw closeFailure
      },
      addEventListener() {},
      removeEventListener() {
        throw listenerFailure
      }
    }
    const transport = createBrowserMessagePortTransport(port)
    transport.subscribe(() => undefined)

    try {
      transport.close?.()
      throw new Error('close unexpectedly succeeded')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([
        listenerFailure,
        listenerFailure,
        closeFailure
      ])
      expect(error).toMatchObject({ code: 'TRANSPORT' })
    }
    expect(transport.closed).toBe(true)
  })
})
