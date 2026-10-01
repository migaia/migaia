import { definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import {
  createProcessInstanceFallback,
  type IProcessInstanceFault
} from '../../src/process/resilience/fallback.js'

/** A trusted replacement has the same target name as the installed Host definition. */
const replacement = definePlugin({ name: 'p', install: () => ({}) })

describe('process instance fallback', () => {
  it('[A5] closes every shared session before one target replacement', async () => {
    let emit: (event: IProcessInstanceFault) => void = () => undefined
    const order: string[] = []
    const replace = vi.fn(async (_name: string, _candidate: unknown) => {
      order.push('replace')
    })
    const createSharedTarget = vi.fn(async () => {
      order.push('candidate')
      return replacement
    })
    const fallback = createProcessInstanceFallback({
      mode: 'shared',
      targetName: 'p',
      host: { replace },
      createSharedTarget,
      onInstanceUnhealthy(listener) {
        emit = listener
        return () => undefined
      },
      report: vi.fn()
    })
    fallback.add({
      connectionId: 'a',
      close: async () => {
        order.push('close-a')
      }
    })
    fallback.add({
      connectionId: 'b',
      close: async () => {
        order.push('close-b')
      }
    })
    emit({ targetName: 'other', reason: new Error('other') })
    expect(fallback.version).toBe(0)
    emit({ targetName: 'p', reason: new Error('instance') })
    await fallback.ready()
    expect(order.slice(0, 2)).toEqual(['close-a', 'close-b'])
    expect(order.slice(2)).toEqual(['candidate', 'replace'])
    expect(replace).toHaveBeenCalledExactlyOnceWith('p', replacement)
    expect(fallback.version).toBe(1)
    await fallback.close()
  })

  it('[A5] keeps a failed shared target fenced and reports its original failure', async () => {
    let emit: (event: IProcessInstanceFault) => void = () => undefined
    const failure = new Error('candidate failed')
    const report = vi.fn()
    const fallback = createProcessInstanceFallback({
      mode: 'shared',
      targetName: 'p',
      host: { replace: vi.fn() },
      createSharedTarget: async () => {
        throw failure
      },
      onInstanceUnhealthy(listener) {
        emit = listener
        return () => undefined
      },
      report
    })
    emit({ targetName: 'p', reason: failure })
    await expect(fallback.ready()).rejects.toBe(failure)
    expect(report).toHaveBeenCalledExactlyOnceWith(failure)
    await fallback.close()
  })

  it('[A5] closes only the affected per-connection session', async () => {
    let emit: (event: IProcessInstanceFault) => void = () => undefined
    const first = vi.fn(async () => undefined)
    const second = vi.fn(async () => undefined)
    const replace = vi.fn()
    const fallback = createProcessInstanceFallback({
      mode: 'per-connection',
      targetName: 'p',
      host: { replace },
      onInstanceUnhealthy(listener) {
        emit = listener
        return () => undefined
      },
      report: vi.fn()
    })
    fallback.add({ connectionId: 'a', close: first })
    fallback.add({ connectionId: 'b', close: second })
    emit({ targetName: 'p', connectionId: 'a', reason: new Error('instance') })
    await fallback.ready()
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    await fallback.close()
  })

  it('[A5] replaces a real Host target without changing the process owner', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const first = definePlugin({ name: 'p', install: () => ({ version: () => 1 }) })
    const next = definePlugin({ name: 'p', install: () => ({ version: () => 2 }) })
    const [handle] = await host.use(first)
    let emit: (event: IProcessInstanceFault) => void = () => undefined
    const fallback = createProcessInstanceFallback({
      mode: 'shared',
      targetName: 'p',
      host,
      createSharedTarget: () => next,
      onInstanceUnhealthy(listener) {
        emit = listener
        return () => undefined
      },
      report: vi.fn()
    })
    try {
      expect(handle.extensions.version()).toBe(1)
      emit({ targetName: 'p', reason: new Error('unhealthy') })
      await fallback.ready()
      expect(handle.extensions.version()).toBe(2)
    } finally {
      await fallback.close()
      await host.dispose()
    }
  })
})
