import { describe, expect, it } from 'vitest'
import { abort } from '../../../dist/core/middleware/abort.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { hooks } from '../../../dist/core/middleware/hooks.js'
import { ping } from '../../../dist/core/middleware/ping.js'
import { timeout } from '../../../dist/core/middleware/timeout.js'
import { installPlugin } from './helpers.js'
import { RpcCoreErrorCode } from '../../../dist/core/errors.js'

describe('middleware capabilities', () => {
  it('installs concrete capability values for every built-in middleware', async () => {
    const transport = {
      platform: 'Memory' as const,
      send: () => undefined,
      subscribe: () => () => undefined
    }
    const middlewares = [
      connect({ transport }),
      timeout({ timeoutMs: 10 }),
      hooks(),
      abort(),
      ping()
    ]
    const values = new Map<string, unknown>()
    for (const middleware of middlewares)
      for (const [key, value] of installPlugin(middleware, transport)) values.set(key, value)
    expect(values.has('connectCapability')).toBe(true)
    expect(values.has('timeoutCapability')).toBe(true)
    expect(values.get('abortCapability')).toEqual({ enabled: true })
    expect(values.get('pingCapability')).toEqual({ enabled: true })
  })

  it('rejects invalid middleware configuration during installation', async () => {
    const invalid = [timeout({ timeoutMs: -1 })]
    for (const middleware of invalid) {
      await expect(Promise.resolve().then(() => installPlugin(middleware))).rejects.toThrow()
    }
  })
  it('rejects null built-in middleware descriptors with INVALID_CONFIG', () => {
    expect(() => installPlugin(hooks(null as never))).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
    expect(() => installPlugin(timeout(null as never))).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )

    expect(() => installPlugin(connect(null as never))).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
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
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
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
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
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
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
  })
})
