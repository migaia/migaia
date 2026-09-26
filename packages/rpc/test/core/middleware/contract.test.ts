import { describe, expect, it } from 'vitest'
import { RpcCoreErrorCode } from '../../../src/core/errors.js'
import { contract } from '../../../src/core/middleware/contract.js'
import { RpcPortName } from '../../../src/core/internal/plugin-shared-keys.js'
import type {
  IRpcContractConfig,
  IRpcPluginInstallResult,
  IRpcPluginInstallScope
} from '../../../src/core/typing.js'

function scope(): IRpcPluginInstallScope {
  const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined }
  return {
    id: 'a',
    transport,
    signal: { aborted: false, addEventListener() {}, removeEventListener() {} },
    hooks: () => undefined,
    getPort: () => undefined,
    own: <T>(resource: T): T => resource
  }
}

function install(config: IRpcContractConfig) {
  const result = contract(config).install(scope()) as IRpcPluginInstallResult
  return result.ports[RpcPortName.contract] as {
    validateData: (method: string, side: 'params' | 'result', data: unknown) => void
  }
}

describe('contract plugin', () => {
  it('preserves a __proto__ schema method as an own key', () => {
    const schema = { parse: (value: unknown) => value }
    const capability = install({ schemas: { ['__proto__']: { params: schema, result: schema } } })
    expect(() => capability.validateData('__proto__', 'params', 'ok')).not.toThrow()
  })

  it('exposes schema validation through the typed shared result', () => {
    const capability = install({
      schemas: {
        add: {
          params: {
            parse: (value) => {
              if (typeof value !== 'number') throw new Error('number')
              return value
            }
          },
          result: { parse: (value) => value }
        }
      }
    })
    expect(() => capability.validateData('add', 'params', 'bad')).toThrow()
  })

  it('owns schema descriptor containers after installation', () => {
    const schema = { parse: (value: unknown) => value }
    const config = { schemas: { add: { params: schema, result: schema } } }
    const capability = install(config)
    config.schemas.add.params = {
      parse: () => {
        throw new Error('replacement')
      }
    }
    expect(() => capability.validateData('add', 'params', 'still accepted')).not.toThrow()
  })

  it('rejects malformed schema and version descriptors during installation', () => {
    expect(() =>
      install({ schemas: { add: { params: {} as never, result: {} as never } } })
    ).toThrow(expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig }))
    expect(() => install({ acceptVersions: [1] as never })).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
    expect(() => install({ acceptVersions: 1 as never })).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
    expect(() => install(null as never)).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
    expect(() => install('invalid' as never)).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
  })

  it('rejects unreadable contract descriptors with INVALID_CONFIG', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('contract getter')
        }
      }
    )
    expect(() => install(unreadable as never)).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
  })

  it('rejects a revoked acceptVersions container during installation', () => {
    const revoked = Proxy.revocable([], {})
    revoked.revoke()
    expect(() => install({ acceptVersions: revoked.proxy as never })).toThrow(
      'contract.acceptVersions is unreadable'
    )
  })
})
