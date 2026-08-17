import { describe, expect, it, vi } from 'vitest';
import {
  assertOperationContext,
  mergeSignals,
  throwIfAborted,
  withAbort
} from '../../src/core/operation';

const noopReporter = (): void => {};

describe('throwIfAborted', () => {
  it('非法 timeoutMs 抛 INVALID_ARGUMENT', () => {
    for (const timeoutMs of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => assertOperationContext({ timeoutMs })).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      );
  });
  it('拒绝非法 context 容器与 signal', () => {
    for (const ctx of [null, [], 'context', 1])
      expect(() => assertOperationContext(ctx as never)).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      );
    for (const signal of [null, [], {}, { aborted: false }, { aborted: 'no' }])
      expect(() => assertOperationContext({ signal } as never)).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      );
  });
  it('signal surface getter 异常归一为 INVALID_ARGUMENT', () => {
    for (const field of ['aborted', 'addEventListener', 'removeEventListener'] as const) {
      const cause = new Error(`hostile ${field} getter`);
      const signal = {
        aborted: false,
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      Object.defineProperty(signal, field, {
        get: () => {
          throw cause;
        }
      });
      expect(() => assertOperationContext({ signal: signal as never })).toThrow(
        expect.objectContaining({ code: 'INVALID_ARGUMENT', cause })
      );
    }
  });
  it('未 abort 时不抛错', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
  });
  it('已 abort 时抛 ABORTED', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(
      expect.objectContaining({ code: 'ABORTED' })
    );
  });
  it('已 abort signal 的 hostile reason getter 仍归一为 ABORTED', () => {
    const cause = new Error('hostile reason getter');
    const signal = {
      aborted: true,
      get reason(): never {
        throw cause;
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    } as never;
    expect(() => throwIfAborted(signal)).toThrow(
      expect.objectContaining({ code: 'ABORTED', cause })
    );
    const merged = mergeSignals({ signal, timeoutMs: 1000 }, noopReporter);
    expect(merged.signal?.aborted).toBe(true);
    expect(merged.signal?.reason).toBe(cause);
    merged.dispose();
  });
  it('signal 为 undefined 时不抛错', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });
});

describe('mergeSignals', () => {
  it('无 ctx 时返回 undefined signal 与空 dispose', () => {
    const { signal, dispose } = mergeSignals(undefined, noopReporter);
    expect(signal).toBeUndefined();
    expect(() => dispose()).not.toThrow();
  });
  it('只有外部 signal 时原样返回', () => {
    const controller = new AbortController();
    const { signal } = mergeSignals({ signal: controller.signal }, noopReporter);
    expect(signal).toBe(controller.signal);
  });
  it('operation context 每个字段只读取一次并传递快照', async () => {
    const controller = new AbortController();
    let reads = 0;
    const context = {
      get signal() {
        reads += 1;
        return controller.signal;
      },
      get timeoutMs() {
        reads += 1;
        return undefined;
      },
      get pageSize() {
        reads += 1;
        return 64;
      },
      get conflictPolicy() {
        reads += 1;
        return 'replace' as const;
      }
    };
    await expect(
      withAbort(context, async (signal, snapshot) => ({ signal, snapshot }))
    ).resolves.toEqual({
      signal: controller.signal,
      snapshot: {
        signal: controller.signal,
        timeoutMs: undefined,
        pageSize: 64,
        conflictPolicy: 'replace'
      }
    });
    expect(reads).toBe(4);
  });
  it('可信快照跨层复用时不重新探测稳定 signal surface', async () => {
    const reads = { aborted: 0, addEventListener: 0, removeEventListener: 0 };
    const signal = {
      get aborted() {
        reads.aborted += 1;
        return false;
      },
      get addEventListener() {
        reads.addEventListener += 1;
        if (reads.addEventListener > 1) throw new Error('addEventListener read twice');
        return () => {};
      },
      get removeEventListener() {
        reads.removeEventListener += 1;
        if (reads.removeEventListener > 1) throw new Error('removeEventListener read twice');
        return () => {};
      }
    } as never;
    const snapshot = mergeSignals({ signal }, noopReporter).context;
    await expect(withAbort(snapshot, async () => 42)).resolves.toBe(42);
    expect(reads).toEqual({ aborted: 2, addEventListener: 1, removeEventListener: 1 });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
  it('timeoutMs 到期后合成 signal 被 abort', async () => {
    const { signal, dispose } = mergeSignals({ timeoutMs: 5 }, noopReporter);
    expect(signal?.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signal?.aborted).toBe(true);
    dispose();
  });
  it('外部 signal 已 abort 时合成 signal 立即 abort', () => {
    const controller = new AbortController();
    controller.abort('external reason');
    const { signal, dispose } = mergeSignals(
      { signal: controller.signal, timeoutMs: 1000 },
      noopReporter
    );
    expect(signal?.aborted).toBe(true);
    dispose();
  });
  it('外部 signal 后触发时合成 signal 跟着 abort', () => {
    const controller = new AbortController();
    const { signal, dispose } = mergeSignals(
      { signal: controller.signal, timeoutMs: 1000 },
      noopReporter
    );
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
    dispose();
  });
  it('外部 abort 发生在检查与 listener 注册之间时不会丢失', () => {
    let aborted = false;
    const external = {
      get aborted() {
        return aborted;
      },
      reason: 'race abort',
      addEventListener: () => {
        aborted = true;
      },
      removeEventListener: () => {}
    };
    const merged = mergeSignals({ signal: external as never, timeoutMs: 1000 }, noopReporter);
    expect(merged.signal?.aborted).toBe(true);
    expect(merged.signal?.reason).toBe('race abort');
    merged.dispose();
  });
  it('listener setup 失败时清理 timer 并归一错误', () => {
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
    const cause = new Error('hostile addEventListener');
    expect(() =>
      mergeSignals(
        {
          timeoutMs: 1000,
          signal: {
            aborted: false,
            addEventListener: () => {
              throw cause;
            },
            removeEventListener: () => {}
          } as never
        },
        noopReporter
      )
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause }));
    expect(clearTimer).toHaveBeenCalledOnce();
    clearTimer.mockRestore();
  });
  it('listener cleanup 失败不覆盖已完成 operation 结果', async () => {
    await expect(
      withAbort(
        {
          timeoutMs: 1000,
          signal: {
            aborted: false,
            addEventListener: () => {},
            removeEventListener: () => {
              throw new Error('hostile removeEventListener');
            }
          } as never
        },
        async () => 42
      )
    ).resolves.toBe(42);
  });
  it('timeoutMs 为 0 时立即 abort，不创建延迟操作', () => {
    const { signal, dispose } = mergeSignals({ timeoutMs: 0 }, noopReporter);
    expect(signal?.aborted).toBe(true);
    dispose();
  });
});

describe('withAbort', () => {
  it('已 abort 时 run 不被调用', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await expect(
      withAbort({ signal: controller.signal }, async () => {
        called = true;
      })
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(called).toBe(false);
  });
  it('入口检查失败后仍清理合成 signal', async () => {
    await expect(withAbort({ timeoutMs: 0 }, async () => 42)).rejects.toMatchObject({
      code: 'ABORTED'
    });
  });
  it('正常路径返回 run 的结果', async () => {
    await expect(withAbort(undefined, async () => 42)).resolves.toBe(42);
  });
  it('执行完成后 dispose 被调用（timer 不再挂起）', async () => {
    const result = await withAbort({ timeoutMs: 1000 }, async () => 'done');
    expect(result).toBe('done');
  });
});
