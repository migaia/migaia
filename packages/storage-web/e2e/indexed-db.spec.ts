import { test, expect } from '@playwright/test';

test('真实 IndexedDB 的基本 put/get 冒烟测试', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbSmokeScenario());
  expect(result.ok).toBe(true);
  expect(result.value).toEqual({ a: 1 });
  expect(result.metadata).toEqual({ ready: true });
});

test('真实浏览器 IndexedDB options 非法容器统一返回 INVALID_CONFIG', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbOptionsGuardScenario());
  expect(result).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT'
  ]);
});

test('版本升级被另一个存活连接阻塞时 onblocked 触发，连接关闭后可重新打开', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbBlockedScenario());
  expect(result.blockedErrorCode).toBe('BACKEND_UNAVAILABLE');
  expect(result.sameStoreRetrySucceeded).toBe(true);
  expect(result.secondOpenSucceededAfterClose).toBe(true);
  expect(result.hostileCloseRetrySucceeded).toBe(true);
  expect(result.transitionCloseCode).toBe('BACKEND_UNAVAILABLE');
  expect(result.transitionCloseRetrySucceeded).toBe(true);
  expect(result.schemaInspectionCodes).toEqual(['BACKEND_UNAVAILABLE', 'BACKEND_UNAVAILABLE']);
  expect(result.schemaInspectionRecovered).toBe(true);
  expect(result.connectionSetterCodes).toEqual(['BACKEND_UNAVAILABLE', 'BACKEND_UNAVAILABLE']);
  expect(result.connectionSetterRecovered).toBe(true);
});

test('跨 IndexedDB connection 的 transaction revision 冲突不会覆盖新写入', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbTransactionConflictScenario());
  expect(result.code).toBe('TRANSACTION_CONFLICT');
  expect(result.value).toEqual({ value: 2 });
});

test('真实 IndexedDB transaction scope 逃逸 callback 后拒绝读写', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbEscapedTransactionScopeScenario());
  expect(result.getCode).toBe('TRANSACTION_FAILED');
  expect(result.putCode).toBe('TRANSACTION_FAILED');
  expect(result.deleteCode).toBe('TRANSACTION_FAILED');
  expect(result.outsideValue).toBeUndefined();
});

test('真实 IndexedDB 小页分页扫描完整且提前停止', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbPagedScanScenario());
  expect(result.count).toBe(257);
  expect(result.first).toBe('record-000');
  expect(result.last).toBe('record-256');
  expect(result.stoppedEarly).toBe(true);
  expect(result.listenerSetupCode).toBe('INVALID_ARGUMENT');
  expect(result.cleanupPreserved).toBe(true);
  expect(result.resultGetterCode).toBe('TRANSACTION_FAILED');
  expect(result.prematureCompletionCode).toBe('TRANSACTION_FAILED');
  expect(result.entryFailureCodes).toEqual([
    'TRANSACTION_FAILED',
    'TRANSACTION_FAILED',
    'TRANSACTION_FAILED'
  ]);
  expect(result.requestSetterCode).toBe('TRANSACTION_FAILED');
});

test('三个连接的双 transaction 竞争只允许一个提交', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbDualTransactionScenario());
  expect(result.committed).toBe(1);
  expect(result.conflicts).toBe(1);
  expect([1, 2]).toContain((result.value as { value: number }).value);
});

test('真实浏览器升级会迁移 legacy documents record 并写入 checkpoint', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbLegacyRecordsMigrationScenario());
  expect(result.value).toEqual({ migrated: true });
  expect(result.checkpoint).toMatchObject({ status: 'complete', from: 'documents', to: 'records' });
  expect(result.legacyStorePresent).toBe(false);
  expect(result.hostileCursorCode).toBe('TRANSACTION_FAILED');
  expect(result.hostileOpenCode).toBe('BACKEND_UNAVAILABLE');
  expect(result.hostileUpgradeCode).toBe('BACKEND_UNAVAILABLE');
  expect(result.openSetterCodes).toEqual([
    'BACKEND_UNAVAILABLE',
    'BACKEND_UNAVAILABLE',
    'BACKEND_UNAVAILABLE',
    'BACKEND_UNAVAILABLE'
  ]);
});

test('四个连接同时 transaction 竞争只允许一次提交', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbFourWayTransactionScenario());
  expect(result.committed).toBe(1);
  expect(result.conflicts).toBe(3);
});

test('真实 IndexedDB 失败 transaction 回滚且 pre-abort 不写入', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbFailureScenario());
  expect(result.transactionCode).toBe('TRANSACTION_FAILED');
  expect(result.rolledBack).toBe(true);
  expect(result.abortCode).toBe('ABORTED');
  expect(result.abortMissing).toBe(true);
  expect(result.invalidCallbackCodes).toEqual([
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT'
  ]);
  expect(result.invalidScopeOptionsCode).toBe('INVALID_ARGUMENT');
  expect(result.invalidScopeWriteMissing).toBe(true);
  expect(result.policyReads).toBe(1);
});

