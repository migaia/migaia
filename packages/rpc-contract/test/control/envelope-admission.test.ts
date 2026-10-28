/** Legacy envelope business guards use the sole public grammar, without restoring v1 records. */
import { normalizeRpcFrame } from '@migaia/rpc-contract/protocol'
import { expect, it } from 'vitest'
import { header } from '../fixtures/core-profile.ts'

// Required routing and a valid ordinary request remain admitted.
it('requires routing before admitting the original ordinary request', () => {
  /** This is the current request shape with only the original required route removed. */
  const missing = { ...header(), route: undefined, options: {}, payload: null }
  expect(() => normalizeRpcFrame(missing)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ENVELOPE', pointer: '/route' })
  )
  expect(() => normalizeRpcFrame(missing)).toThrowError(TypeError)
  expect(normalizeRpcFrame({ ...header(), options: {}, payload: null })).toMatchObject({
    kind: 'call',
    task: { mode: 'request' }
  })
})

// Unsupported kinds precede route checks; payload stays portable.
it('rejects unsupported kinds before routing and refuses the original accessor payload', () => {
  /** The sole profile has its own discriminator; legacy handshake spelling is now a known kind. */
  const unknown = { ...header(), kind: 'unsupported', route: null, options: {} }
  expect(() => normalizeRpcFrame(unknown)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ENVELOPE', pointer: '/kind' })
  )
  /** The original payload accessor must remain outside the negotiated native portable domain. */
  const hostile = {
    get broken(): never {
      throw new Error('not read')
    }
  }
  expect(() => normalizeRpcFrame({ ...header(), options: {}, payload: hostile })).toThrowError(
    expect.objectContaining({ code: 'INVALID_ENVELOPE' })
  )
})
