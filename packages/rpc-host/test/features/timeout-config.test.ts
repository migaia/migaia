/** Retains old middleware input rejection through the complete public timeout feature factory. */
import { describe, expect, it } from 'vitest'
import timeout from '@migaia/rpc-host/features/timeout'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'

describe('public timeout feature configuration', () => {
  it('rejects the original negative duration before installation', () => {
    expect(() => timeout({ ms: -1 })).toThrow()
  })

  it('rejects the original null descriptor with INVALID_CONFIG', () => {
    expect(() => timeout(null as never)).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
  })

  it('rejects the original unreadable descriptor with INVALID_CONFIG', () => {
    /** The public factory must categorize acquisition of the same original hostile descriptor. */
    const unreadable = new Proxy(
      {},
      {
        get() {
          throw new Error('timeout getter')
        }
      }
    )
    expect(() => timeout(unreadable as never)).toThrow(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
  })
})
