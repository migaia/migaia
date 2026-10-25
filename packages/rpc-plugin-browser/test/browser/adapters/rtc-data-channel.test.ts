import { describe, expect, it, vi } from 'vitest'
import { createRtcDataChannelCarrier } from '../../../dist/browser/adapters/rtc-data-channel.js'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'

type IListener = (event: unknown) => void

/** Allocate only this case's original observations before installing native-shaped callbacks. */
function rtcChannelFixtureState() {
  const listeners = new Map<string, Set<IListener>>()
  return { listeners }
}

/** Own one test resource's mutable observations without sharing a factory closure. */
class RtcChannelFixture {
  /** Counts, native events and construction inputs belong only to this fixture instance. */
  #state: ReturnType<typeof rtcChannelFixtureState>
  /** Existing consumers retain the same observable fixture surface and callback identities. */
  readonly value: {
    readonly channel: {
      readonly readyState: string
      send(data: string): void
      addEventListener(type: string, listener: IListener): void
      removeEventListener(type: string, listener: IListener): void
    }
    readonly emit: (type: string, event?: unknown) => void
  }
  /** Install the original native-shaped callbacks after their observations exist. */
  constructor() {
    this.#state = rtcChannelFixtureState()
    const channel = {
      readyState: 'open',
      send: () => {},
      addEventListener: (type: string, listener: IListener) => {
        let entries = this.#state.listeners.get(type)
        if (!entries) this.#state.listeners.set(type, (entries = new Set()))
        entries.add(listener)
      },
      removeEventListener: (type: string, listener: IListener) => {
        this.#state.listeners.get(type)?.delete(listener)
      }
    }
    this.value = { channel, emit: this.#emit }
  }
  /** Drive the original fixture operation through its sole state owner. */
  #emit = (type: string, event?: unknown): void => {
    for (const listener of this.#state.listeners.get(type) ?? []) listener(event)
  }
}

/** Create one independent owner for the existing native-boundary fixture. */
function makeChannel(): {
  readonly channel: {
    readonly readyState: string
    send(data: string): void
    addEventListener(type: string, listener: IListener): void
    removeEventListener(type: string, listener: IListener): void
  }
  readonly emit: (type: string, event?: unknown) => void
} {
  return new RtcChannelFixture().value
}

/** One actual physical text frame exercises native handoff without a fake semantic parser. */
const lateFrame = { kind: RpcCarrierFrameKind.message, data: 'late' } as const

describe('RTCDataChannel transport', () => {
  it('requires terminal lifecycle capabilities', () => {
    expect(() =>
      createRtcDataChannelCarrier({ send() {} } as never, { report: () => undefined })
    ).toThrow('readyState and terminal event listeners')
  })

  it.each(['connecting', 'closing'])('rejects a channel that is %s', (readyState) => {
    /** Native state remains supplied by the exact original channel fixture. */
    const { channel } = makeChannel()
    expect(() =>
      createRtcDataChannelCarrier({ ...channel, readyState }, { report: () => undefined })
    ).toThrow('must be open before transport construction')
  })

  it('reports close as terminal and rejects later work', async () => {
    /** The native event stream remains the actual owner of termination. */
    const { channel, emit } = makeChannel()
    /** Actual SDK receiver closure replaces the deleted adapter.closed inspection. */
    const errors: unknown[] = []
    /** The real carrier acquires exactly the original native callbacks. */
    const carrier = createRtcDataChannelCarrier(channel, { report: (error) => errors.push(error) })
    carrier.subscribe({
      frame: () => undefined,
      error: (error) => errors.push(error),
      close: (error) => errors.push(error)
    })
    emit('close')
    expect(errors).toHaveLength(1)
    await expect(carrier.write(lateFrame)).rejects.toThrow('closed')
    /** Late subscriptions receive the same terminal object instead of an obsolete subscribe throw. */
    const closed = vi.fn()
    carrier.subscribe({ frame: () => undefined, error: () => undefined, close: closed })
    expect(closed).toHaveBeenCalledWith(errors[0])
    await carrier.close()
  })

  it('reports a hostile message getter as transport failure without dispatching data', async () => {
    /** Native getter invocation, error collection and accepted frames remain independent facts. */
    const { channel, emit } = makeChannel()
    /** This exact error must remain on the physical failure cause chain. */
    const failure = new Error('data getter failed')
    /** The actual SDK receiver observes the native physical failure. */
    const errors: unknown[] = []
    /** No admitted frame may be synthesized after getter failure. */
    const received: unknown[] = []
    /** Native acquisition supplies only reporting, without a fabricated Host context. */
    const carrier = createRtcDataChannelCarrier(channel, { report: () => undefined })
    carrier.subscribe({
      frame: (frame) => received.push(frame),
      error: (error) => errors.push(error),
      close: () => undefined
    })
    emit('message', {
      get data(): never {
        throw failure
      }
    })
    expect(received).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'TRANSPORT', cause: failure })
    await carrier.close()
  })

