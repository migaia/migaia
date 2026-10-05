import {
  defineFeature,
  definePlugin,
  isDefinedPlugin,
  PluginHost,
  PluginHostErrorCode
} from '@migaia/plugin-host'
import { describe, expect, it } from 'vitest'
import { createRemotePlugin } from '../../src/remote/plugin.js'
import { assembleRemotePluginDefinition } from '../../src/remote/internal/assemble-plugin.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import { RpcCoreErrorCode, RpcError } from '../../src/core/errors.js'
import { RpcCoreErrorText } from '../../src/core/error-text.js'
import { vi } from 'vitest'
import { REMOTE_FIXTURE_CONTRACT, remoteHarness, remoteDescription } from './fixture.js'

describe('remote PluginHost assembly', () => {
  it('keeps internal metadata on the trusted frozen definition', async () => {
    const fixture = remoteHarness()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const options = {
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      binding: fixture.binding,
      endpointFactory: async () => fixture.served,
      host: host.plugin,
      report: (error: unknown) => {
        throw error
      }
    }
    const publicDefinition = createRemotePlugin(options)
    const replace = vi.fn(async () => undefined)
    const processDefinition = assembleRemotePluginDefinition(options, { replace })
    try {
      expect(isDefinedPlugin(publicDefinition)).toBe(true)
      expect(Object.hasOwn(publicDefinition, 'replace')).toBe(false)
      expect(isDefinedPlugin(processDefinition)).toBe(true)
      expect(processDefinition.replace).toBe(replace)
      expect(Object.isFrozen(processDefinition)).toBe(true)
      expect(Object.getOwnPropertyDescriptor(processDefinition, 'replace')).toMatchObject({
        writable: false,
        configurable: false
      })
      await expect(host.use(processDefinition)).resolves.toHaveLength(1)
    } finally {
      await host.dispose()
    }
  })

  it('reports a channel rollback failure through the Host without replacing setup failure', async () => {
    const fixture = remoteHarness()
    const cleanupError = new Error('channel cleanup failed')
    const setupError = new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.schedulerInvalid
    )
    const diagnostics: { code: string | undefined; error: unknown }[] = []
    const report = vi.fn()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      diagnostic: (_message, code, error) => diagnostics.push({ code, error })
    })
    const remote = createRemotePlugin({
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      binding: {
        ...fixture.binding,
        async openChannel() {
          return {
            ...fixture.channel,
            async close() {
              throw cleanupError
            }
          }
        }
      },
      endpointFactory: async () => {
        throw setupError
      },
      host: host.plugin,
      report
    })
    try {
      await expect(host.use(remote)).rejects.toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: setupError
      })
      expect(report).not.toHaveBeenCalled()
      const rollback = diagnostics.filter((item) => item.code === 'PLUGIN_INSTALL_ROLLBACK_FAILED')
      expect(rollback).toHaveLength(1)
      const rollbackError = rollback[0]!.error
      expect(rollbackError).toBeInstanceOf(AggregateError)
      expect((rollbackError as AggregateError).errors).toContain(cleanupError)
    } finally {
      await host.dispose()
    }
  })

  it('keeps description failure as the primary install error and releases both resources', async () => {
    const fixture = remoteHarness()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const remote = createRemotePlugin({
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      binding: fixture.binding,
      endpointFactory: async () => ({
        ...fixture.served,
        endpoint: {
          async send() {
            return remoteDescription([
              {
                ...REMOTE_FIXTURE_CONTRACT,
                features: { f: { methods: { request: { mode: 'request', idempotent: true } } } }
              }
            ])
          },
          async dispose() {
            fixture.calls.push('endpoint.dispose')
          }
        } as unknown as IRpcEndpoint
      }),
      host: host.plugin,
      report: () => undefined
    })
    try {
      await expect(host.use(remote)).rejects.toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: { code: 'REMOTE_CONTRACT_INVALID' }
      })
      expect(fixture.calls.filter((call) => call === 'endpoint.dispose')).toHaveLength(1)
      expect(fixture.calls.filter((call) => call === 'channel.close')).toHaveLength(1)
    } finally {
      await host.dispose()
    }
  })

  it('prepares the described generation before a dependent invokes its Feature', async () => {
    const fixture = remoteHarness()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const remote = createRemotePlugin({
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      binding: fixture.binding,
      endpointFactory: async () => fixture.served,
      host: host.plugin,
      report: (error) => {
        throw error
      }
    })
    let result: unknown
    const dependent = definePlugin({
      name: 'dependent',
      features: {
        use: defineFeature(
          (_core, dependencies) => {
            result = (
              dependencies.remote as { request: (params: unknown[]) => Promise<unknown> }
            ).request(['value'])
            return {}
          },
          { remote: remote.getFeature('f') }
        )
      },
      install: () => ({})
    })
    try {
      await host.use(remote)
      await host.use(dependent)
      expect(await result).toBe('result')
      expect(fixture.calls.indexOf('endpoint.create')).toBeLessThan(
        fixture.calls.indexOf('endpoint.dispose') === -1
          ? fixture.calls.length
          : fixture.calls.indexOf('endpoint.dispose')
      )
      expect(fixture.sends[0]?.method).toBe('migaia.remote.runtime.describe')
      expect(fixture.sends[1]?.method).toBe('p.f.request')
    } finally {
      await host.dispose()
    }
  })

  it('keeps a healthy replacement bound while retrying a failed enable', async () => {
    const fixture = remoteHarness()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const report = vi.fn()
    let enables = 0
    let failAlways = false
    const remote = createRemotePlugin({
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      binding: fixture.binding,
      endpointFactory: async () => fixture.served,
      host: {
        disable: (name, options) => host.plugin.disable(name, options),
        enable: async (name) => {
          enables += 1
          if (failAlways || enables < 3) throw new Error('busy enable')
          await host.plugin.enable(name)
        }
      },
      report
    })
    const [handle] = await host.use(remote)
    const request = (handle.getFeature('f') as { request(params: unknown[]): Promise<unknown> })
      .request
    try {
      fixture.emit({ type: 'exit', generation: 1, reason: 'crashed' })
      fixture.nextGeneration()
      fixture.emit({ type: 'state', from: 'backoff', to: 'ready', generation: 2 })
      /** The scheduler, not elapsed wall time, drives each enable retry. */
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      expect(enables).toBe(1)
      await expect(request([])).resolves.toBe('result')
      const scheduler = fixture.binding.scheduler as { advance(ms: number): void }
      scheduler.advance(10)
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      expect(enables).toBe(2)
      scheduler.advance(20)
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      expect(enables).toBe(3)
      expect(host.plugin.disabled()).not.toContain('p')
      expect(report).not.toHaveBeenCalled()
      failAlways = true
      fixture.emit({ type: 'exit', generation: 2, reason: 'crashed' })
      fixture.nextGeneration()
      fixture.emit({ type: 'state', from: 'backoff', to: 'ready', generation: 3 })
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      scheduler.advance(10)
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      scheduler.advance(20)
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      expect(enables).toBe(6)
      expect(report).toHaveBeenCalledTimes(1)
      await expect(request([])).resolves.toBe('result')
      scheduler.advance(1000)
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      expect(enables).toBe(6)
    } finally {
      await host.dispose()
    }
  })

  it('retries a failed disable on the next ready event before enabling a replacement', async () => {
    const fixture = remoteHarness()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const report = vi.fn()
    let disables = 0
    const mutationError = Object.assign(new Error('temporary mutation rejection'), {
      code: PluginHostErrorCode.lifecycleMutation
    })
    const remote = createRemotePlugin({
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      binding: fixture.binding,
      endpointFactory: async () => fixture.served,
      host: {
        disable: async (name, options) => {
          disables += 1
          if (disables === 1) throw mutationError
          await host.plugin.disable(name, options)
        },
        enable: (name) => host.plugin.enable(name)
      },
      report
    })
    const [handle] = await host.use(remote)
    const request = (handle.getFeature('f') as { request(params: unknown[]): Promise<unknown> })
      .request
    try {
      fixture.emit({ type: 'exit', generation: 1, reason: 'crashed' })
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      expect(disables).toBe(1)
      expect(report).toHaveBeenCalledExactlyOnceWith(mutationError)
      fixture.nextGeneration()
      fixture.emit({ type: 'state', from: 'backoff', to: 'ready', generation: 2 })
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
      expect(disables).toBe(2)
      expect(host.plugin.disabled()).not.toContain('p')
      await expect(request([])).resolves.toBe('result')
    } finally {
      await host.dispose()
    }
  })
})
