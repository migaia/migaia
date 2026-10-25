/** Original codec failure assertions use the public call and its actual executing media boundary. */
import { RpcError, RpcSerializationError, RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { expect, it, vi } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

it('preserves a semantic encode error before framing', async () => {
  /** The original codec throws this exact semantic admission failure before physical handoff. */
  const admissionError = new RpcError(RpcCoreErrorCode.overloaded, 'outbound capacity')
  /** Actual native installation and ready handshakes precede the controlled encoding failure. */
  const fixture = await connectedCoreHosts({}, { read: () => 42 }, () => undefined)
  /** Only one executing encode fails; every other media stage remains the original implementation. */
  const encoding = vi.spyOn(fixture.pair[0].codec, 'encode').mockImplementationOnce(() => {
    throw admissionError
  })
  try {
    /** The public Promise owns the failure previously observed by the private synchronous sender. */
    const thrown = await fixture.a.memory.request('read').then(
      () => undefined,
      (error: unknown) => error
    )
    expect(thrown).toMatchObject({ code: RpcCoreErrorCode.payloadInvalid, cause: admissionError })
  } finally {
    encoding.mockRestore()
    await fixture.close()
  }
})

it.each(['frame encode failed', 'selected codec failed'])(
  'rejects the original codec failure %s before any physical write',
  async (message) => {
    /** These two original bare codec errors independently exercise the public serialization family. */
    const failure = new Error(message)
    /** Keep the original public host and actual physical codec rather than a selected v1 facade. */
    const fixture = await connectedCoreHosts({}, { read: () => 42 }, () => undefined)
    /** Failed encoding must never enter the real original physical write. */
    const writing = vi.spyOn(fixture.pair[0], 'write')
    /** Throw at the same semantic encode stage after the real Session becomes ready. */
    const encoding = vi.spyOn(fixture.pair[0].codec, 'encode').mockImplementationOnce(() => {
      throw failure
    })
    try {
      await expect(fixture.a.memory.request('read')).rejects.toBeInstanceOf(RpcSerializationError)
      expect(writing).toHaveBeenCalledTimes(0)
    } finally {
      encoding.mockRestore()
      writing.mockRestore()
      await fixture.close()
    }
  }
)

it('rejects a codec serialization failure before send', async () => {
  /** This unbranded public serialization error is the exact original selected-codec input. */
  const failure = new RpcSerializationError(RpcCoreErrorText.protocolEncodedType('string'))
  /** Real handshake encoding completes before the original one-shot encode fault is installed. */
  const fixture = await connectedCoreHosts({}, { read: () => 42 }, () => undefined)
  /** Original zero-send assertion observes the actual physical sender. */
  const writing = vi.spyOn(fixture.pair[0], 'write')
  /** The codec retains its actual prepare/restore methods and fails only this first encode. */
  const encoding = vi.spyOn(fixture.pair[0].codec, 'encode').mockImplementationOnce(() => {
    throw failure
  })
  try {
    await expect(fixture.a.memory.request('read')).rejects.toThrow('Protocol encode failed')
    expect(writing).toHaveBeenCalledTimes(0)
  } finally {
    encoding.mockRestore()
    writing.mockRestore()
    await fixture.close()
  }
})
