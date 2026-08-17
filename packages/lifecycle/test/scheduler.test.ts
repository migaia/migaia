import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManualScheduler, systemScheduler, type ILifecycleScheduler } from '../src/scheduler';

describe('T-16 lifecycle scheduler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manualScheduler.now() 单调不递减，相同值合法', () => {
    const scheduler = createManualScheduler();
    expect(scheduler.now()).toBe(0);
    scheduler.advance(5);
    expect(scheduler.now()).toBe(5);
    scheduler.advance(0);
    expect(scheduler.now()).toBe(5);
  });

  it('manualScheduler.schedule 到期才执行，callback 至多一次', () => {
    const scheduler = createManualScheduler();
    let count = 0;
    scheduler.schedule(() => {
      count++;
    }, 10);
    expect(count).toBe(0);
    scheduler.advance(9);
    expect(count).toBe(0);
    scheduler.advance(1);
    expect(count).toBe(1);
    scheduler.advance(100);
    expect(count).toBe(1);
  });

  it('manualScheduler.cancel 幂等，cancel 后不执行', () => {
    const scheduler = createManualScheduler();
    let count = 0;
    const task = scheduler.schedule(() => {
      count++;
    }, 10);
    task.cancel();
    task.cancel();
    scheduler.advance(100);
    expect(count).toBe(0);
  });

  it('manualScheduler 按到期时刻升序执行（同时刻按登记顺序）', () => {
    const scheduler = createManualScheduler();
    const order: number[] = [];
    scheduler.schedule(() => order.push(2), 20);
    scheduler.schedule(() => order.push(1), 10);
    scheduler.schedule(() => order.push(3), 10);
    scheduler.advance(30);
    expect(order).toEqual([1, 3, 2]);
  });

  it('systemScheduler.now() 返回有限数字（performance.now）', () => {
    expect(Number.isFinite(systemScheduler.now())).toBe(true);
  });

  it('systemScheduler.schedule 创建真实 timer，cancel 幂等后不执行', async () => {
    let count = 0;
    const task = systemScheduler.schedule(() => {
      count++;
    }, 1);
    task.cancel();
    task.cancel();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(count).toBe(0);
  });

  it('performance.now 缺失 → now() 抛 ENV_UNSUPPORTED', () => {
    vi.stubGlobal('performance', undefined);
    expect(() => systemScheduler.now()).toThrowError(
      expect.objectContaining({ code: 'ENV_UNSUPPORTED', source: '@migaia/lifecycle' })
    );
  });

  it('setTimeout/clearTimeout 缺失 → schedule() 抛 ENV_UNSUPPORTED', () => {
    vi.stubGlobal('setTimeout', undefined);
    vi.stubGlobal('clearTimeout', undefined);
    expect(() => systemScheduler.schedule(() => {}, 1)).toThrowError(
      expect.objectContaining({ code: 'ENV_UNSUPPORTED', source: '@migaia/lifecycle' })
    );
  });
});

describe('T-18 scheduler contract 兼容门禁', () => {
  it('ILifecycleScheduler 可赋值给 ISerializeScheduler 结构子集（compile-time）', () => {
    // serialize/core 将自声明的结构子集（R-4）；lifecycle 不得多出 serialize 未定义的语义。
    type ISerializeScheduler = {
      now(): number;
      schedule(callback: () => void, delayMs: number): { cancel(): void };
    };
    const scheduler: ILifecycleScheduler = createManualScheduler();
    const asSerialize: ISerializeScheduler = scheduler;
    expect(asSerialize).toBe(scheduler);
  });
});
