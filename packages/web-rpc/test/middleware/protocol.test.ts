import { describe, expect, it } from 'vitest'
import { canonicalProtocol as protocol } from '../../src/middleware/canonical-protocol.js'
import { WebRpcErrorCode } from '../../src/errors'
import { WebRpcErrorText } from '../../src/error-text.js'
import { WebRpcPortName } from '../../src/internal/plugin-shared-keys.js'
import { rpcProtocolV1 } from '@migaia/rpc-contract'
import type { IWebRpcPluginInstallResult, IWebRpcPluginInstallScope } from '../../src/typing'

function scope(): IWebRpcPluginInstallScope {
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

describe('protocol plugin', () => {
  it('contributes only the semantic normalizer and leaves byte conversion to codec()', () => {
    const result = protocol(rpcProtocolV1).install(scope()) as IWebRpcPluginInstallResult
    expect(result.extension).toEqual({})
    expect(result.ports).toMatchObject({ [WebRpcPortName.protocol]: rpcProtocolV1 })
  })

  it('rejects legacy encode/decode installation before the Host can subscribe', () => {
    expect(() => protocol({ encode: () => undefined, decode: () => undefined } as never)).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
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
        code: WebRpcErrorCode.invalidConfig,
        message: WebRpcErrorText.codecDescriptorInvalid,
        cause
      })
    )
  })
})
