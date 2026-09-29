import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createBrowserMessagePortTransport,
  createNodeMessagePortTransport
} from '../../src/core/adapters/message-port.js'
import { HookRegistry } from '../../src/core/internal/hooks.js'

/** A structural Node port that exposes exactly the listeners installed by the adapter. */
function createNodePort() {
  /** Multiple callbacks per event reveal duplicate native registration. */
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    port: {
      postMessage() {},
      on(event: string, listener: (...args: unknown[]) => void) {
        let group = listeners.get(event)
        if (group === undefined) {
          group = new Set()
          listeners.set(event, group)
        }
        group.add(listener)
      },
      off(event: string, listener: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(listener)
      }
    },
    emit(event: string, value?: unknown) {
      for (const listener of Array.from(listeners.get(event) ?? [])) listener(value)
    },
    count(event: string) {
      return listeners.get(event)?.size ?? 0
    }
  }
}

/** A browser port with observable message and diagnostic registrations. */
function createBrowserPort() {
  /** Native listeners stay separate from the channel's error listeners. */
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  return {
    port: {
      postMessage() {},
      start() {},
      close() {},
      addEventListener(event: string, listener: (value: unknown) => void) {
        let group = listeners.get(event)
        if (group === undefined) {
          group = new Set()
          listeners.set(event, group)
        }
        group.add(listener)
      },
      removeEventListener(event: string, listener: (value: unknown) => void) {
        listeners.get(event)?.delete(listener)
      }
    },
    emit(event: string, value: unknown) {
      for (const listener of Array.from(listeners.get(event) ?? [])) listener(value)
    }
  }
}

