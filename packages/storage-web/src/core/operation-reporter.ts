/**
 * Observes operation cleanup failures within storage-web. Stays outside storage-contract and the
 * public package API, with no global singleton. Enforces
 * `docs/store-persist/storage-web-integration.sdd.md` §4.4: `removeEventListener` cleanup failures
 * do not throw or alter the primary operation result. A reporter observes them, as required by the
 * AGENTS.md rule for catches that do not rethrow.
 */
export type IStorageOperationReporter = (error: unknown) => void | PromiseLike<void>

/** Carries one runtime per operation through the internal call chain. */
export type IStorageOperationRuntime = {
  readonly reporter: IStorageOperationReporter
}

/**
 * Creates the default reporter at the final diagnostic boundary, where the web adapter may use
 * `console`.
 */
export function createStorageOperationReporter(): IStorageOperationReporter {
  return (error) => console.error('[storage-web] operation cleanup failed', error)
}

/** Creates one runtime at each public operation entry. Does not share a singleton. */
export function createStorageOperationRuntime(): IStorageOperationRuntime {
  return { reporter: createStorageOperationReporter() }
}

/** Reporter 自身失败的不可递归 fallback（最后诊断边界）。 */
function reportReporterFailure(error: unknown): void {
  try {
    const result = console.error('[storage-web] operation reporter failed', error) as unknown
    if (result !== undefined) void Promise.resolve(result).catch(() => undefined)
  } catch {
    // 最终硬吞：console.error 自身也失败时只做 containment，保证永不 unhandled rejection。
  }
}

/**
 * Reports cleanup failures through the primary reporter. Falls back if the reporter throws or
 * rejects.
 */
export function reportCleanupError(reporter: IStorageOperationReporter, error: unknown): void {
  let result: void | PromiseLike<void>
  try {
    result = reporter(error)
  } catch (reporterError) {
    reportReporterFailure(reporterError)
    return
  }
  if (result !== undefined) void Promise.resolve(result).catch(reportReporterFailure)
}
