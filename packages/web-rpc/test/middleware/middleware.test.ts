import { describe, expect, it } from 'vitest'
import {
  abort,
  chunk,
  connect,
  contract,
  hooks,
  ping,
  protocol,
  timeout,
  uuid
} from '../../src/middleware/index'
import type { IWebRpcPluginInstallResult } from '../../src/typing'
import { installPlugin, pluginScope } from './helpers'
import { WebRpcErrorCode } from '../../src/errors'
import { WebRpcSharedKey } from '../../src/internal/plugin-shared-keys'

describe('middleware capabilities', () => {
  it('installs concrete capability values for every built-in middleware', async () => {
    const transport = {
      platform: 'Memory' as const,
      send: () => undefined,
      subscribe: () => () => undefined
    }
    const middlewares = [
      connect({ transport }),
      uuid(),
      timeout({ timeoutMs: 10 }),
      chunk({ chunkSize: 8 }),
      hooks(),
      abort(),
      ping()
    ]
    const values = new Map<string, unknown>()
    for (const middleware of middlewares)
      for (const [key, value] of installPlugin(middleware, transport)) values.set(key, value)
    expect(values.has('connectCapability')).toBe(true)
    expect(values.has('timeoutCapability')).toBe(true)
    expect(values.has('chunkCapability')).toBe(true)
    expect(values.get('abortCapability')).toEqual({ enabled: true })
    expect(values.get('pingCapability')).toEqual({ enabled: true })
    const protocolResult = protocol().install(pluginScope()) as IWebRpcPluginInstallResult
    const contractResult = contract({ version: '1' }).install(
      pluginScope()
    ) as IWebRpcPluginInstallResult
    expect(protocolResult.shared[WebRpcSharedKey.protocol]).toBeDefined()
    expect(contractResult.shared[WebRpcSharedKey.contract]).toBeDefined()
  })

  it('rejects invalid middleware configuration during installation', async () => {
    const invalid = [timeout({ timeoutMs: -1 }), chunk({ chunkSize: 0 }), chunk({ chunkSize: 3 })]
    for (const middleware of invalid) {
      await expect(Promise.resolve().then(() => installPlugin(middleware))).rejects.toThrow()
    }
    expect(() => contract({ version: '' }).install(pluginScope())).toThrow()
  })
  it('rejects null built-in middleware descriptors with INVALID_CONFIG', () => {
    expect(() => protocol(null as never).install(pluginScope())).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
    expect(() => installPlugin(hooks(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
    expect(() => installPlugin(timeout(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
    expect(() => installPlugin(chunk(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
    expect(() => installPlugin(uuid(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
    expect(() => installPlugin(connect(null as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
  })
  it('rejects unreadable protocol descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('protocol getter')
        }
      }
    )
    expect(() => protocol(unreadable as never).install(pluginScope())).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
  })
  it('rejects unreadable hooks descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('hooks getter')
        }
      }
    )
    expect(() => installPlugin(hooks(unreadable as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
  })
  it('rejects unreadable timeout descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('timeout getter')
        }
      }
    )
    expect(() => installPlugin(timeout(unreadable as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
    expect(() => installPlugin(timeout({ retry: 1 } as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
  })
  it('rejects unreadable chunk descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('chunk keys')
        }
      }
    )
    expect(() => installPlugin(chunk(unreadable as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
  })
  it('rejects unreadable uuid descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('uuid getter')
        }
      }
    )
    expect(() => installPlugin(uuid(unreadable as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
  })
  it('rejects unreadable connect descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('connect getter')
        }
      }
    )
    expect(() => installPlugin(connect(unreadable as never))).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
  })
})
