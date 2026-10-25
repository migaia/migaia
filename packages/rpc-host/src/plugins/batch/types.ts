/**
 * Defines cold batching options and the original frame/write/cancellation facts retained by a lane.
 * These contracts connect complete frame hooks to physical continuations; Session identity and
 * semantic provider execution are not part of the batching boundary.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IRpcFlowContext,
  IRpcCarrierFrame,
  IRpcFrameNext,
  IRpcFrameWriteOptions
} from '@migaia/rpc-contract/interfaces'

/** Existing namespace/required declarations scope optional physical batching at installation. */
export type IRpcBatchOptions = Readonly<{ namespaces?: readonly string[]; required?: boolean }>
/** A logical member retains only its actual write facts and physical continuation until drain. */
export type IRpcBatchInput = Readonly<{
  frame: IRpcCarrierFrame
  context: IRpcFlowContext
  next: IRpcFrameNext
}>
/** One queued member has independent cancellation and completion inside a shared physical write. */
export type IRpcBatchEntry = {
  frame: IRpcCarrierFrame
  next: IRpcFrameNext
  write: IRpcFrameWriteOptions | undefined
  signal: IAbortSignal
  bound: number
  cancelled: boolean
  failed: boolean
  failure: unknown
  started: boolean
  remove(): void
  resolve(): void
  reject(reason: unknown): void
}
