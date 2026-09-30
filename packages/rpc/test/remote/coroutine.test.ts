import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import type { IAbortSignal } from '@migaia/lifecycle'
import { createUnitBudget } from '@migaia/supervision'
import { describe, expect, it, vi } from 'vitest'
import { coroutinePorts } from '../../src/remote/coroutine.js'
import { createRemoteHost } from '../../src/remote/host.js'
import { createCoroutineHost, createCoroutinePlugin } from '../../src/remote/index.js'
import type { IRemoteContract } from '../../src/remote/contract.js'

/** One declared Feature is shared by Plugin and Host coroutine scenarios. */
const contract: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'p',
  features: { f: { methods: { m: { mode: 'request', idempotent: false } } } }
}

/** A cooperative task remains available until its supervisor aborts. */
async function waitForAbort(signal: IAbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true })
  )
}

describe('remote coroutine loopback', () => {
  it('replays one explicit idempotency key after a start-then-switch replacement', async () => {
    const servedHost = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** Provider execution is counted across both service generations. */
    let executions = 0
    const target = definePlugin({
      name: 'p',
      features: {
        f: defineFeature(() => ({
          m: (value: unknown) => {
            executions += 1
            return value
          }
        }))
      },
      install: () => ({})
    })
    const replayContract: IRemoteContract = {
      ...contract,
      features: { f: { methods: { m: { mode: 'request', idempotent: true } } } }
    }
    const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 2, launchRate: false })
    /** Every generation's task observes cancellation before final release returns. */
    const signals: IAbortSignal[] = []
    /** Client resources must close once for each completed generation. */
    let channelCloses = 0
    let endpointCloses = 0
    const report = (error: unknown): void => {
      throw error
    }
    const ports = coroutinePorts(
      {
        budget,
        report,
        task: async ({ signal, serve }) => {
          signals.push(signal)
          await serve(servedHost, () => target)
          await waitForAbort(signal)
        }
      },
      { catalog: { p: replayContract } }
    )
    const remote = createRemoteHost({
      binding: {
        ...ports.binding,
        openChannel: async (unit, signal) => {
          const channel = await ports.binding.openChannel(unit, signal)
          expect(channel.agreement.source).toBe('static')
          expect(channel.agreement.capabilities).toContain('stream@1')
          return {
            ...channel,
            close: async () => {
              channelCloses += 1
              await channel.close()
            }
          }
        }
      },
      endpointFactory: async (channel, signal) => {
        const served = await ports.endpointFactory(channel, signal)
        return {
          ...served,
          endpoint: {
            ...served.endpoint,
            dispose: async () => {
              endpointCloses += 1
              await served.endpoint.dispose()
            }
          }
        }
      },
      catalog: { p: replayContract },
      report
    })
    try {
      const first = await remote.use('p')
      expect(await first.f!.m!(['value'], { idempotencyKey: 'same-key' })).toBe('value')
      expect(await remote.unUse('p')).toEqual({ ok: true })
      expect(await ports.binding.supervisor.replace({ strategy: 'start-then-switch' })).toEqual({
        kind: 'replaced',
        generation: 2
      })
      await remote.ready()
      const second = await remote.use('p')
      expect(await second.f!.m!(['value'], { idempotencyKey: 'same-key' })).toBe('value')
      expect(executions).toBe(1)
    } finally {
      await remote.release()
      await servedHost.dispose()
      budget.close()
    }
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(channelCloses).toBe(2)
    expect(endpointCloses).toBe(2)
  })

  it('serves a Host catalog over a static in-memory channel', async () => {
    const servedHost = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const target = definePlugin({
      name: 'p',
      features: { f: defineFeature(() => ({ m: (value: unknown) => value })) },
      install: () => ({})
    })
    const resolvePlugin = vi.fn(() => target)
    const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
    /** Missing resolver and repeated publication must not replace the first port. */
    let missingResolver: unknown
    let duplicateServe: unknown
    const remote = createCoroutineHost({
      catalog: { p: contract },
      budget,
      report: (error) => {
        throw error
      },
      task: async ({ signal, serve }) => {
        try {
          await serve(servedHost)
        } catch (error) {
          missingResolver = error
        }
        await serve(servedHost, resolvePlugin)
        try {
          await serve(servedHost, resolvePlugin)
        } catch (error) {
          duplicateServe = error
        }
        await waitForAbort(signal)
      }
    })
    try {
      await remote.ready()
      expect(missingResolver).toMatchObject({ code: 'REMOTE_CONTRACT_INVALID' })
      expect(duplicateServe).toMatchObject({ code: 'INVALID_OPTION' })
      const feature = await remote.use('p')
      expect(await feature.f!.m!(['host'])).toBe('host')
      expect(resolvePlugin).toHaveBeenCalledExactlyOnceWith('p', undefined)
      expect(await remote.unUse('p')).toEqual({ ok: true })
    } finally {
      await remote.release()
      await servedHost.dispose()
      budget.close()
    }
  })

  it('serves a Plugin Feature without a handshake or serialized definition', async () => {
    const localHost = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const servedHost = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await servedHost.use(
      definePlugin({
        name: 'p',
        features: { f: defineFeature(() => ({ m: (value: unknown) => value })) },
        install: () => ({})
      })
    )
    const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false })
    const plugin = createCoroutinePlugin({
      name: 'p',
      contract,
      host: {
        disable: (name, options) => localHost.plugin.disable(name, options),
        enable: (name) => localHost.plugin.enable(name)
      },
      budget,
      report: (error) => {
        throw error
      },
      task: async ({ signal, serve }) => {
        await serve(servedHost)
        await waitForAbort(signal)
      }
    })
    try {
      const [handle] = await localHost.use(plugin)
      const feature = handle.getFeature('f') as { m(params: unknown[]): Promise<unknown> }
      expect(await feature.m(['plugin'])).toBe('plugin')
    } finally {
      await localHost.dispose()
      await servedHost.dispose()
      budget.close()
    }
  })
})
