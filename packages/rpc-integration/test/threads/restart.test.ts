import { readRuntimeCarrier } from '@migaia/rpc-contract/runtime'
import { readRpcBatchMembers } from '@migaia/rpc-contract/framing'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import * as remoteRetry from '../../../rpc-host/dist/remote/retry.js'
import { createRemoteRetryPort } from '@migaia/rpc-host/plugin'
import type { IRemoteRetryDispatch } from '@migaia/rpc-host/plugin'
import { nativeFixture } from '../../../rpc-plugin-thread/test/threads/fixture.js'

/** Real Worker startup still needs event-loop turns; bounded polling does not run policy timers. */
async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500; turn += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('Worker observation did not arrive')
}

/** Read the real packet's members while keeping each original native generation/transfer receipt. */
function sentFrames(fixture: ReturnType<typeof nativeFixture>) {
  return fixture.frames.flatMap((frame) =>
    (
      (readRpcBatchMembers(frame.message) ?? [frame.message]) as readonly (typeof frame.message)[]
    ).map((message) => ({
      ...frame,
      message: readRuntimeCarrier(message)?.frame ?? message
    }))
  )
}

describe('thread generation recovery', () => {
  it('retries a sent idempotent request once with its original key across real Node generations', async () => {
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
      const sent = sentFrames(fixture).filter(
        ({ message }) => message.kind === 'runtime-call' && message.task?.method === 'p.read'
      )
      expect(sent.map(({ generation }) => generation)).toEqual([1, 2])
      expect(sent.map(({ message }) => message.options.idempotencyKey)).toEqual([
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
  it('never retries a sent non-idempotent request', async () => {
    const fixture = nativeFixture({}, { crash: true })
    try {
      const feature = await fixture.install()
      await expect(feature.write(['unknown'])).rejects.toMatchObject({
        code: 'REMOTE_RESULT_UNKNOWN',
        detail: { generation: 1 }
      })
      await until(() => fixture.handles.length === 2)
      expect(
        sentFrames(fixture).filter(
          ({ message }) => message.kind === 'runtime-call' && message.task?.method === 'p.write'
        )
      ).toHaveLength(1)
    } finally {
      await fixture.close()
    }
  })
  it('explicit retry port replaces default and receives one logical dispatch', async () => {
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
      expect(
        sentFrames(fixture).filter(
          ({ message }) => message.kind === 'runtime-call' && message.task?.method === 'p.read'
        )
      ).toHaveLength(2)
    } finally {
      await fixture.close()
      factory.mockRestore()
    }
  })
  it('caller cancellation settles once and does not replay on a new Worker', async () => {
    const fixture = nativeFixture()
    try {
      const feature = await fixture.install()
      const controller = new AbortController()
      const result = feature
        .hold([], { signal: controller.signal })
        .catch((error: unknown) => error)
      await until(() =>
        sentFrames(fixture).some(
          ({ message }) => message.kind === 'runtime-call' && message.task?.method === 'p.hold'
        )
      )
      controller.abort(new Error('cancel logical call'))
      expect(await result).toMatchObject({ code: 'CANCELLED' })
      fixture.handles[0]!.terminate()
      await until(() => fixture.handles.length === 2)
      expect(
        sentFrames(fixture).filter(
          ({ message }) => message.kind === 'runtime-call' && message.task?.method === 'p.hold'
        )
      ).toHaveLength(1)
    } finally {
      await fixture.close()
    }
  })
  it('callWallTimeMs bounds the total request and cancels its timer', async () => {
    /** Policy timers are virtual; original native generation jobs retain host ordering. */
    const clock = createManualScheduler()
    /** Host turns retain native ordering while policy deadlines stay on the original virtual clock. */
    const scheduler = {
      ...clock,
      defer: systemScheduler.defer,
      /** Read the original clock owner; class accessors do not participate in object spread. */
      get pendingCount() {
        return clock.pendingCount
      }
    }
    const fixture = nativeFixture({
      scheduler,
      spec: {
        entry: new URL(
          '../../../rpc-plugin-thread/test/threads/fixtures/rpc-worker.mjs',
          import.meta.url
        ).pathname,
        limits: { callWallTimeMs: 100 }
      }
    })
    try {
      const feature = await fixture.install()
      const result = feature.hold([], { timeoutMs: 200 }).catch((error: unknown) => error)
      await until(() =>
        sentFrames(fixture).some(
          ({ message }) => message.kind === 'runtime-call' && message.task?.method === 'p.hold'
        )
      )
      scheduler.advance(100)
      expect(await result).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      expect(
        sentFrames(fixture).filter(
          ({ message }) => message.kind === 'runtime-call' && message.task?.method === 'p.hold'
        )
      ).toHaveLength(1)
    } finally {
      await fixture.close()
    }
    expect(scheduler.pendingCount).toBe(0)
  })
  it.each([60, 110])(
    'preserves the original 100ms total deadline across a %sms rebind',
    async (delay) => {
      /** Policy timers are virtual; original native generation jobs retain host ordering. */
      const clock = createManualScheduler()
      /**
       * Host turns retain native ordering while policy deadlines stay on the original virtual
       * clock.
       */
      const scheduler = {
        ...clock,
        defer: systemScheduler.defer,
        /** Read the original clock owner; class accessors do not participate in object spread. */
        get pendingCount() {
          return clock.pendingCount
        }
      }
      const fixture = nativeFixture(
        {
          scheduler,
          spec: {
            entry: new URL(
              '../../../rpc-plugin-thread/test/threads/fixtures/rpc-worker.mjs',
              import.meta.url
            ).pathname,
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
        await until(() =>
          sentFrames(fixture).some(
            ({ message }) => message.kind === 'runtime-call' && message.task?.method === 'p.read'
          )
        )
        await fixture.handles[0]!.exited
        for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
        scheduler.advance(delay)
        if (delay === 110) {
          expect(await result).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
          await until(() => fixture.handles.length === 2)
          expect(
            sentFrames(fixture).filter(
              ({ generation, message }) =>
                generation === 2 &&
                message.kind === 'runtime-call' &&
                message.task?.method === 'p.read'
            )
          ).toHaveLength(0)
        } else {
          expect(await result).toBe('bounded')
          const sent = sentFrames(fixture).find(
            ({ generation, message }) =>
              generation === 2 &&
              message.kind === 'runtime-call' &&
              message.task?.method === 'p.read'
          )!
          expect(sent.message.options.timeoutMs).toBeGreaterThan(0)
          expect(sent.message.options.timeoutMs).toBeLessThanOrEqual(40)
        }
      } finally {
        await fixture.close()
      }
      expect(scheduler.pendingCount).toBe(0)
    }
  )
  it('reports REMOTE_CLOSED with zero frames when departure wins before sendOnce', async () => {
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
      expect(
        sentFrames(fixture).filter(
          ({ message }) => message.kind === 'runtime-call' && message.task?.method === 'p.write'
        )
      ).toHaveLength(0)
    } finally {
      resume()
      await fixture.close()
    }
  })
  it('revokes a pulled stream without continuing it in the next generation', async () => {
    const fixture = nativeFixture()
    try {
      const feature = await fixture.install()
      const stream = feature.stream(['one item'])
      expect(await stream.next()).toMatchObject({ value: 'one item', done: false })
      fixture.handles[0]!.terminate()
      await fixture.handles[0]!.exited
      await until(() => fixture.handles.length === 2)
      const failure = await stream.next().catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'STREAM_RESULT_UNKNOWN' })
      expect(
        sentFrames(fixture).filter(
          ({ generation, message }) =>
            generation === 2 && message.kind === 'runtime-call' && message.task?.mode === 'stream'
        )
      ).toHaveLength(0)
    } finally {
      await fixture.close()
    }
  })
  it('terminal restart budget drains retry while another facade remains callable', async () => {
    /** Policy timers are virtual; original native generation jobs retain host ordering. */
    const clock = createManualScheduler()
    /** Host turns retain native ordering while policy deadlines stay on the original virtual clock. */
    const scheduler = {
      ...clock,
      defer: systemScheduler.defer,
      /** Read the original clock owner; class accessors do not participate in object spread. */
      get pendingCount() {
        return clock.pendingCount
      }
    }
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
