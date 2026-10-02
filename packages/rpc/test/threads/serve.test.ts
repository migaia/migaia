import { describe, expect, it, vi } from 'vitest'
import * as remoteServe from '../../src/remote/serve-plugin.js'
import { createServeThreadPlugin } from '../../src/threads/serve.js'
import { contract } from './fixture.js'

describe('thread serve teardown ownership', () => {
  it('[A6] closes the remote service before its channel and retains close Promise identity', async () => {
    /** This log distinguishes ownership order at the existing remote/channel boundaries. */
    const order: string[] = []
    /** Remote remains the service owner; the wrapper only orchestrates its existing close. */
    const service = vi.spyOn(remoteServe, 'serveRemotePlugin').mockResolvedValue({
      close: async () => {
        order.push('service')
      }
    })
    try {
      /** The endpoint is irrelevant to the wrapper's close-order contract. */
      const handle = await createServeThreadPlugin({
        host: {} as never,
        contract,
        endpointFactory: async () => ({}) as never,
        channel: {
          close: async () => {
            order.push('channel')
          }
        } as never,
        report: vi.fn()
      })
      /** Repeated closes must join the exact first Promise and perform cleanup only once. */
      const closing = handle.close()
      expect(handle.close()).toBe(closing)
      await closing
      expect(order).toEqual(['service', 'channel'])
    } finally {
      service.mockRestore()
    }
  })

  it('[A6] reports rollback cleanup failure without replacing the primary setup error', async () => {
    /** Caller identity must remain reachable without a cleanup error taking precedence. */
    const primary = new Error('thread endpoint primary failure')
    /** The secondary channel error belongs exclusively to local reporting. */
    const cleanup = new Error('thread channel rollback failure')
    /** Report proves the secondary failure is not silently swallowed. */
    const report = vi.fn()
    /** Settle first so the discriminator is a direct assertion rather than Promise matcher plumbing. */
    const failure = await createServeThreadPlugin({
      host: {} as never,
      contract,
      endpointFactory: async () => {
        throw primary
      },
      channel: {
        close: async () => {
          throw cleanup
        }
      } as never,
      report
    }).catch((error: unknown) => error)
    expect(failure).toBe(primary)
    expect(report).toHaveBeenCalledExactlyOnceWith(cleanup)
  })
})
