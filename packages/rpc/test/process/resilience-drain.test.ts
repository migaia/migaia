import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../src/remote/types.js'
import { createRemoteBindingDrain } from '../../src/remote/internal/binding-drain.js'

/** A real endpoint's unrelated surface is irrelevant to the binding's drain seam. */
function fixture(capabilities: readonly string[]) {
  const announceClose = vi.fn(async () => undefined)
  /** A pending request remains live until the test explicitly settles it. */
  let settle!: (value: string) => void
  const sent = new Promise<string>((resolve) => {
    settle = resolve
  })
  const send = vi.fn(() => sent)
  const endpoint = {
    endpoint: { send, announceClose, provide: vi.fn() }
  } as unknown as IRemoteServeEndpoint
  const channel = {
    peerId: 'peer',
    transport: {},
    agreement: { capabilities }
  } as unknown as IRemoteChannel
  return { announceClose, channel, endpoint, send, sent, settle }
}

describe('process client drain', () => {
  it('[A3] announces once and shares the same Promise while Host budget tightens the timer', async () => {
    const scheduler = createManualScheduler()
    const source = fixture(['close@1'])
    const report = vi.fn()
    const drain = createRemoteBindingDrain(scheduler, report)
    const endpoint = drain.wrap(source.channel, source.endpoint)
    const request = endpoint.endpoint.send<string>('peer', 'method', [])
    expect(request).toBe(source.sent)
    const first = drain.drainCurrent()
    const second = drain.drainCurrent({ hostRemainingMs: 5_000 })
    expect(first).toBe(second)
    await Promise.resolve()
    expect(source.announceClose).toHaveBeenCalledTimes(1)
    scheduler.advance(3_999)
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(1)
    await first
    expect(scheduler.pendingCount).toBe(0)
    source.settle('done')
    expect(await request).toBe('done')
    expect(report).not.toHaveBeenCalled()
  })

  it('[A3] waits for an in-flight request, but emits no close when the peer lacks close@1', async () => {
    const scheduler = createManualScheduler()
    const source = fixture([])
    const drain = createRemoteBindingDrain(scheduler, vi.fn())
    const endpoint = drain.wrap(source.channel, source.endpoint)
    const request = endpoint.endpoint.send<string>('peer', 'method', [])
    const closing = drain.drainCurrent()
    let finished = false
    void closing.then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(source.announceClose).not.toHaveBeenCalled()
    source.settle('done')
    expect(await request).toBe('done')
    await closing
    expect(finished).toBe(true)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('[A3] reports a rejected announcement and still completes the drain', async () => {
    const scheduler = createManualScheduler()
    const source = fixture(['close@1'])
    const failure = new Error('close failed')
    source.announceClose.mockRejectedValueOnce(failure)
    const report = vi.fn()
    const drain = createRemoteBindingDrain(scheduler, report)
    drain.wrap(source.channel, source.endpoint)
    await drain.drainCurrent()
    expect(report).toHaveBeenCalledExactlyOnceWith(failure)
    expect(scheduler.pendingCount).toBe(0)
  })
})

it('[A46] per-call drain budget is exact while the original Host budget keeps its eighty-percent shrink', async () => {
  /** The original manual clock makes the exact announcement and deadline independently observable. */
  const scheduler = createManualScheduler()
  /** A genuinely pending original send keeps drain active until its configured deadline. */
  const source = fixture(['close@1'])
  const drain = createRemoteBindingDrain(scheduler, vi.fn())
  const endpoint = drain.wrap(source.channel, source.endpoint)
  const request = endpoint.endpoint.send<string>('peer', 'method', [])
  const closing = drain.drainCurrent({ drainMs: 100 } as never)
  await Promise.resolve()
  expect(source.announceClose).toHaveBeenCalledWith('peer', { drainMs: 100 })
  scheduler.advance(99)
  expect(scheduler.pendingCount).toBe(1)
  scheduler.advance(1)
  await closing
  expect(scheduler.pendingCount).toBe(0)
  source.settle('done')
  await request
})
