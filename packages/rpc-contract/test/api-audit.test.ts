import { describe, expect, it } from 'vitest'
import * as root from '@migaia/rpc-contract'
import * as protocol from '@migaia/rpc-contract/protocol'
import { normalizeRpcCarrierFrame } from '@migaia/rpc-contract/protocol'

describe('audited pure RPC contract', () => {
  it('publishes the sole profile and canonical named operations through actual entries', () => {
    expect('default' in protocol).toBe(false)
    expect('createReassembler' in root).toBe(false)
    expect('processStringFramer' in root).toBe(false)
    expect(typeof protocol.normalizeRpcFrame).toBe('function')
    expect(root.normalizeRpcFrame).toBe(protocol.normalizeRpcFrame)
  })
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
