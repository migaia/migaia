import { describe, expect, it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { readEndpointClientCounters } from '../../src/core/internal/endpoint-projection.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { createThreadPeer } from '../../src/threads/peer.js'
import { runtimeSources } from '../runtime-api/fixture.js'

/** Actual source offers retain the required v2/batch baseline without optional controls. */
const capabilities = [RpcCapability.runtimeApi, RpcCapability.batch]

describe('thread serve teardown ownership', () => {
  it('[A6] closes the remote service before its channel and retains close Promise identity', async () => {
    /** This log distinguishes ownership order at the existing remote/channel boundaries. */
    const order: string[] = []
    /** Both public factories own real endpoints over the existing reference memory carrier. */
    const channels = runtimeSources(capabilities, capabilities)
    /** Observe removal of the actual endpoint subscription while preserving transport identity. */
    const subscribe = channels.transports[0].subscribe
    const subscription = vi
      .spyOn(channels.transports[0], 'subscribe')
      .mockImplementation((receive) => {
        const remove = subscribe(receive)
        return () => {
          order.push('service')
          remove()
        }
      })
    /** The left source retains the original channel disposer instead of creating another owner. */
    const self = { name: 'service', instanceId: 'service-1' }
    const [handle, other] = await Promise.all([
      createThreadPeer({
        self,
        connect: async (context) => {
          const channel = await channels.sources[0](context)
          return {
            ...channel,
            close: async () => {
              /** Channel teardown begins only after the original endpoint is fully disposed. */
              expect(
                readEndpointClientCounters(readRuntimePeerConnection(handle).endpoint)
              ).toBeUndefined()
              order.push('channel')
              await channel.close()
            }
          }
        },
        report: () => undefined
      }),
      createThreadPeer({
        self: { name: 'caller', instanceId: 'caller-1' },
        connect: channels.sources[1],
        report: () => undefined
      })
    ])
    try {
      /** Repeated closes must join the exact first Promise and perform cleanup only once. */
      const closing = handle.close()
      expect(handle.close()).toBe(closing)
      await closing
      expect(order).toEqual(['service', 'channel'])
    } finally {
      await handle.close()
      await other.close()
      channels.close()
      subscription.mockRestore()
    }
  })

  it('[A6] reports rollback cleanup failure without replacing the primary setup error', async () => {
    /** Caller identity must remain reachable without a cleanup error taking precedence. */
    const primary = new Error('thread endpoint primary failure')
    /** The secondary channel error belongs exclusively to local reporting. */
    const cleanup = new Error('thread channel rollback failure')
    /** Report proves the secondary failure is not silently swallowed. */
    const report = vi.fn()
    /** Bilateral source preparation remains real even when one endpoint fails to construct. */
    const channels = runtimeSources(capabilities, capabilities)
    /** Observe the expected failed publication before any teardown can reject the other side. */
    const failed = createThreadPeer({
      self: { name: 'service', instanceId: 'service-1' },
      connect: async (context) => {
        const channel = await channels.sources[0](context)
        return {
          ...channel,
          close: async () => {
            await channel.close()
            throw cleanup
          }
        }
      },
      endpointFactory: async () => {
        throw primary
      },
      report
    }).catch((error: unknown) => error)
    /** The opposite genuine endpoint waits for its directory until physical rollback closes it. */
    const other = createThreadPeer({
      self: { name: 'caller', instanceId: 'caller-1' },
      connect: channels.sources[1],
      report: () => undefined
    }).then(
      (peer) => ({ peer }),
      (error: unknown) => ({ error })
    )
    try {
      expect(await failed).toBe(primary)
      expect(report).toHaveBeenCalledExactlyOnceWith(cleanup)
    } finally {
      channels.close()
      const settled = await other
      if ('peer' in settled) await settled.peer.close()
    }
  })
})
