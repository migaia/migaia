import { type ITtlTarget, assertStorageTtlTarget } from '@migaia/storage-contract'
import { snapshotLockKey } from './concurrency.ts'

/** Capture the original lock target only when middleware or native admission can await. */
export function snapshotStorageTtlTarget(
  target: ITtlTarget,
  backend: string | undefined
): ITtlTarget {
  assertStorageTtlTarget(target, backend)
  return snapshotLockKey(target, backend) as ITtlTarget
}
