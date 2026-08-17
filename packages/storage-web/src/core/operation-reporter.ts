/**
 * Storage-web 内部 operation cleanup 观测机制（不进 storage-contract、不对外暴露、不用全局 singleton）。
 *
 * 契约见 `docs/store-persist/storage-web-integration.sdd.md` §4.4：`removeEventListener` 的 cleanup
 * 失败不抛、 不改变主操作结果，但必须经 reporter 观测（AGENTS.md「catch 不重抛必须 report」）。
 */
export type IStorageOperationReporter = (error: unknown) => void;

/** 内部传播载体：每次 operation 一个 runtime，沿内部调用链传递。 */
export type IStorageOperationRuntime = {
  readonly reporter: IStorageOperationReporter;
};

/** 默认 reporter：直接进入最后诊断边界（web adapter 允许 console）。 */
export function createStorageOperationReporter(): IStorageOperationReporter {
  return (error) => console.error('[storage-web] operation cleanup failed', error);
}

/** 每个 public operation 入口创建一次，非 singleton。 */
export function createStorageOperationRuntime(): IStorageOperationRuntime {
  return { reporter: createStorageOperationReporter() };
}

/** Reporter 自身失败的不可递归 fallback（最后诊断边界）。 */
function reportReporterFailure(error: unknown): void {
  try {
    console.error('[storage-web] operation reporter failed', error);
  } catch {
    // 最终硬吞：console.error 自身也失败时仅做同步 containment，保证永不 unhandled rejection。
  }
}

/** 统一观测入口：cleanup 错误经 primary reporter 观测；reporter 抛错走 fallback，永不 unhandled。 */
export function reportCleanupError(reporter: IStorageOperationReporter, error: unknown): void {
  try {
    reporter(error);
  } catch (reporterError) {
    reportReporterFailure(reporterError);
  }
}
