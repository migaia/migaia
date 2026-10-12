import { fileURLToPath } from 'node:url'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createThreadPeer } from '../../src/threads/index.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'
import { createFixtureAuthentication } from './fixtures/dx-authentication.mjs'

/** The actual Worker provide descriptor publishes these ordinary request result shapes. */
type IBytesApi = {
  bytes: {
    inspect(buffer: ArrayBuffer): { length: number; first: number }
    calls(): number
  }
}

/** Ordinary spawn options exercise canonical endpoint assembly without an endpointFactory. */
function source(signed: boolean, report: (error: unknown) => void) {
  return {
    spec: {
      entry: fileURLToPath(new URL('./fixtures/dx-signed-worker.mjs', import.meta.url)),
      data: { signed }
    },
    budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
    scheduler: systemScheduler,
    launcher: createNodeThreadLauncher(),
    channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
    report
  }
}

describe('ordinary signed native-binary thread profile', () => {
  it('transfers through default factories and detaches the original buffer', async () => {
    /** Collected errors retain their original classification for fixture failure evidence. */
    const reported: unknown[] = []
    /** Only credentials configure signing; actual channel and middleware owners mint trust facts. */
    const options = { authentication: createFixtureAuthentication() }
    /** The public thread factory owns its real Worker and the existing default endpoint. */
    const peer = await createThreadPeer<IBytesApi>({
      ...options,
      spawn: source(true, (error) => reported.push(error)),
      report: (error) => reported.push(error)
    })
    try {
      /** Native transfer must detach caller storage once the signed frame reaches the held port. */
      const buffer = new Uint8Array([7, 8, 9]).buffer
      expect(await peer.request('bytes.inspect', buffer, { transfer: [buffer] })).toEqual({
        length: 3,
        first: 7
      })
      expect(buffer.byteLength).toBe(0)
      expect(reported).toEqual([])
    } finally {
      await peer.close()
    }
  })

  it('keeps unsigned transfer disabled and preserves caller storage', async () => {
    /** Unsigned endpoints retain the default copying profile despite native messaging support. */
    const peer = await createThreadPeer<IBytesApi>({
      spawn: source(false, () => undefined),
      report: () => undefined
    })
    try {
      /** Rejection before submission must leave the caller buffer usable. */
      const buffer = new Uint8Array([7, 8, 9]).buffer
      await expect(
        peer.request('bytes.inspect', buffer, { transfer: [buffer] })
      ).rejects.toMatchObject({
        source: '@migaia/rpc/core',
        code: 'CAPABILITY_UNSUPPORTED'
      })
      expect(buffer.byteLength).toBe(3)
      expect(await peer.request('bytes.calls')).toBe(0)
    } finally {
      await peer.close()
    }
  })

  it('rejects a forged signed transfer before the Worker provider executes', async () => {
    /** The normal credentials establish both endpoint sessions before one signature is corrupted. */
    const authentication = createFixtureAuthentication()
    /** Only the following application frame is deliberately forged by the test sender. */
    let forge = false
    /** Transform interception changes no channel agreement or private Core authority facts. */
    const options = {
      authentication: {
        ...authentication,
        sign: async (...args: Parameters<typeof authentication.sign>) => {
          /** The existing envelope remains intact; verification must reject this incorrect HMAC. */
          const signed = (await authentication.sign(...args)) as {
            value: unknown
            signature: string
          }
          return forge ? { ...signed, signature: '00'.repeat(32) } : signed
        }
      }
    }
    /** Canonical default factories must retain the same signature barrier as custom endpoints. */
    const peer = await createThreadPeer<IBytesApi>({
      ...options,
      spawn: source(true, () => undefined),
      report: () => undefined
    })
    try {
      /** The submitted native frame detaches storage even though the peer refuses its signature. */
      const buffer = new Uint8Array([7, 8, 9]).buffer
      forge = true
      await expect(
        peer.request('bytes.inspect', buffer, { transfer: [buffer], timeoutMs: 100 })
      ).rejects.toMatchObject({ source: '@migaia/rpc/core', code: 'DEADLINE_EXCEEDED' })
      expect(buffer.byteLength).toBe(0)
      forge = false
      expect(await peer.request('bytes.calls')).toBe(0)
    } finally {
      await peer.close()
    }
  })
})
