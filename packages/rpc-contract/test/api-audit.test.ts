import { describe, expect, it } from 'vitest'
import * as root from '@migaia/rpc-contract'
import * as protocol from '@migaia/rpc-contract/protocol'
import { normalizeRpcCarrierFrame, normalizeRpcSteps } from '@migaia/rpc-contract/protocol'

describe('audited pure RPC contract', () => {
  it('publishes the sole profile and canonical named operations through actual entries', () => {
    expect('default' in protocol).toBe(false)
    expect('createReassembler' in root).toBe(false)
    expect('processStringFramer' in root).toBe(false)
    expect(typeof protocol.normalizeRpcFrame).toBe('function')
    expect(root.normalizeRpcFrame).toBe(protocol.normalizeRpcFrame)
  })
  it.each(['carrier', 'steps'] as const)(
    'classifies %s reflection failure and retains its cause',
    (kind) => {
      /** The hostile descriptor trap fails before any business field can be read. */
      const original = new Error('reflection failed')
      /** Descriptor introspection is a supported untrusted-input boundary. */
      const value =
        kind === 'carrier'
          ? new Proxy(
              { kind: 'message', data: null },
              {
                getOwnPropertyDescriptor: () => {
                  throw original
                }
              }
            )
          : new Proxy([], {
              ownKeys: () => {
                throw original
              }
            })
      try {
        if (kind === 'carrier') normalizeRpcCarrierFrame(value, new Set())
        else normalizeRpcSteps(value)
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError)
        expect(error).toMatchObject({
          source: 'rpc.contract',
          code: 'INVALID_ENVELOPE',
          cause: original
        })
      }
    }
  )
})

it('keeps custom physical data opaque at the canonical carrier shell boundary', () => {
  let opaqueReads = 0
  const opaque = {
    get kind() {
      opaqueReads++
      return 'opaque'
    }
  }
  expect(normalizeRpcCarrierFrame({ kind: 'message', data: opaque }, new Set()).data).toBe(opaque)
  expect(opaqueReads).toBe(0)
})