describe('core listener admission', () => {
  it('RLF A5 removes the HookRegistry identity map while preserving Set behavior', () => {
    const registry = new HookRegistry()
    const hook = vi.fn()
    const first = registry.add(hook)
    const duplicate = registry.add(hook)
    expect(registry.size).toBe(1)
    registry.emit({} as never)
    expect(hook).toHaveBeenCalledOnce()
    duplicate()
    first()
    expect(registry.size).toBe(0)
    const fresh = registry.add(hook)
    duplicate()
    expect(registry.size).toBe(1)
    registry.emit({} as never)
    expect(hook).toHaveBeenCalledTimes(2)
    registry.clear()
    fresh()
    expect(registry.size).toBe(0)
    /** The source condition rejects a second registration state owner in RPC. */
    const source = readFileSync(
      resolve(import.meta.dirname, '../../src/core/internal/hooks.ts'),
      'utf8'
    )
    expect(source).not.toContain('#registrations')
    expect(source).not.toContain('new Map<IRpcHook')
  })

  it('RLF A6 keeps stale transport disposers from removing a new admission', () => {
    /** Node transport errors must keep both native error hooks after stale disposal. */
    const node = createNodePort()
    const nodeTransport = createNodeMessagePortTransport(node.port)
    const nodeError = vi.fn()
    const oldNode = nodeTransport.onTransportError!(nodeError)
    oldNode()
    nodeTransport.onTransportError!(nodeError)
    oldNode()
    node.emit('messageerror')
    expect(nodeError).toHaveBeenCalledOnce()
    expect(node.count('messageerror')).toBe(1)
    expect(node.count('close')).toBe(1)

    /** The listener-error path uses the same generation-safe admission. */
    const nodeListenerError = vi.fn()
    const oldNodeListener = nodeTransport.onListenerError!(nodeListenerError)
    oldNodeListener()
    nodeTransport.onListenerError!(nodeListenerError)
    oldNodeListener()
    nodeTransport.subscribe(() => {
      throw new Error('fixture listener failure')
    })
    node.emit('message', 'value')
    expect(nodeListenerError).toHaveBeenCalledOnce()

    /** Browser transport and listener errors retain their legacy boolean disposer result. */
    const browser = createBrowserPort()
    const browserTransport = createBrowserMessagePortTransport(browser.port)
    const browserError = vi.fn()
    const oldBrowser = browserTransport.onTransportError!(browserError)
    oldBrowser()
    browserTransport.onTransportError!(browserError)
    oldBrowser()
    browserTransport.subscribe(() => undefined)
    browser.emit('messageerror', {})
    expect(browserError).toHaveBeenCalledOnce()

    const browserListenerError = vi.fn()
    const oldBrowserListener = browserTransport.onListenerError!(browserListenerError)
    oldBrowserListener()
    browserTransport.onListenerError!(browserListenerError)
    oldBrowserListener()
    browserTransport.subscribe(() => {
      throw new Error('fixture browser listener failure')
    })
    browser.emit('message', { data: 'value' })
    expect(browserListenerError).toHaveBeenCalledOnce()

    const repeated = browserTransport.onTransportError!(browserError)
    const duplicate = browserTransport.onTransportError!(browserError)
    expect(repeated()).toBe(true)
    expect(repeated()).toBe(false)
    expect(duplicate()).toBe(false)
  })

  it('RLF A7 preserves ordered isolation, delayed failure drain, and terminal replay', () => {
    /** A duplicate reporter is delivered once and cannot interrupt later reporters. */
    for (const kind of ['node', 'browser'] as const) {
      const fixture = kind === 'node' ? createNodePort() : createBrowserPort()
      const transport =
        kind === 'node'
          ? createNodeMessagePortTransport(
              fixture.port as ReturnType<typeof createNodePort>['port']
            )
          : createBrowserMessagePortTransport(
              fixture.port as ReturnType<typeof createBrowserPort>['port']
            )
      const order: string[] = []
      const first = () => {
        order.push('first')
        throw new Error('fixture reporter failure')
      }
      const stopFirst = transport.onTransportError!(first)
      transport.onTransportError!(() => order.push('second'))
      transport.onTransportError!(first)
      if (kind === 'browser') transport.subscribe(() => undefined)
      fixture.emit('messageerror', {})
      expect(order).toEqual(['first', 'second'])
      let drained: unknown
      try {
        stopFirst()
      } catch (error) {
        drained = error
      }
      expect(drained).toMatchObject({ code: 'TRANSPORT' })
    }

    /** Node's terminal close is replayed to listeners added after closure. */
    const node = createNodePort()
    const transport = createNodeMessagePortTransport(node.port)
    transport.onTransportError!(() => undefined)
    node.emit('close')
    const late = vi.fn()
    transport.onTransportError!(late)
    expect(late).toHaveBeenCalledOnce()
    expect(late.mock.calls[0]?.[0]).toMatchObject({ message: '[rpc] message port closed' })
  })

  it('RLF A8 owns every MessagePort error text without changing messages', () => {
    /** Source scanning distinguishes a canonical text reference from an inline message. */
    const source = readFileSync(
      resolve(import.meta.dirname, '../../src/core/adapters/message-port.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/new (?:Error|RpcTransportError)\(\s*[`'"]/)

    const browser = createBrowserPort()
    const browserTransport = createBrowserMessagePortTransport(browser.port)
    const browserErrors: unknown[] = []
    browserTransport.onTransportError!((error) => browserErrors.push(error))
    browserTransport.subscribe(() => undefined)
    browser.emit('messageerror', {})
    expect(browserErrors[0]).toMatchObject({
      message: '[rpc] browser message port could not deserialize a message'
    })
    browserTransport.close!()
    expect(() => browserTransport.send('late')).toThrow('[rpc] browser message port is closed')
    expect(() => browserTransport.subscribe(() => undefined)).toThrow(
      '[rpc] browser message port is closed'
    )

    const node = createNodePort()
    const nodeTransport = createNodeMessagePortTransport(node.port)
    const nodeErrors: unknown[] = []
    nodeTransport.onTransportError!((error) => nodeErrors.push(error))
    node.emit('messageerror', 'x')
    expect(nodeErrors[0]).toMatchObject({
      message: '[rpc] message port could not deserialize a message: x'
    })
    node.emit('close')
    expect(nodeErrors[1]).toMatchObject({ message: '[rpc] message port closed' })
    expect(() => nodeTransport.send('late')).toThrow('[rpc] message port is closed')
    expect(() => nodeTransport.subscribe(() => undefined)).toThrow('[rpc] message port is closed')
  })
})
