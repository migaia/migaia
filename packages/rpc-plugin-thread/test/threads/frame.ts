import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { RpcWireJsonCodec, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'

/** Decode captured native writes through the one production codec, preserving physical order. */
export async function threadFrames(
  values: readonly Readonly<{ message: unknown }>[]
): Promise<IRpcSemanticFrame[]> {
  /** These original deadline/health cases contain portable values without native backing slots. */
  const codec = new RpcJsonCarrierCodec()
  /** The actual negotiated JSON carrier performs the only metadata admission and restoration. */
  const context = { codec: RpcWireJsonCodec, nativeBinary: true, maxFrameBytes: 64 * 1024 * 1024 }
  /** Each captured message is independently owned by the original native write observation. */
  const frames: IRpcSemanticFrame[] = []
  for (const { message } of values) {
    const prepared = await codec.decode(message as IRpcCarrierFrame, context)
    frames.push(await codec.restore(prepared, context))
  }
  return frames
}
