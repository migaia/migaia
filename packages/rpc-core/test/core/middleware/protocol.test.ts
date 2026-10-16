import { describe, expect, it } from 'vitest'
import { canonicalProtocol as protocol } from '../../../dist/core/middleware/canonical-protocol.js'
import { RpcCoreErrorCode } from '../../../dist/core/errors.js'
import { RpcCoreErrorText } from '../../../dist/core/error-text.js'
import { RpcPortName } from '../../../dist/core/internal/plugin-shared-keys.js'
import { rpcProtocolV1 } from '@migaia/rpc-contract'
import type { IRpcPluginInstallResult, IRpcPluginInstallScope } from '../../../dist/core/typing.js'

function scope(): IRpcPluginInstallScope {
  const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined }
  return {
    id: 'a',
    transport,
    signal: new AbortController().signal,
    hooks: () => undefined,
    getPort: () => undefined,
    own: <T>(resource: T): T => resource
  }
}

describe('protocol plugin', () => {
  it('contributes only the semantic normalizer and leaves byte conversion to codec()', () => {
    const result = protocol(rpcProtocolV1).install(scope()) as IRpcPluginInstallResult
    expect(result.extension).toEqual({})
    expect(result.ports).toMatchObject({ [RpcPortName.protocol]: rpcProtocolV1 })
  })

  it('rejects legacy encode/decode installation before the Host can subscribe', () => {
    expect(() => protocol({ encode: () => undefined, decode: () => undefined } as never)).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
  })

  it('turns a hostile normalizer getter into the canonical coded configuration error', () => {
    const cause = new Error('hostile protocol normalize')
    const descriptor = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'normalize') throw cause
          return undefined
        }
      }
    )
    expect(() => protocol(descriptor as never)).toThrow(
      expect.objectContaining({
        code: RpcCoreErrorCode.invalidConfig,
        message: RpcCoreErrorText.codecDescriptorInvalid,
        cause
      })
    )
  })
})
