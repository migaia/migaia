import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { describe, expect, it } from 'vitest'

/** Real Worker entry whose generations can crash on request. */
const entry = new URL('./fixtures/crash-worker.ts', import.meta.url)

type ICrashApi = {
  thread(): number
  threads(): AsyncGenerator<number>
  wait(): Promise<never>
  crash(): void
}

/** The public call shapes, each forced to settle so a synchronous throw is caught by `not.toThrow`. */
const calls = {
  request: (peer: Awaited<ReturnType<typeof createRpcHost<ICrashApi>>>) => peer.request('thread'),
  notify: (peer: Awaited<ReturnType<typeof createRpcHost<ICrashApi>>>) => peer.notify('thread'),
  stream: (peer: Awaited<ReturnType<typeof createRpcHost<ICrashApi>>>) =>
    (peer.stream('threads') as AsyncIterableIterator<number>).next(),
  group: (peer: Awaited<ReturnType<typeof createRpcHost<ICrashApi>>>) =>
    peer.group([{ method: 'thread' }]),
  outcome: (peer: Awaited<ReturnType<typeof createRpcHost<ICrashApi>>>) =>
    peer.outcome('restart-window-key')
}

/** Polls until the restarted generation answers, bounded so a broken restart fails the test. */
async function nextGeneration(
  peer: Awaited<ReturnType<typeof createRpcHost<ICrashApi>>>
): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return (await peer.request('thread')) as number
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('restarted generation never answered')
}

describe('crashed thread generation', () => {
  it('rejects calls made before the restart instead of throwing, then serves the new generation', async () => {
    const reports: unknown[] = []
    const peer = await createRpcHost<ICrashApi>({
      report: (error) => reports.push(error),
      plugins: [threadPlugin({ spawn: entry })]
    })
    try {
      const first = await peer.request('thread')
      const waiting = peer.request('wait')
      void peer.notify('crash')
      await expect(waiting).rejects.toMatchObject({ code: 'REMOTE_RESULT_UNKNOWN' })
      for (const call of Object.values(calls)) {
        let pending: Promise<unknown> | undefined
        expect(() => {
          pending = call(peer)
        }).not.toThrow()
        await expect(pending).rejects.toMatchObject({ code: 'REMOTE_CLOSED' })
      }
      const second = await nextGeneration(peer)
      expect(second).not.toBe(first)
    } finally {
      await peer.close()
    }
  })
})
