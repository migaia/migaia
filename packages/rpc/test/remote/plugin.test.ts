import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it } from 'vitest'
import { createRemotePlugin } from '../../src/remote/plugin.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import { RpcCoreErrorCode, RpcError } from '../../src/core/errors.js'
import { RpcCoreErrorText } from '../../src/core/error-text.js'
import { vi } from 'vitest'
import { REMOTE_FIXTURE_CONTRACT, remoteHarness } from './fixture.js'

describe('remote PluginHost assembly', () => {
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
            return {
              ...REMOTE_FIXTURE_CONTRACT,
              features: { f: { methods: { request: { mode: 'request', idempotent: true } } } }
            }
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
      expect(fixture.sends[0]?.method).toBe('migaia.remote.describe')
      expect(fixture.sends[1]?.method).toBe('p.f.request')
    } finally {
      await host.dispose()
    }
  })
})
