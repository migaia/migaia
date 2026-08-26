import { describe, expect, it } from 'vitest'
import { createRtcDataChannelTransport } from '../../src/adapters/rtc-data-channel.js'

type IListener = (event: unknown) => void

function makeChannel(): {
  readonly channel: {
    readonly readyState: string
    send(data: string): void
    addEventListener(type: string, listener: IListener): void
    removeEventListener(type: string, listener: IListener): void
  }
  readonly emit: (type: string, event?: unknown) => void
} {
  const listeners = new Map<string, Set<IListener>>()
  const emit = (type: string, event?: unknown): void => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  const channel = {
    readyState: 'open',
    send() {},
    addEventListener(type: string, listener: IListener) {
      let entries = listeners.get(type)
      if (!entries) listeners.set(type, (entries = new Set()))
      entries.add(listener)
    },
    removeEventListener(type: string, listener: IListener) {
      listeners.get(type)?.delete(listener)
    }
  }
  return { channel, emit }
}

describe('RTCDataChannel transport', () => {
  it('requires terminal lifecycle capabilities', () => {
    expect(() => createRtcDataChannelTransport({ send() {} } as never)).toThrow(
      'readyState and terminal event listeners'
    )
  })

  it.each(['connecting', 'closing'])('rejects a channel that is %s', (readyState) => {
    const { channel } = makeChannel()
    expect(() => createRtcDataChannelTransport({ ...channel, readyState })).toThrow(
      'must be open before transport construction'
    )
  })

  it('reports close as terminal and rejects later work', () => {
    const { channel, emit } = makeChannel()
    const transport = createRtcDataChannelTransport(channel)
    expect(transport.topology).toBe('exclusive')
    const errors: unknown[] = []
    transport.onTransportError?.((error) => errors.push(error))
    transport.subscribe(() => undefined)
    emit('close')
    expect(transport.closed).toBe(true)
    expect(errors).toHaveLength(1)
    expect(() => transport.send('late')).toThrow('closed')
    expect(() => transport.subscribe(() => undefined)).toThrow('closed')
  })

  it('reports an already-closed channel to late transport-error subscribers', () => {
    const { channel } = makeChannel()
    const closedChannel = { ...channel, readyState: 'closed' }
    const transport = createRtcDataChannelTransport(closedChannel)
    const errors: unknown[] = []
    transport.onTransportError?.((error) => errors.push(error))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect(() => transport.send('late')).toThrow('closed')
  })

  it('rolls back terminal listeners when registration fails partway through', () => {
    const added: string[] = []
    const removed: string[] = []
    const channel = {
      readyState: 'open',
      send() {},
      addEventListener(type: string) {
        if (type === 'close') throw new Error('close listener failed')
        added.push(type)
      },
      removeEventListener(type: string) {
        removed.push(type)
      }
    }
    const transport = createRtcDataChannelTransport(channel)
    expect(() => transport.subscribe(() => undefined)).toThrow('close listener failed')
    expect(added).toEqual(['closing'])
    expect(removed).toEqual(['closing'])
  })

  it('rolls back terminal listeners when message registration fails', () => {
    const removed: string[] = []
    const channel = {
      readyState: 'open',
      send() {},
      addEventListener(type: string) {
        if (type === 'message') throw new Error('message listener failed')
      },
      removeEventListener(type: string) {
        removed.push(type)
      }
    }
    const transport = createRtcDataChannelTransport(channel)
    expect(() => transport.subscribe(() => undefined)).toThrow('message listener failed')
    expect(removed).toEqual(['error', 'close', 'closing'])
  })

  it('reports terminal cleanup failures without escaping the channel event', () => {
    const { channel, emit } = makeChannel()
    const failures: unknown[] = []
    const primary = new Error('RTC terminal failure')
    const cleanup = new Error('close cleanup failed')
    const originalRemove = channel.removeEventListener
    const failingChannel = {
      ...channel,
      removeEventListener(type: string, listener: IListener) {
        if (type === 'close') throw cleanup
        originalRemove(type, listener)
      }
    }
    const transport = createRtcDataChannelTransport(failingChannel)
    transport.onTransportError?.((error) => failures.push(error))
    transport.subscribe(() => undefined)

    expect(() => emit('close', primary)).not.toThrow()
    expect(transport.closed).toBe(true)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(AggregateError)
    expect((failures[0] as AggregateError).errors).toEqual([primary, cleanup])
    expect(failures[0]).toMatchObject({ code: 'TRANSPORT' })
  })
})
