import { asCodecValue } from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { describe, expect, it } from 'vitest'
import { messageFramerV1 } from '../../src/contract/framing/index.js'
import { RpcCapability, RpcCodecId, RpcProtocol } from '../../src/contract/wire-constants.js'

describe('process channel S1 upstream inventory', () => {
  it('uses the existing portable-value guard before the JSON codec', () => {
    /** The future boundary adapter must delegate to this exact codec. */
    const codec = defineJsonCodec({ version: 1 })
    /** A valid portable value establishes the byte-for-byte baseline. */
    const portable = asCodecValue({ request: ['ready', 1, null] })
    expect(codec.encode(portable)).toBe('{"request":["ready",1,null]}')
    expect(() => asCodecValue(undefined)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION', source: '@migaia/serialize' })
    )
  })

  it('records why the default framer cannot feed a string-only byte transport', () => {
    expect(messageFramerV1.outputEncodedType).toBe('unknown')
    expect(RpcProtocol).toMatchObject({ major: 1, minor: 1 })
    expect(RpcCodecId.json).toBe('json')
    expect([RpcCapability.ping, RpcCapability.close, RpcCapability.stream]).toEqual([
      'ping@1',
      'close@1',
      'stream@1'
    ])
  })
})
