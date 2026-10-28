/** Preserve profile negotiation and foreign error causality after retiring JSONRPC control syntax. */
import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  serializeRpcWireError,
  type IRpcHello
} from '@migaia/rpc-contract/protocol'
import { hello } from '../fixtures/core-profile.ts'
import { TOKEN } from '../fixtures/handshake-privacy.ts'

/** The three actually declared handlers retain their original ordered extension identities. */
const REQUIRED = ['batch@1', 'abort@1', 'wire-error@1']

/** A pure diagnostic offer contains no live IO or native capability authority. */
function offer(id: string, extensions = REQUIRED): IRpcHello {
  return hello(id, extensions) as IRpcHello
}

describe('sole-profile readiness', () => {
  it('completes control negotiation with diagnostic peer identity and no implicit native capabilities', () => {
    const original = { ...offer('caller'), auth: TOKEN }
    const accepted = acceptRpcHandshake(original, offer('peer'))
    const agreement = completeRpcHandshake(original, accepted)
    expect(agreement.codec).toBe('json')
    expect(agreement.extensions).toEqual(REQUIRED)
    expect(agreement.peer.id).toBe('peer')
    expect('nativeBinary' in agreement).toBe(false)
    expect(inspect(agreement, { depth: null })).not.toContain(TOKEN)
  })

  it.each(REQUIRED)(
    'rejects absent actual required handler %s after otherwise valid control admission',
    (missing) => {
      const original = { ...offer('caller'), requiredExtensions: REQUIRED }
      expect(() =>
        acceptRpcHandshake(
          original,
          offer(
            'peer',
            REQUIRED.filter((value) => value !== missing)
          )
        )
      ).toThrowError(expect.objectContaining({ code: 'EXTENSION_NEGOTIATION_FAILED' }))
    }
  )

  it.each([-32601, -32602])(
    'retains foreign integer-code diagnostics %s through an actual flat reject cause',
    (code) => {
      const original = offer('caller')
      const foreign = new TypeError('foreign hello failure')
      Object.defineProperties(foreign, {
        source: { value: 'jsonrpc-2.0', enumerable: true },
        code: { value: String(code), enumerable: true }
      })
      const reject = {
        profile: original.profile,
        kind: 'handshake',
        step: 'reject',
        error: serializeRpcWireError(foreign, { report: () => undefined })
      }
      expect(() => completeRpcHandshake(original, reject)).toThrowError(
        expect.objectContaining({
          code: 'HANDSHAKE_REJECTED',
          cause: expect.objectContaining({
            source: 'jsonrpc-2.0',
            code: String(code),
            stack: foreign.stack
          })
        })
      )
    }
  )
})
