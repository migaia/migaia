import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import type { IWebRpcTransport } from '../../src/transport.js'

describe('memory transport adapter', () => {
  it('declares shared pair resources as borrowed', () => {
    const [a, b] = createMemoryTransportPair()
    expect(a.ownership).toBe('borrowed')
    expect(b.ownership).toBe('borrowed')
    expect(a.topology).toBe('exclusive')
    expect(b.topology).toBe('exclusive')
    a.close()
  })

  it('reports receiver listener failures to the receiver side', async () => {
    const [a, b] = createMemoryTransportPair()
    const errors: unknown[] = []
    b.onListenerError?.((error) => errors.push(error))
    b.subscribe(() => {
      throw new Error('receiver failed')
    })
    a.send('message')
    await Promise.resolve()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    a.close()
  })

  it('cancels queued delivery when either side closes and reports terminal once', async () => {
    const [a, b] = createMemoryTransportPair()
    const received: unknown[] = []
    const failures: unknown[] = []
    const stopMessage = b.subscribe((message) => received.push(message.data))
    const stopA = a.onTransportError?.(() => {
      throw new Error('reporter failed')
    })
    const stopB = b.onTransportError?.((error) => failures.push(error))
    a.send('late')
    expect(() => b.close()).toThrow('reporter failed')
    expect(() => b.close()).not.toThrow()
    await Promise.resolve()
    expect(received).toEqual([])
    expect(failures).toHaveLength(1)
    expect(a.closed).toBe(true)
    expect(b.closed).toBe(true)
    expect(() => a.send('after-close')).toThrow('closed')
    expect(() => b.send('after-close')).toThrow('closed')
    expect(stopMessage()).toBe(false)
    expect(stopA?.()).toBe(true)
    expect(stopB?.()).toBe(true)
  })

  it('keeps terminal close pending until an asynchronous reporter rejection is surfaced', async () => {
    const [a, b] = createMemoryTransportPair()
    const reporterFailure = new Error('late reporter failure')
    let rejectReporter!: (error: unknown) => void
    a.onTransportError?.(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectReporter = reject
        })
    )

    const baseA: IWebRpcTransport = a
    const baseB: IWebRpcTransport = b
    const closePromise = baseB.close?.()
    expect(closePromise).toBeInstanceOf(Promise)
    expect(baseA.close?.()).toBe(closePromise)
    rejectReporter(reporterFailure)

    await expect(closePromise).rejects.toBe(reporterFailure)
    expect(reporterFailure).toMatchObject({ code: 'TRANSPORT' })
  })

  it('delivers to each active listener and supports independent unsubscription', async () => {
    const [a, b] = createMemoryTransportPair()
    const received: string[] = []
    const stopFirst = b.subscribe((message) => received.push(`first:${String(message.data)}`))
    const stopSecond = b.subscribe((message) => received.push(`second:${String(message.data)}`))
    a.send('one')
    await Promise.resolve()
    expect(received).toEqual(['first:one', 'second:one'])
    expect(stopFirst()).toBe(true)
    a.send('two')
    await Promise.resolve()
    expect(received).toEqual(['first:one', 'second:one', 'second:two'])
    expect(stopSecond()).toBe(true)
    a.close()
  })
})