  it('reports an already-closed channel to late transport-error subscribers', async () => {
    /** Native terminal state is provided before the real carrier acquires listeners. */
    const { channel } = makeChannel()
    /** This exact native channel is already terminal; no synthetic peer-close packet is sent. */
    const closedChannel = { ...channel, readyState: 'closed' }
    /** Late actual receiver closure preserves the existing native error object. */
    const errors: unknown[] = []
    /** SDK's actual terminal replay owns this late observer. */
    const carrier = createRtcDataChannelCarrier(closedChannel, { report: () => undefined })
    carrier.subscribe({
      frame: () => undefined,
      error: () => undefined,
      close: (error) => errors.push(error)
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    await expect(carrier.write(lateFrame)).rejects.toThrow('closed')
    await carrier.close()
  })

  it('rolls back terminal listeners when registration fails partway through', () => {
    /** These exact native effects are the original acquisition/rollback oracle. */
    const added: string[] = []
    /** The first acquired callback must be removed when the second add fails. */
    const removed: string[] = []
    /** Native registration fails before reporting an acquired close callback. */
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
    expect(() => createRtcDataChannelCarrier(channel, { report: () => undefined })).toThrow(
      'close listener failed'
    )
    expect(added).toEqual(['closing'])
    expect(removed).toEqual(['closing'])
  })

  it('rolls back terminal listeners when message registration fails', () => {
    /** Reverse rollback must preserve every original native terminal remover. */
    const removed: string[] = []
    /** All terminal registrations succeed before the native message add fails. */
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
    expect(() => createRtcDataChannelCarrier(channel, { report: () => undefined })).toThrow(
      'message listener failed'
    )
    expect(removed).toEqual(['error', 'close', 'closing'])
  })

  it('reports terminal cleanup failures without escaping the channel event', async () => {
    /** Actual native callbacks retain the same event and remover identities. */
    const { channel, emit } = makeChannel()
    /** SDK's genuine report port is the only background cleanup diagnostic receiver. */
    const failures: unknown[] = []
    /** The native terminal primary stays exact and first in the original aggregate contract. */
    const primary = new Error('RTC terminal failure')
    /** The native remover fails after termination, without preventing its sibling removers. */
    const cleanup = new Error('close cleanup failed')
    /** Capture the original native remover before adding its one supported failure. */
    const originalRemove = channel.removeEventListener
    /** This fixture changes only the native close listener removal. */
    const failingChannel = {
      ...channel,
      removeEventListener(type: string, listener: IListener) {
        if (type === 'close') throw cleanup
        originalRemove(type, listener)
      }
    }
    /** The actual carrier owns terminal settlement and exact cleanup aggregation. */
    const carrier = createRtcDataChannelCarrier(failingChannel, {
      report: (error) => failures.push(error)
    })
    carrier.subscribe({ frame: () => undefined, error: () => undefined, close: () => undefined })
    expect(() => emit('close', primary)).not.toThrow()
    await expect(carrier.write(lateFrame)).rejects.toBe(primary)
    /** Observe this existing native cleanup rejection; no fixture aggregates or re-tags its errors. */
    await carrier.close().catch(() => undefined)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(AggregateError)
    expect((failures[0] as AggregateError).errors).toEqual([primary, cleanup])
    expect(failures[0]).toMatchObject({ code: 'TRANSPORT' })
  })
})
