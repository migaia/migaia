import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { PluginHost, type IHostCoreConstructionRequest } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'
import { createRpcHost, type IRpcNamespace } from '@migaia/rpc-host'
import {
  createRpcMessageCarrier,
  defineTransportPlugin,
  rpcHostPipelines
} from '@migaia/rpc-host/sdk'

/** Fixed return types keep the lazy owner reference out of recursive Host inference. */
type IRpcSetup = ReturnType<typeof rpcHostPipelines>
/** The domain core carries only the execution authority supplied by the one SDK function. */
type IRpcCore = ReturnType<IRpcSetup['domainCore']>

/** The real class consumer lends protected execution through its own lexical access. */
class NativeTrayHost extends PluginHost<IRpcCore, unknown, readonly []> {
  /** The same cold SDK configuration supplies declarations and every registration's domain core. */
  readonly #rpc: IRpcSetup

  /** No owner getter runs before super completes or before this actual native Host exists. */
  constructor() {
    /** These lazy arrows preserve protected access without exposing a public pipeline facade. */
    const rpc = rpcHostPipelines(
      () => this,
      (name, request) => this.pipeline(name, request)
    )
    super({
      identity: { name: 'tray-rpc-class' },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    this.#rpc = rpc
  }

  /** SDK installation still checks this exact Host against the genuine native core identity. */
  protected override createPluginDomainCore(request: IHostCoreConstructionRequest): IRpcCore {
    return this.#rpc.domainCore(request)
  }
}

describe('Tray class RPC pipeline authority', () => {
  it('uses the single SDK function for real protected-class execution through public createHost', async () => {
    /** Native ports provide the real media; neither side fabricates handshake or Session metadata. */
    const pair = new MessageChannel()
    /** The original provider must execute exactly once through the actual remote public Host. */
    const echo = vi.fn((value: unknown) => value)
    /**
     * Every diagnostic retains its original value without printing credentials or synthetic
     * reports.
     */
    const reports: unknown[] = []
    /** Both SDK carriers acquire their original native listener/remover and write operations. */
    const carriers = [pair.port1, pair.port2].map((port, index) =>
      createRpcMessageCarrier({
        id: `tray-class-${index}`,
        nativeBinary: true,
        report: (error) => {
          reports.push(error)
        },
        io: {
          send(value, transfer, options) {
            options?.onWriteStart?.()
            port.postMessage(value, transfer === undefined ? undefined : [...transfer])
          },
          onMessage(listener) {
            port.on('message', listener)
            return () => {
              port.off('message', listener)
            }
          },
          onClose(listener) {
            port.on('close', listener)
            return () => {
              port.off('close', listener)
            }
          },
          close() {
            port.close()
          }
        }
      })
    )
    /** The genuine native class is created by Tray's supported public factory callback. */
    const managedOpening = createHost({
      create: () => new NativeTrayHost(),
      plugins: [
        defineTransportPlugin({
          name: 'class-transport',
          namespace: 'memory',
          async open(context) {
            await context.attach(carriers[0]!, { expectedPeerId: 'tray-rpc-client' }).ready
            return { dispose: () => undefined }
          }
        })
      ],
      mutationAdmissionMs: 1000,
      quiescenceMs: 1000,
      shutdown: { mode: 'strict-drain' },
      report: (error) => {
        reports.push(error)
      }
    })
    /** Remote acquisition runs concurrently so both real Sessions can finish bilateral acceptance. */
    const clientOpening = createRpcHost({
      self: { name: 'tray-rpc-client', instanceId: 'tray-rpc-client' },
      provide: { echo },
      plugins: [
        defineTransportPlugin({
          name: 'client-transport',
          namespace: 'memory',
          async open(context) {
            await context.attach(carriers[1]!).ready
            return { dispose: () => undefined }
          }
        })
      ],
      report: (error) => {
        reports.push(error)
      }
    })
    /** Public construction and cleanup retain the real managed facade and remote Host. */
    const [managed, client] = await Promise.all([managedOpening, clientOpening])
    try {
      /** Native extension publication, rather than a copied owner port, supplies this namespace. */
      const namespace = Reflect.get(managed.extensions, 'memory') as IRpcNamespace
      expect(await namespace.send('tray-rpc-client', 'echo', { value: 42 })).toEqual({ value: 42 })
      expect(echo).toHaveBeenCalledTimes(1)
      expect(reports).toEqual([])
    } finally {
      await client.close()
      await managed.dispose()
      pair.port1.close()
      pair.port2.close()
    }
  })
})
