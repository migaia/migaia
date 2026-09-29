import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import {
  createBrowserMessagePortTransport,
  createNodeMessagePortTransport
} from '../../src/core/adapters/message-port.js'

/** Confirms tagging preserves the native error and its stable public text. */
function expectTransportIdentity(value: unknown, message: string): void {
  const error = value as Error & { source?: string; code?: string }
  expect(error.constructor).toBe(Error)
  expect(error.name).toBe('Error')
  expect(error.message).toBe(message)
  expect(typeof error.stack).toBe('string')
  expect(error.stack?.length).toBeGreaterThan(0)
  expect(Object.hasOwn(error, 'source')).toBe(true)
  expect(Object.hasOwn(error, 'code')).toBe(true)
  expect(error.source).toBe('@migaia/rpc/core')
  expect(error.code).toBe('TRANSPORT')
}

describe('control A13 message-port transport error identity', () => {
  it('tags browser message errors without changing the native error', () => {
    /** The structural browser port exposes its registered event callbacks. */
    const listeners = new Map<string, (event: unknown) => void>()
    const port = {
      postMessage() {},
      start() {},
      close() {},
      addEventListener(type: 'message' | 'messageerror', listener: (event: unknown) => void) {
        listeners.set(type, listener)
      },
      removeEventListener(type: 'message' | 'messageerror') {
        listeners.delete(type)
      }
    }
    /** Subscribing to messages installs the browser's native messageerror hook. */
    const transport = createBrowserMessagePortTransport(port)
    const errors: unknown[] = []
    transport.onTransportError?.((error) => errors.push(error))
    transport.subscribe(() => undefined)
    listeners.get('messageerror')?.({})
    expect(errors).toHaveLength(1)
    expectTransportIdentity(errors[0], '[rpc] browser message port could not deserialize a message')
  })

  it('tags Node message and close errors while replaying the same terminal object', () => {
    /** A real Node MessagePort supplies its EventEmitter error and close events. */
    const channel = new MessageChannel()
    try {
      const transport = createNodeMessagePortTransport(channel.port1)
      const errors: unknown[] = []
      transport.onTransportError?.((error) => errors.push(error))
      channel.port1.emit('messageerror', 'x')
      channel.port1.emit('close', undefined)
      expect(errors).toHaveLength(2)
      expectTransportIdentity(errors[0], '[rpc] message port could not deserialize a message: x')
      expectTransportIdentity(errors[1], '[rpc] message port closed')
      const replayed: unknown[] = []
      transport.onTransportError?.((error) => replayed.push(error))
      expect(replayed).toHaveLength(1)
      expect(replayed[0]).toBe(errors[1])
    } finally {
      channel.port1.close()
      channel.port2.close()
    }
  })
})
