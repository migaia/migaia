import { describe, expect, it } from 'vitest'
import { connect } from '../../src/middleware/connect'
import { installPlugin } from './helpers'

describe('connect middleware', () => {
  it('installs peer verification capability', async () => {
    const transport = {
      platform: 'Memory' as const,
      send() {},
      subscribe: () => () => undefined,
      peerId: 'trusted'
    }
    const values = installPlugin(connect({ transport }), transport)
    const capability = values.get('connectCapability') as {
      verify(context: { senderId: string; targetId: string }): boolean | Promise<boolean>
    }
    await expect(capability.verify({ senderId: 'trusted', targetId: 'a' })).resolves.toBe(true)
    await expect(capability.verify({ senderId: 'other', targetId: 'a' })).resolves.toBe(false)
    await expect(capability.verify({ senderId: 'trusted', targetId: 'other' })).resolves.toBe(false)
  })
  it('uses base verification by default and only invokes identifier when explicitly enabled', async () => {
    const transport = {
      platform: 'Memory' as const,
      send() {},
      subscribe: () => () => undefined,
      peerId: 'trusted'
    }
    let calls = 0
    const base = connect({
      transport,
      identifier: () => {
        calls += 1
        return false
      }
    })
    const values = new Map<string, unknown>()
    const installed = installPlugin(base, transport)
    for (const [key, value] of installed) values.set(key, value)
    const capability = values.get('connectCapability') as {
      verify(context: { senderId: string; targetId: string }): boolean | Promise<boolean>
    }
    await expect(capability.verify({ senderId: 'trusted', targetId: 'a' })).resolves.toBe(true)
    expect(calls).toBe(0)
    expect(() =>
      installPlugin(connect({ transport, useBaseIdVerifyOnly: false }), transport)
    ).toThrow('identifier is required')
  })
  it('rejects source-only base identity without a configured peer or origin', async () => {
    const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined }
    const values = installPlugin(connect({ transport }), transport)
    const capability = values.get('connectCapability') as {
      verify(context: {
        senderId: string
        targetId: string
        source?: unknown
      }): boolean | Promise<boolean>
    }
    await expect(capability.verify({ senderId: 'peer', targetId: 'a', source: {} })).resolves.toBe(
      false
    )
  })
  it('accepts source-less identity on an explicitly exclusive Worker transport', async () => {
    const transport = {
      platform: 'Worker' as const,
      topology: 'exclusive' as const,
      send() {},
      subscribe: () => () => undefined
    }
    const values = installPlugin(connect({ transport }), transport)
    const capability = values.get('connectCapability') as {
      verify(context: {
        senderId: string
        targetId: string
        platform: 'Worker'
        topology: 'exclusive'
      }): boolean | Promise<boolean>
    }
    await expect(
      capability.verify({
        senderId: 'peer',
        targetId: 'a',
        platform: 'Worker',
        topology: 'exclusive'
      })
    ).resolves.toBe(true)
  })
  it('rejects a non-boolean base verification option during installation', () => {
    const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined }
    expect(() =>
      installPlugin(connect({ transport, useBaseIdVerifyOnly: 'yes' as never }), transport)
    ).toThrow('useBaseIdVerifyOnly must be a boolean')
  })
  it('ignores logical target uniqueness unless verified identifier mode is active', () => {
    const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined }
    const values = installPlugin(connect({ transport, uniqueTargetId: 'tab-a' }), transport)
    expect((values.get('connectCapability') as { uniqueTargetId?: string }).uniqueTargetId).toBe(
      undefined
    )
  })
  it('rejects a primitive transport during installation', () => {
    expect(() =>
      installPlugin(connect({ transport: 'not-a-transport' as never }), 'not-a-transport' as never)
    ).toThrow('connect transport is required')
  })
  it('rejects an incomplete transport during installation', () => {
    expect(() => installPlugin(connect({ transport: {} as never }), {} as never)).toThrow(
      'connect transport must provide send and subscribe functions'
    )
  })
  it('does not read mutable verification policy after installation', async () => {
    const transport = {
      platform: 'Memory' as const,
      send() {},
      subscribe: () => () => undefined,
      peerId: 'trusted'
    }
    const config: { transport: typeof transport; useBaseIdVerifyOnly?: boolean } = { transport }
    const values = installPlugin(connect(config), transport)
    config.useBaseIdVerifyOnly = false
    const capability = values.get('connectCapability') as {
      verify(context: { senderId: string; targetId: string }): boolean | Promise<boolean>
    }
    await expect(capability.verify({ senderId: 'trusted', targetId: 'a' })).resolves.toBe(true)
  })
  it('snapshots discovery mode before installation', () => {
    const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined }
    const config: { transport: typeof transport; discoveryMode?: 'automatic' | 'manual' } = {
      transport,
      discoveryMode: 'manual'
    }
    const values = installPlugin(connect(config), transport)
    config.discoveryMode = 'automatic'
    expect((values.get('connectCapability') as { discoveryMode?: string }).discoveryMode).toBe(
      'manual'
    )
  })
})
