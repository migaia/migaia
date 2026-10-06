import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import * as remoteRetry from '../../src/remote/retry.js'
import { createRemoteRetryPort } from '../../src/remote/retry.js'
import type { IRemoteRetryDispatch } from '../../src/remote/types.js'
import { nativeFixture } from './fixture.js'

/** Real Worker startup still needs event-loop turns; bounded polling does not run policy timers. */
async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500; turn += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('Worker observation did not arrive')
}

describe('thread generation recovery', () => {
  it('[A4] retries a sent idempotent request once with its original key across real Node generations', async () => {
    const factory = vi.spyOn(remoteRetry, 'createRemoteRetryPort')
    const fixture = nativeFixture({ keyFactory: () => 'thread-stable-key' }, { crash: true })
    try {
      const feature = await fixture.install()
      expect(await feature.read(['recovered'])).toBe('recovered')
      expect(factory).toHaveBeenCalledTimes(1)
      expect(factory.mock.calls[0]![0].scheduler).toBe(fixture.pluginScheduler)
      expect(fixture.channels).toHaveLength(2)
      expect(
        fixture.channels.every((channel) => channel.scheduler === fixture.pluginScheduler)
      ).toBe(true)
      const sent = fixture.frames.filter(({ message }) => message.method === 'p.read')
      expect(sent.map(({ generation }) => generation)).toEqual([1, 2])
      expect(sent.map(({ message }) => message.data.route.idempotencyKey)).toEqual([
        'thread-stable-key',
        'thread-stable-key'
      ])
      expect(fixture.handles[0]!.identity.fingerprint).not.toBe(
        fixture.handles[1]!.identity.fingerprint
      )
    } finally {
      await fixture.close()
    }
    expect(fixture.budget.inUse).toBe(0)
    factory.mockRestore()
  })
  it('[A4] never retries a sent non-idempotent request', async () => {
    const fixture = nativeFixture({}, { crash: true })
    try {
      const feature = await fixture.install()
      await expect(feature.write(['unknown'])).rejects.toMatchObject({
        code: 'REMOTE_RESULT_UNKNOWN',
        detail: { generation: 1 }
      })
      await until(() => fixture.handles.length === 2)
      expect(fixture.frames.filter(({ message }) => message.method === 'p.write')).toHaveLength(1)
    } finally {
      await fixture.close()
    }
  })
  it('[A10] explicit retry port replaces default and receives one logical dispatch', async () => {
    const inputs: IRemoteRetryDispatch[] = []
    const factory = vi.spyOn(remoteRetry, 'createRemoteRetryPort')
    const fixture = nativeFixture(
      {
        keyFactory: () => 'explicit-key',
        retryPort: {
          dispatch(input) {
            inputs.push(input)
            return createRemoteRetryPort({
              events: input.events,
              scheduler: fixture.pluginScheduler,
              report: () => undefined
            }).dispatch(input)
          }
        }
      },
      { crash: true }
    )
    try {
      const feature = await fixture.install()
      expect(await feature.read(['explicit'])).toBe('explicit')
      expect(inputs).toHaveLength(1)
      expect(factory).toHaveBeenCalledTimes(1)
      expect(factory.mock.calls[0]![0].events).toBe(inputs[0]!.events)
      expect(inputs[0]).toMatchObject({
        idempotent: true,
        key: 'explicit-key',
        method: 'p.read',
        generation: 1
      })
      expect(fixture.frames.filter(({ message }) => message.method === 'p.read')).toHaveLength(2)
    } finally {
      await fixture.close()
      factory.mockRestore()
    }
  })
  it('[A5] caller cancellation settles once and does not replay on a new Worker', async () => {
    const fixture = nativeFixture()
    try {
      const feature = await fixture.install()
      const controller = new AbortController()
      const result = feature
        .hold([], { signal: controller.signal })
        .catch((error: unknown) => error)
      await until(() => fixture.frames.some(({ message }) => message.method === 'p.hold'))
      controller.abort(new Error('cancel logical call'))
      expect(await result).toMatchObject({ code: 'CANCELLED' })
      fixture.handles[0]!.terminate()
      await until(() => fixture.handles.length === 2)
      expect(fixture.frames.filter(({ message }) => message.method === 'p.hold')).toHaveLength(1)
    } finally {
      await fixture.close()
    }
  })
  it('[A5] callWallTimeMs bounds the total request and cancels its timer', async () => {
    const scheduler = createManualScheduler()
    const fixture = nativeFixture({
      scheduler,
      spec: {
        entry: new URL('./fixtures/rpc-worker.mjs', import.meta.url).pathname,
        limits: { callWallTimeMs: 100 }
      }
    })
    try {
      const feature = await fixture.install()
      const result = feature.hold([], { timeoutMs: 200 }).catch((error: unknown) => error)
      await until(() => fixture.frames.some(({ message }) => message.method === 'p.hold'))
      scheduler.advance(100)
      expect(await result).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      expect(fixture.frames.filter(({ message }) => message.method === 'p.hold')).toHaveLength(1)
    } finally {
      await fixture.close()
    }
    expect(scheduler.pendingCount).toBe(0)
  })
  it.each([60, 110])(
    '[A5] preserves the original 100ms total deadline across a %sms rebind',
    async (delay) => {
      const scheduler = createManualScheduler()
      const fixture = nativeFixture(
        {
          scheduler,
          spec: {
            entry: new URL('./fixtures/rpc-worker.mjs', import.meta.url).pathname,
            limits: { callWallTimeMs: 100 }
          }
        },
        { crash: true }
      )
      try {
        const feature = await fixture.install()
        const result = feature
          .read(['bounded'], { timeoutMs: 200 })
          .catch((error: unknown) => error)
        await until(() => fixture.frames.some(({ message }) => message.method === 'p.read'))
        await fixture.handles[0]!.exited
        for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
        scheduler.advance(delay)
        if (delay === 110) {
          expect(await result).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
          await until(() => fixture.handles.length === 2)
          expect(
            fixture.frames.filter(
              ({ generation, message }) => generation === 2 && message.method === 'p.read'
            )
          ).toHaveLength(0)
        } else {
          expect(await result).toBe('bounded')
          const sent = fixture.frames.find(
            ({ generation, message }) => generation === 2 && message.method === 'p.read'
          )!
          expect(sent.message.data.route.timeoutMs).toBeGreaterThan(0)
          expect(sent.message.data.route.timeoutMs).toBeLessThanOrEqual(40)
        }
      } finally {
        await fixture.close()
      }
      expect(scheduler.pendingCount).toBe(0)
    }
  )
  it('[A4/A10] reports REMOTE_CLOSED with zero frames when departure wins before sendOnce', async () => {
    let enter!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    let resume!: () => void
    const gate = new Promise<void>((resolve) => {
      resume = resolve
    })
    const fixture = nativeFixture({
      retryPort: {
        async dispatch(input) {
          enter()
          await gate
          return createRemoteRetryPort({
            events: input.events,
            scheduler: fixture.pluginScheduler,
            report: () => undefined
          }).dispatch(input)
        }
      }
    })
    try {
      const feature = await fixture.install()
      const result = feature.write(['never sent']).catch((error: unknown) => error)
      await entered
      fixture.handles[0]!.terminate()
      await fixture.handles[0]!.exited
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      resume()
      expect(await result).toMatchObject({ code: 'REMOTE_CLOSED', detail: { generation: 1 } })
      expect(fixture.frames.filter(({ message }) => message.method === 'p.write')).toHaveLength(0)
    } finally {
      resume()
      await fixture.close()
    }
  })
  it('[A5] revokes a pulled stream without continuing it in the next generation', async () => {
    const fixture = nativeFixture()
    try {
      const feature = await fixture.install()
      const stream = feature.stream(['one item'])
      expect(await stream.next()).toMatchObject({ value: 'one item', done: false })
      fixture.handles[0]!.terminate()
      await fixture.handles[0]!.exited
      await until(() => fixture.handles.length === 2)
      const failure = await stream.next().catch((error: unknown) => error)
      const chain: unknown[] = []
      let current: unknown = failure
      for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
        const error = current as {
          name?: unknown
          source?: unknown
          code?: unknown
          cause?: unknown
        }
        chain.push({ name: error.name, source: error.source, code: error.code })
        current = error.cause
      }
      console.log('THREAD_A5_STREAM_FAILURE', JSON.stringify(chain))
      expect(failure).toMatchObject({ code: 'STREAM_RESULT_UNKNOWN' })
      expect(
        fixture.frames.filter(
          ({ generation, message }) => generation === 2 && message.kind === 'stream'
        )
      ).toHaveLength(0)
    } finally {
      await fixture.close()
    }
  })
  it('[A5] terminal restart budget drains retry while another facade remains callable', async () => {
    const scheduler = createManualScheduler()
    const terminal = nativeFixture(
      { scheduler, supervisor: { restart: { maxRestarts: 0 } } },
      { crash: true }
    )
    const independent = nativeFixture()
    try {
      const feature = await terminal.install()
      const result = feature.read(['terminal']).catch((error: unknown) => error)
      const other = await independent.install()
      expect(await result).toMatchObject({ code: 'REMOTE_RESULT_UNKNOWN' })
      expect(await other.read(['independent'])).toBe('independent')
      expect(terminal.handles).toHaveLength(1)
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      await terminal.close()
      await independent.close()
    }
  })
})
