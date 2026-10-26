import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { idempotency } from '@migaia/rpc-host/plugins/idempotency'
import { describe, expect, it } from 'vitest'

/** Real Worker entry whose generations can crash on request. */
const entry = new URL('./fixtures/crash-worker.ts', import.meta.url)
/** Each genuine transport generation owns its actual outcome feature installation. */
const transport = threadPlugin({ name: 'thread', spawn: entry, features: [idempotency()] })

type ICrashApi = {
  thread(): number
  threads(): AsyncGenerator<number>
  wait(): Promise<never>
  crash(): void
}

/** Namespace typing borrows the actual installed transport and optional outcome feature. */
type ICrashPlugins = readonly [typeof transport]
/** Root methods are lifecycle only; all five original business shapes use the actual namespace. */
type ICrashHost = Awaited<ReturnType<typeof createRpcHost<ICrashApi, ICrashPlugins>>>
/** Every original shape must return a Promise rather than throw during native replacement. */
const calls = {
  request: (peer: ICrashHost) => peer.thread.request('thread'),
  notify: (peer: ICrashHost) => peer.thread.notify('thread'),
  stream: (peer: ICrashHost) => Promise.resolve(peer.thread.stream('threads')),
  group: (peer: ICrashHost) => peer.thread.group([{ method: 'thread' }]),
  outcome: (peer: ICrashHost) => peer.thread.outcome('restart-window-key')
}

/** Polls until the restarted generation answers, bounded so a broken restart fails the test. */
async function nextGeneration(peer: ICrashHost): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return (await peer.thread.request('thread')) as number
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error('restarted generation never answered')
}

describe('crashed thread generation', () => {
  it('rejects calls made before the restart instead of throwing, then serves the new generation', async () => {
    const reports: unknown[] = []
    const peer = await createRpcHost<ICrashApi, ICrashPlugins>({
      report: (error) => reports.push(error),
      plugins: [transport]
    })
    try {
      const first = await peer.thread.request('thread')
      /**
       * A held capability retains the originally accepted generation rather than selecting a
       * successor.
       */
      const held = peer.thread.peers.thread!.thread
      const waiting = peer.thread.request('wait')
      void peer.thread.notify('crash')
      await expect.soft(waiting).rejects.toMatchObject({ code: 'REMOTE_RESULT_UNKNOWN' })
      /**
       * All five selections occur in this same turn, before native replacement can publish
       * readiness.
       */
      const pendingCalls = Object.values(calls).map((call) => {
        let pending: Promise<unknown> | undefined
        expect(() => {
          pending = call(peer)
        }).not.toThrow()
        return pending!
      })
      for (const pending of pendingCalls)
        await expect(pending).resolves.toEqual({ fulfilled: {}, rejected: {} })
      await expect(held()).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
      const second = await nextGeneration(peer)
      expect(second).not.toBe(first)
    } finally {
      await peer.close()
    }
  })
})
