import {
  type ITtlTarget,
  assertStorageTtlTarget,
  type IBackendKind
} from '@migaia/storage-contract'
import { snapshotLockKey } from './concurrency.js'

/** Capture the original lock target only when middleware or native admission can await. */
export function snapshotStorageTtlTarget(
  target: ITtlTarget,
  backend: IBackendKind | undefined
): ITtlTarget {
  assertStorageTtlTarget(target, backend)
  return snapshotLockKey(target, backend) as ITtlTarget
}
