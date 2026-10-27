/** Original stream-open data remains admitted through the sole public wire grammar. */
import { normalizeRpcFrame, normalizeRpcStream, RpcWireKind } from '@migaia/rpc-contract/protocol'
import { expect, it } from 'vitest'
import { header } from '../fixtures/core-profile.js'

// Moves the unchanged event data into the stream slot.
it('admits the original portable open event without changing its stream data', () => {
  /** Only the representation and correlated task change; the original event stays exact. */
  const envelope = normalizeRpcFrame({
    ...header('stream'),
    kind: RpcWireKind.stream,
    stream: { event: 'open', seq: 0 }
  })
  expect(RpcWireKind.stream).toBe('stream')
  expect(envelope.kind).toBe(RpcWireKind.stream)
  if (envelope.kind !== RpcWireKind.stream) return
  expect(envelope.stream).toEqual({ event: 'open', seq: 0 })
  expect(normalizeRpcStream(envelope.stream)).toEqual({ event: 'open', seq: 0 })
})
