import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import {
  createAdapterDeployment,
  defineTransportPlugin,
  createEventEmitterMessageResource,
  holdAdapterMessageBootstrapSource
} from '@migaia/rpc-host/plugin'
import { createNodeThreadChannel } from '../../dist/threads/channel.js'
import { THREAD_RUNTIME_API_VERSION } from '../../src/threads/constants.js'

/**
 * Author a cold native bootstrap transport; the canonical SDK owns validation, capture and
 * adoption.
 */
function nativeChildSource(port: MessageChannel['port2'], bootstrap: unknown) {
  return defineTransportPlugin({
    name: 'native-child-port',
    mode: 'connect-to-parent',
    deployment: createAdapterDeployment({
      open: async () => {
        throw new Error('bootstrap-only fixture')
      },
      bootstrap: (context) =>
        holdAdapterMessageBootstrapSource(createEventEmitterMessageResource(port), {
          initial: { direction: 'inbound', read: () => bootstrap },
          connectTimeoutMs: context.connectTimeoutMs,
          report: context.report
        })
    })
  })
}

describe('advanced native parent-port startup', () => {
  it('connects the actual borrowed native ports using the original raw child bootstrap', async () => {
    /** The caller owns both real ports; Peer shutdown only removes borrowed listeners. */
    const ports = new MessageChannel()
    /** Keep all successfully opened peers available even if the opposite construction fails. */
    const peers: Pick<IRpcHost, 'close'>[] = []
    /** The advanced child consumes the same raw metadata a native Worker receives at construction. */
    let child!: Promise<IRpcHost>
    try {
      /** The parent supplies its actual Core-selected identity and capability proposal. */
      const parent = await createRpcHost<{ twice(value: number): number }>({
        self: { name: 'native-parent', instanceId: 'native-parent' },
        plugins: [
          defineTransportPlugin({
            name: 'parent-port',
            mode: 'connect',
            deployment: createAdapterDeployment({
              open: async (context) => {
                child = createRpcHost({
                  provide: { twice: (value: number) => value * 2 },
                  plugins: [
                    nativeChildSource(ports.port2, {
                      kind: rpcMessageCapabilityControl.data,
                      peerId: 'native-child',
                      runtimeApi: {
                        version: THREAD_RUNTIME_API_VERSION,
                        self: { name: 'native-child', instanceId: 'native-child' },
                        parent: context.self,
                        capabilities: context.capabilities
                      }
                    })
                  ]
                })
                return createNodeThreadChannel(ports.port1, 'native-child', {
                  scheduler: systemScheduler,
                  capabilities: context.capabilities
                })
              }
            })
          })
        ],
        report: () => undefined
      })
      peers.push(parent)
      /** Startup ACK yields the actual child Peer rather than accepting caller-supplied trust. */
      const accepted = await child
      peers.push(accepted)
      expect(accepted.self).toEqual({ name: 'native-child', instanceId: 'native-child' })
      expect(await parent.request('twice', 21)).toBe(42)
      await accepted.close()
      expect(ports.port2.listenerCount('message')).toBe(0)
    } finally {
      await Promise.all(peers.map((peer) => peer.close()))
      ports.port1.close()
      ports.port2.close()
    }
  })

  it('rejects cloneable incomplete workerData before exposing a provider or retaining the native listener', async () => {
    /** A real MessagePort still belongs to the caller when native bootstrap validation fails. */
    const ports = new MessageChannel()
    /** No public method may run before its child metadata has been admitted. */
    const provide = vi.fn((value: number) => value)
    /** Caller diagnostics exercise the advanced API's explicit reporter path. */
    const report = vi.fn()
    try {
      await expect(
        createRpcHost({
          provide: { echo: provide },
          report,
          plugins: [
            nativeChildSource(ports.port2, {
              kind: rpcMessageCapabilityControl.data,
              peerId: 'native-child'
            })
          ]
        })
      ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'INVALID_CONFIG' })
      expect(provide).not.toHaveBeenCalled()
      expect(ports.port2.listenerCount('message')).toBe(0)
    } finally {
      ports.port1.close()
      ports.port2.close()
    }
  })
})
