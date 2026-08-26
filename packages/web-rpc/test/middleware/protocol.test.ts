import { describe, expect, it } from 'vitest'
import { protocol } from '../../src/middleware/protocol'
import { WebRpcErrorCode } from '../../src/errors'
import { WebRpcSharedKey } from '../../src/internal/plugin-shared-keys'
import type { IWebRpcPluginInstallResult, IWebRpcPluginInstallScope } from '../../src/typing'

function scope(): IWebRpcPluginInstallScope {
  const transport = { platform: 'Memory' as const, send() {}, subscribe: () => () => undefined }
  return {
    id: 'a',
    transport,
    signal: { aborted: false, addEventListener() {}, removeEventListener() {} },
    hooks: () => undefined,
    getShared: () => undefined,
    own: <T>(resource: T): T => resource
  }
}

describe('protocol plugin', () => {
  it('returns normalized encode/decode capability through the typed shared result', () => {
    const result = protocol({
      encode: (value: unknown) => JSON.stringify(value),
      decode: (value: unknown) => JSON.parse(String(value))
    }).install(scope()) as IWebRpcPluginInstallResult
    const capability = result.shared[WebRpcSharedKey.protocol] as {
      encode(value: unknown): unknown
      decode(value: unknown): unknown
    }
    expect(result.extension).toEqual({})
    expect(capability.decode(capability.encode({ ok: true }))).toEqual({ ok: true })
  })

  it('rejects unreadable configuration with the native error identity', () => {
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('protocol getter')
        }
      }
    )
    expect(() => protocol(unreadable as never).install(scope())).toThrow(
      expect.objectContaining({ code: WebRpcErrorCode.invalidConfig })
    )
  })
})
