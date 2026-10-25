/** The actual SDK byte decoder preserves the original fatal native failure. */
import { RpcUtf8 } from '@migaia/rpc-host/sdk'
import { expect, it, vi } from 'vitest'

it('preserves the real fatal UTF-8 decoder error through handshake failure cause', () => {
  /** Native decode semantics remain unchanged while recording the actual original exception. */
  const NativeDecoder = globalThis.TextDecoder
  /** Only the real decoding failure, not a manufactured fixture error, can satisfy this assertion. */
  let original: unknown
  /** The subclass delegates the actual native byte validation before retaining a thrown value. */
  class ObservedDecoder extends NativeDecoder {
    override decode(...args: Parameters<TextDecoder['decode']>): string {
      try {
        return super.decode(...args)
      } catch (error) {
        original = error
        throw error
      }
    }
  }
  vi.stubGlobal('TextDecoder', ObservedDecoder)
  /** The actual SDK captures its fatal decoder before the native global is restored. */
  const receiver = new RpcUtf8()
  vi.unstubAllGlobals()
  /** This is malformed UTF-8, independent of handshake JSON grammar. */
  let failure: unknown
  try {
    receiver.decode(new Uint8Array([255]))
    expect.unreachable()
  } catch (error) {
    failure = error
  }
  expect(original).toBeInstanceOf(TypeError)
  expect(failure).toMatchObject({
    source: 'rpc.contract',
    code: 'HANDSHAKE_INVALID',
    cause: original
  })
})