test('真实 IndexedDB clear 被取消后不提交部分清理', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbClearAbortScenario());
  expect(result.recordsCode).toBe('ABORTED');
  expect(result.recordsValue).toEqual({ keep: true });
  expect(result.allCode).toBe('ABORTED');
  expect(result.allValue).toBe('keep');
  expect(result.allRecord).toEqual({ keep: true });
});

test('真实 IndexedDB deleteRecord 被取消后不提交删除', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbDeleteAbortScenario());
  expect(result.code).toBe('ABORTED');
  expect(result.value).toEqual({ keep: true });
});

test('真实 IndexedDB putRecord 被取消后不提交部分写入', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbPutAbortScenario());
  expect(result.code).toBe('ABORTED');
  expect(result.value).toBeUndefined();
});

test('真实 IndexedDB entity migrate 分批迁移并清理 legacy record', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbEntityMigrationScenario());
  expect(result.result).toMatchObject({ scanned: 1, eligible: 1, migrated: 1 });
  expect(result.value).toEqual({ id: 'a', displayName: 'Ada' });
  expect(result.legacyValue).toBeUndefined();
  expect(result.invalidBatchCode).toBe('INVALID_CONFIG');
  expect(result.invalidOptionsCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.invalidBatchCallbackCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.migrationOptionReads).toBe(1);
});

test('真实 IndexedDB 两连接并发 entity migrate 不留下 legacy 数据', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbConcurrentEntityMigrationScenario());
  expect(result.results).toHaveLength(2);
  expect(result.results.reduce((sum, item) => sum + item.migrated, 0)).toBe(2);
  expect(result.values).toEqual([
    { id: 'a', displayName: 'Ada' },
    { id: 'b', displayName: 'Bob' }
  ]);
  expect(result.legacyValues).toEqual([undefined, undefined]);
});

test('真实 IndexedDB 支持 iframe realm 的 Date/ArrayBuffer/复合 key', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbCrossRealmKeyScenario());
  expect(result.dateValue).toEqual({ kind: 'date' });
  expect(result.bytesValue).toEqual({ kind: 'bytes' });
  expect(result.compoundValue).toEqual({ kind: 'compound' });
});

test('真实浏览器统一执行 timeoutMs=0 与 dispose lifecycle', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runOperationLifecycleScenario());
  expect(result.memoryTimeoutCode).toBe('ABORTED');
  expect(result.indexedTimeoutCode).toBe('ABORTED');
  expect(result.indexedDynamicSignalCode).toBe('INVALID_ARGUMENT');
  expect(result.disposedCode).toBe('STORE_DISPOSED');
  expect(result.memoryValue).toBeNull();
  expect(result.invalidTimeoutCode).toBe('INVALID_ARGUMENT');
  expect(result.invalidContextCodes).toEqual([
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT'
  ]);
  expect(result.invalidSignalCode).toBe('INVALID_ARGUMENT');
  expect(result.invalidSignalGetterCode).toBe('INVALID_ARGUMENT');
  expect(result.hostileReasonCode).toBe('ABORTED');
  expect(result.hostileReasonHasCause).toBe(true);
  expect(result.listenerSetupCode).toBe('INVALID_ARGUMENT');
  expect(result.cleanupPreservedResult).toBeNull();
  expect(result.extensionListenerSetupCode).toBe('INVALID_ARGUMENT');
  expect(result.extensionCleanupPreserved).toBe(true);
  expect(result.migrationListenerSetupCode).toBe('INVALID_ARGUMENT');
  expect(result.migrationCleanupPreserved).toBe(true);
  expect(result.signalRaceCode).toBe('ABORTED');
  expect(result.signalRaceCalls).toBe(0);
  expect(result.contextSnapshotReads).toBe(4);
  expect(result.signalSurfaceReads).toBe(2);
  expect(result.repositoryContextReads).toBe(4);
  expect(result.idbRequestRaceCode).toBe('ABORTED');
  expect(result.idbRequestContextReads).toBe(1);
  expect(result.idbRequestSetupCode).toBe('INVALID_ARGUMENT');
  expect(result.idbRequestCleanupPreserved).toBe(true);
  expect(result.idbResultGetterCode).toBe('TRANSACTION_FAILED');
  expect(result.idbErrorGetterCode).toBe('TRANSACTION_FAILED');
  expect(result.idbRequestSetterCodes).toEqual(['TRANSACTION_FAILED', 'TRANSACTION_FAILED']);
  expect(result.idbTransactionSetterCodes).toEqual([
    'TRANSACTION_FAILED',
    'TRANSACTION_FAILED',
    'TRANSACTION_FAILED'
  ]);
  expect(result.idbTransactionSetupCode).toBe('INVALID_ARGUMENT');
  expect(result.idbTransactionSetupRolledBack).toBe(true);
  expect(result.idbDestructiveSetterCodes).toEqual([
    'TRANSACTION_FAILED',
    'TRANSACTION_FAILED',
    'TRANSACTION_FAILED'
  ]);
  expect(result.idbDestructiveSetterRolledBack).toBe(true);
  expect(result.syncOptionCodes).toEqual([
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT'
  ]);
});

