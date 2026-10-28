import type { IStorageOperationStageObserver } from '@migaia/storage-contract'
import type { IScheduler } from '@migaia/utils/scheduler'
import { readStorageHookFailureCode } from '../hooks.ts'

/**
 * Observe one already-admitted native batch through the original stage binding and clock. The
 * caller retains operation admission, pipeline execution and transaction ownership.
 */
export async function observeStorageBatch<R>(
  stages: IStorageOperationStageObserver,
  scheduler: IScheduler,
  operation: string,
  count: number | undefined,
  invoke: () => R | Promise<R>
): Promise<R> {
  /** Elapsed time includes the original pipeline, native settlement and synchronous observations. */
  const started = scheduler.now()
  void stages.beforeStorageOperation?.(operation, count)
  try {
    /** Native work runs exactly once and its original result is returned unchanged. */
    const result = await invoke()
    void stages.afterStorageOperation?.(
      operation,
      Math.max(0, scheduler.now() - started),
      typeof result === 'number' ? result : (count ?? 0)
    )
    return result
  } catch (error) {
    void stages.onStorageOperationError?.(
      operation,
      readStorageHookFailureCode(error, stages.report),
      count
    )
    throw error
  }
}
