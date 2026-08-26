import { SerializeChunkKind, type ISerializeChunk } from '@migaia/serialize'
import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import { WorkerByteOwnership, type IWorkerByteOwnership } from '../worker-constants.js'

/** Returns an exclusive ArrayBuffer only when a byte view is safe to transfer. */
function exclusiveBuffer(bytes: Uint8Array): ArrayBuffer | undefined {
  // SharedArrayBuffer is cloneable but not transferable.
  if (!isArrayBuffer(bytes.buffer)) return undefined
  if (bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) return undefined
  return bytes.buffer
}

/** Builds a transfer list without placing non-transferable shared memory in it. */
export function transferablesOf(
  chunk: ISerializeChunk,
  ownership: IWorkerByteOwnership
): Transferable[] {
  if (ownership !== WorkerByteOwnership.transfer || chunk[0] !== SerializeChunkKind.bytes) return []
  if (!isUint8Array(chunk[1])) return []
  const buffer = exclusiveBuffer(chunk[1])
  return buffer ? [buffer] : []
}
