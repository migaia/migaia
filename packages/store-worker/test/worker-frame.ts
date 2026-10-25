import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { RpcWireJsonCodec, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import type { IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'

/** Read already captured physical messages through the actual codec instead of a test wire parser. */
export async function workerFrames(values: readonly unknown[]): Promise<IRpcSemanticFrame[]> {
  /** Tests borrow the same production metadata admission and restoration algorithm. */
  const codec = new RpcJsonCarrierCodec()
  /** These captured Store worker wrappers contain portable values without native binary sidecars. */
  const context = { codec: RpcWireJsonCodec, nativeBinary: false, maxFrameBytes: 64 * 1024 * 1024 }
  /** Preserve original physical ordering while each real frame is decoded and restored once. */
  const frames: IRpcSemanticFrame[] = []
  for (const value of values) {
    const prepared = await codec.decode(value as IRpcCarrierFrame, context)
    frames.push(await codec.restore(prepared, context))
  }
  return frames
}