test('真实 IndexedDB codec 异常不会提交半条 entity record', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbExtensionFailureScenario());
  expect(result.code).toBe('EXTENSION_FAILED');
  expect(result.value).toBeUndefined();
});

test('真实 IndexedDB 旧 entity 客户端拒绝 future version 且不覆盖原数据', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbFutureVersionScenario());
  expect(result.getCode).toBe('VERSION_UNSUPPORTED');
  expect(result.skippedCount).toBe(0);
  expect(result.throwCode).toBe('VERSION_UNSUPPORTED');
  expect(result.invalidHandlerCode).toBe('INVALID_CONFIG');
  expect(result.rawValue).toEqual({ __v: 2, data: { id: 'future', name: 'New' } });
});

test('真实 IndexedDB hanging codec 在 abort 后结束等待且不写入', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbHangingExtensionAbortScenario());
  expect(result.code).toBe('ABORTED');
  expect(result.value).toBeUndefined();
});

test('真实 IndexedDB hanging migration 在 abort 后结束等待且不改写 legacy', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbHangingMigrationAbortScenario());
  expect(result.code).toBe('ABORTED');
  expect(result.receivedSignal).toBe(true);
  expect(result.rawValue).toEqual({ __v: 1, data: { id: 'hanging', name: 'Ada' } });
});

test('真实 IndexedDB pre-abort 不调用 custom codec', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbPreAbortExtensionScenario());
  expect(result.code).toBe('ABORTED');
  expect(result.calls).toBe(0);
});

test('真实 IndexedDB pre-abort entity read 稳定返回 ABORTED', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbPreAbortMigrationScenario());
  expect(result.code).toBe('ABORTED');
});

test('真实 IndexedDB schema validation failure 不提交 raw entity record', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runIndexedDbSchemaFailureScenario());
  expect(result.code).toBe('EXTENSION_FAILED');
  expect(result.value).toBeUndefined();
});

test('真实浏览器 entity definition 非对象入口统一返回 INVALID_CONFIG', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runEntityDefinitionGuardScenario());
  expect(result.codes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.storeCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.hostileStorePredicates).toEqual([false, false]);
  expect(result.codecCodes).toEqual([
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT'
  ]);
  expect(result.schemaCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.migrationCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.versionCodes).toEqual(['INVALID_CONFIG']);
  expect(result.migrationVersionCodes).toEqual(['INVALID_CONFIG']);
  expect(result.prototypeMigrationCodes).toEqual(['INVALID_CONFIG']);
  expect(result.nullVersionCodes).toEqual(['INVALID_CONFIG']);
  expect(result.backendCodes).toEqual(['INVALID_CONFIG']);
  expect(result.capabilityCodes).toEqual(['INVALID_CONFIG', 'INVALID_CONFIG', 'INVALID_CONFIG']);
  expect(result.sparseVersionCodes).toEqual(['INVALID_CONFIG']);
  expect(result.validateOnReadCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.standardSchemaCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.standardSchemaContractReads).toBe(4);
  expect(result.standardSchemaResultReads).toBe(2);
  expect(result.migrationHelperCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.inheritedMigrationCalls).toBe(0);
  expect(result.migrationRaceCode).toBe('ABORTED');
  expect(result.codecSelectionCodes).toEqual([
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_CONFIG'
  ]);
  expect(result.codecDescriptorReads).toBe(4);
  expect(result.definitionOptionReads).toBe(9);
  expect(result.definitionSchemaReads).toBe(5);
});

test('真实浏览器 orderBy comparator 返回非法类型时拒绝静默排序', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => window.runEntityComparatorGuardScenario());
  expect(result.codes).toEqual(['EXTENSION_FAILED', 'EXTENSION_FAILED']);
  expect(result.nullCode).toBe('INVALID_CONFIG');
  expect(result.invalidOptionsCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.rangeCodes).toEqual([
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT',
    'INVALID_ARGUMENT'
  ]);
  expect(result.invalidHandlerCodes).toEqual([
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG',
    'INVALID_CONFIG'
  ]);
  expect(result.invalidPolicyCode).toBe('INVALID_ARGUMENT');
  expect(result.rangeSnapshotReads).toBe(1);
  expect(result.listOptionReads).toBe(4);
});
