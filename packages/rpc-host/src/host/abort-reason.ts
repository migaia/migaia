/** Native cancellation keeps the original reason, including a failed structural property read. */
import type { IAbortSignal } from '@migaia/utils/promise'
import { tryReadProperty } from '@migaia/utils/error'

/** Read once; a throwing reason getter becomes the original cancellation reason. */
export function resolveAbortReason(signal: Pick<IAbortSignal, 'reason'>): unknown {
  /** One guarded property read keeps a trap failure reachable without introducing a wrapper. */
  const read = tryReadProperty(signal, 'reason')
  return read.threw ? read.error : read.value
}
