import { describe, expect, it, vi } from 'vitest'
import { RpcCapability } from '@migaia/rpc-contract'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-core'
import { createProcessTransport } from '@migaia/rpc-process'
import type { IProcessByteOptions, IProcessMessageOptions } from '@migaia/rpc-process'

/** One fixed declaration stays valid while each case changes one admission requirement. */
const declaration = { codec: 'identity', capabilities: [RpcCapability.ping] }

describe('process transport validates before acquiring a physical carrier', () => {
  /** Each invalid declaration must reject before any message carrier operation is invoked. */
  it.each([
    { name: 'missing static agreement', agreement: undefined },
    { name: 'missing local declaration', agreement: { peer: declaration } },
    { name: 'missing peer declaration', agreement: { local: declaration } },
    {
      name: 'unsupported local codec',
      agreement: { local: { ...declaration, codec: 'json' }, peer: declaration }
    },
    {
      name: 'unsupported peer codec',
      agreement: { local: declaration, peer: { ...declaration, codec: 'json' } }
    },
    {
      name: 'different capability count',
      agreement: { local: declaration, peer: { codec: 'identity', capabilities: [] } }
    },
    {
      name: 'different capability at the same index',
      agreement: {
        local: declaration,
        peer: { codec: 'identity', capabilities: [RpcCapability.batch] }
      }
    }
  ])('rejects $name with the native configuration TypeError', async ({ agreement }) => {
    /** No invalid public declaration may acquire a reader, post a control frame, or close a port. */
    const channel = {
      kind: 'message' as const,
      send: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      close: vi.fn()
    }
    /** Runtime admission must also reject input supplied by an untyped caller. */
    const options = {
      peerId: 'validation-peer',
      report: vi.fn(),
      ipc: { connectionId: 'validation-connection', sessionId: 'validation-session', log: vi.fn() },
      ...(agreement === undefined ? {} : { staticAgreement: agreement })
    } as unknown as IProcessMessageOptions
    /** Validation rejects asynchronously through the original public operation. */
    const rejected = createProcessTransport(channel, options)
    await expect(rejected).rejects.toBeInstanceOf(TypeError)
    await expect(rejected).rejects.toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig
    })
    expect(channel.send).not.toHaveBeenCalled()
    expect(channel.onMessage).not.toHaveBeenCalled()
    expect(channel.onClose).not.toHaveBeenCalled()
    expect(channel.close).not.toHaveBeenCalled()
  })

  /** Missing handshake policy must reject before the byte port obtains a physical reader. */
  it('rejects a byte carrier without its explicit handshake role before reading', async () => {
    /** Byte handshake policy is required before any physical port resource is acquired. */
    const channel = {
      kind: 'byte' as const,
      write: vi.fn(),
      onData: vi.fn(),
      onClose: vi.fn(),
      close: vi.fn()
    }
    /** The missing public role is deliberate; all unrelated common fields remain valid. */
    const options = {
      peerId: 'validation-peer',
      report: vi.fn(),
      ipc: { connectionId: 'validation-connection', sessionId: 'validation-session', log: vi.fn() }
    } as unknown as IProcessByteOptions
    /** Validation failure must keep native TypeError while adding Core's semantic code. */
    const rejected = createProcessTransport(channel, options)
    await expect(rejected).rejects.toBeInstanceOf(TypeError)
    await expect(rejected).rejects.toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig
    })
    expect(channel.write).not.toHaveBeenCalled()
    expect(channel.onData).not.toHaveBeenCalled()
    expect(channel.onClose).not.toHaveBeenCalled()
    expect(channel.close).not.toHaveBeenCalled()
  })
})
