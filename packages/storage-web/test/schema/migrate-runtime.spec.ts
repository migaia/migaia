import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, runMigrationsWithRuntime } from '../../src/schema/migrate.js';
import { defineEntity } from '../../src/entity/index.js';
import { memoryStorage } from '../../src/backends/memory.js';

/**
 * T-14(6)/(7) 运行时归属门禁：公开 `runMigrations()` 内部创建「恰好一个」runtime/reporter； 内部
 * `runMigrationsWithRuntime()` 复用所属 operation 的 runtime，不创建第二个 reporter。
 *
 * 用 `vi.hoisted` 先把 `createStorageOperationRuntime` 换成 spy，再 mock 整个 `operation-reporter` 模块，让
 * schema/entity/backend 里所有对它的引用都指向同一个 spy。
 */
const runtimeSpies = vi.hoisted(() => {
  const createStorageOperationRuntime = vi.fn(() => ({ reporter: () => {} }));
  return { createStorageOperationRuntime };
});

vi.mock('../../src/core/operation-reporter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/operation-reporter.js')>();
  return {
    ...actual,
    createStorageOperationRuntime: runtimeSpies.createStorageOperationRuntime
  };
});

describe('migration runtime ownership (§4.4 T-14(6)/(7))', () => {
  beforeEach(() => {
    runtimeSpies.createStorageOperationRuntime.mockClear();
  });

  it('T-14(6): 公开 runMigrations() 恰好创建一个 runtime/reporter', async () => {
    await runMigrations({ id: 'u1' }, 0, 1, {
      1: async (value) => value
    });
    expect(runtimeSpies.createStorageOperationRuntime).toHaveBeenCalledTimes(1);
  });

  it('T-14(7): runMigrationsWithRuntime() 复用所属 runtime，不自行创建第二个 reporter', async () => {
    const runtime = { reporter: vi.fn() };
    await runMigrationsWithRuntime(runtime, { id: 'u1' }, 0, 1, {
      1: async (value) => value
    });
    expect(runtimeSpies.createStorageOperationRuntime).not.toHaveBeenCalled();
  });

  it('T-14(7): repository 读取旧版本触发迁移时不额外创建 reporter', async () => {
    const store = memoryStorage();
    const v1 = defineEntity<{ id: string; name: string }>({
      name: 'rt-people',
      key: 'id',
      version: 1
    });
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'rt-people',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    });

    // 当前版本记录：无迁移路径的 runtime 创建数作为基线。
    await v2.connect(store).put({ id: 'u2', displayName: 'Bob' });
    runtimeSpies.createStorageOperationRuntime.mockClear();
    await v2.connect(store).get('u2');
    const baseline = runtimeSpies.createStorageOperationRuntime.mock.calls.length;

    // 旧版本记录：读取会走 runMigrationsWithRuntime，复用 repository.get 的 runtime。
    await v1.connect(store).put({ id: 'u1', name: 'Ada' });
    runtimeSpies.createStorageOperationRuntime.mockClear();
    await v2.connect(store).get('u1');
    const withMigration = runtimeSpies.createStorageOperationRuntime.mock.calls.length;

    expect(withMigration).toBe(baseline);
    expect(baseline).toBeGreaterThan(0);
  });
});
