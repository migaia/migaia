import { definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import {
  createRemoteGenerationHolder,
  createRemoteRuntimeRegistration
} from '../../dist/remote/proxy.js'
import { remoteHarness } from './fixture.js'

/** Original native generation resources remain visible to ordinary Host rollback diagnostics. */
describe('managed registration Host rollback', () => {
  it('reports a channel rollback failure through the Host without replacing setup failure', async () => {
    /** Actual native ports retain channel-close identity without invoking any retired RPC facade. */
    const fixture = remoteHarness()
    /** Cleanup and preparation keep their independent original identities. */
    const cleanupError = new Error('channel cleanup failed')
    /** The primary setup error comes from the same registered configuration contract. */
    const setupError = new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.schedulerInvalid
    )
    /** Ordinary PluginHost owns rollback diagnostics; the remote holder does not absorb them. */
    const diagnostics: { code: string | undefined; error: unknown }[] = []
    /** Original report calls remain independently observable. */
    const report = vi.fn()
    /** The actual remaining generation registration acquires the channel before preparation fails. */
    const registration = createRemoteRuntimeRegistration({
      binding: {
        ...fixture.binding,
        openChannel: async () => ({
          ...fixture.channel,
          close: async () => {
            throw cleanupError
          }
        })
      },
      prepareRuntime: async () => {
        throw setupError
      },
      readRuntimeEndpoint: () => fixture.served,
      report
    })
    /** The canonical holder contributes all acquired cleanup to its ordinary Host owner. */
    const holder = createRemoteGenerationHolder(registration, report)
    /** PluginHost retains the original rollback policy and diagnostic shape. */
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      diagnostic: (_message, code, error) => diagnostics.push({ code, error })
    })
    /** This fixture installs only lifecycle resources, with no legacy Feature proxy assembly. */
    const definition = definePlugin({
      name: 'p',
      setup: async (context) => {
        context.onDispose(holder.release)
        await holder.prepareInitial(context.operation.signal)
        return {}
      },
      install: () => ({})
    })
    try {
      await expect(host.use(definition)).rejects.toMatchObject({
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
})
