import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { SessionDrain } from '../../dist/session/drain.js'

/** The original business Promise and announcement port are independent native collaborators. */
function fixture(announce: boolean) {
  /** A pending business operation remains live until the original test settles it. */
  const announceClose = vi.fn(async (_peer: string, _options: { drainMs: number }) => undefined)
  /** This exact resolver settles the original caller Promise without a replacement wrapper. */
  let settle!: (value: string) => void
  /** The actual owner observes this Promise while returning the identical object. */
  const sent = new Promise<string>((resolve) => {
    settle = resolve
  })
  /** Count the original application invocation independently of the drain operation. */
  const send = vi.fn(() => sent)
  return {
    announceClose,
    announce: (remainingMs: number) =>
      announce ? announceClose('peer', { drainMs: remainingMs }) : undefined,
    send,
    sent,
    settle
  }
}

describe('process client drain', () => {
  it('announces once and shares the same Promise while Host budget tightens the timer', async () => {
    const scheduler = createManualScheduler()
    const source = fixture(true)
    const report = vi.fn()
    const drain = new SessionDrain({ scheduler, report })
    const request = drain.track('peer', source.send())
    expect(request).toBe(source.sent)
    const first = drain.drain('peer', 10_000, source.announce)
    const second = drain.drain('peer', 4_000, source.announce)
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

  it('waits for an in-flight request without inventing an announcement for the supplied no-op port', async () => {
    const scheduler = createManualScheduler()
    const source = fixture(false)
    const drain = new SessionDrain({ scheduler, report: vi.fn() })
    const request = drain.track('peer', source.send())
    const closing = drain.drain('peer', 10_000, source.announce)
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

  it('reports a rejected announcement and still completes the drain', async () => {
    const scheduler = createManualScheduler()
    const source = fixture(true)
    const failure = new Error('close failed')
    source.announceClose.mockRejectedValueOnce(failure)
    const report = vi.fn()
    const drain = new SessionDrain({ scheduler, report })
    await drain.drain('peer', 10_000, source.announce)
    expect(report).toHaveBeenCalledExactlyOnceWith(failure)
    expect(scheduler.pendingCount).toBe(0)
  })
})

it('the selected per-call drain budget keeps its exact announcement and deadline', async () => {
  /** The original manual clock makes the exact announcement and deadline independently observable. */
  const scheduler = createManualScheduler()
  /** A genuinely pending original send keeps drain active until its configured deadline. */
  const source = fixture(true)
  const drain = new SessionDrain({ scheduler, report: vi.fn() })
  const request = drain.track('peer', source.send())
  const closing = drain.drain('peer', 100, source.announce)
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
