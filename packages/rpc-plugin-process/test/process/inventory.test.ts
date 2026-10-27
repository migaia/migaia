import { asCodecValue } from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { describe, expect, it } from 'vitest'
import {
  RpcWireControlOperation,
  RpcWireKind,
  RpcWireJsonCodec,
  RpcWireProfile,
  RpcWireVersion
} from '@migaia/rpc-contract/protocol'

describe('process channel upstream inventory', () => {
  it('uses the existing portable-value guard before the JSON codec', () => {
    /** The future boundary adapter must delegate to this exact codec. */
    const codec = defineJsonCodec({ version: 1 })
    /** A valid portable value establishes the byte-for-byte baseline. */
    const portable = asCodecValue({ request: ['ready', 1, null] })
    expect(codec.encode(portable)).toBe('{"request":["ready",1,null]}')
    expect(() => asCodecValue(undefined)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION', source: 'serialization' })
    )
  })

  it('records the sole v2 carrier protocol and retained native capability vocabulary', () => {
    // Retires the v1 framer outputEncodedType oracle; this is the actual canonical v2 profile.
    expect(RpcWireProfile).toBe('migaia.rpc/2')
    expect(RpcWireVersion).toMatchObject({ major: 2, minor: 0 })
    expect(RpcWireJsonCodec).toBe('json')
    // Makes control and stream core grammar rather than opt-in v1 capability strings.
    // Appends graceful close while preserving the original three control operations.
    expect(RpcWireControlOperation).toEqual({
      ping: 'ping',
      pong: 'pong',
      drain: 'drain',
      close: 'close'
    })
    expect(RpcWireKind.stream).toBe('stream')
  })
})
