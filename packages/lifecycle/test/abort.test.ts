import { describe, expect, it } from 'vitest';
import { createAbortController, type IAbortSignal } from '../src/abort';
import { LifecycleErrorCode } from '../src/error-code.js';

describe('T-15 reason 行为', () => {
  it('abort(reason) 后 reason 经 signal.reason 保持 === 身份可达', () => {
    const controller = createAbortController();
    const reason = { code: 'CANCELLED' };
    controller.abort(reason);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(reason);
  });

  it('abort() 无 reason 时 reason 为 undefined（缺失不制造原因）', () => {
    const controller = createAbortController();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeUndefined();
  });

  it('abort 幂等：后续 abort 不改写已固化的 reason（closing reason 不改写）', () => {
    const controller = createAbortController();
    const first = { code: 'first' };
    controller.abort(first);
    controller.abort({ code: 'second' });
    expect(controller.signal.reason).toBe(first);
  });

  it('按 callback 去重 once listener，重复注册只执行一次', () => {
    const controller = createAbortController();
    let calls = 0;
    const listener = (): void => {
      calls++;
    };

    controller.signal.addEventListener('abort', listener, { once: true });
    controller.signal.addEventListener('abort', listener, { once: true });
    controller.abort();

    expect(calls).toBe(1);
  });

  it('removeEventListener 按 callback 移除去重后的 once listener', () => {
    const controller = createAbortController();
    let calls = 0;
    const listener = (): void => {
      calls++;
    };

    controller.signal.addEventListener('abort', listener, { once: true });
    controller.signal.addEventListener('abort', listener, { once: true });
    controller.signal.removeEventListener('abort', listener);
    controller.abort();

    expect(calls).toBe(0);
  });

  it('单 listener Error 原位保留 identity 并标记 ABORT_LISTENER_FAILED', () => {
    const controller = createAbortController();
    const original = new Error('listener failed');
    controller.signal.addEventListener('abort', () => {
      throw original;
    });

    let caught: unknown;
    try {
      controller.abort();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
    expect(original).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.abortListenerFailed
    });
  });

  it('单 listener primitive 用 ABORT_LISTENER_FAILED wrapper 保留 cause', () => {
    const controller = createAbortController();
    const primitive = 'listener primitive failure';
    controller.signal.addEventListener('abort', () => {
      throw primitive;
    });

    let caught: unknown;
    try {
      controller.abort();
    } catch (error) {
      caught = error;
    }

    expect(caught).toEqual(
      expect.objectContaining({
        source: '@migaia/lifecycle',
        code: LifecycleErrorCode.abortListenerFailed,
        cause: primitive
      })
    );
  });

  it('AF-T61: one throwing listener cannot stop later listeners, and every error stays reachable', () => {
    const controller = createAbortController();
    const firstError = new Error('first listener failed');
    const secondError = new Error('second listener failed');
    const calls: string[] = [];

    controller.signal.addEventListener('abort', () => {
      calls.push('first');
      throw firstError;
    });
    controller.signal.addEventListener('abort', () => {
      calls.push('second');
      throw secondError;
    });

    let thrown: unknown;
    try {
      controller.abort('cancelled');
    } catch (error) {
      thrown = error;
    }

    expect(calls).toEqual(['first', 'second']);
    expect(controller.signal.aborted).toBe(true);
    expect(thrown).toEqual(
      expect.objectContaining({
        source: '@migaia/lifecycle',
        code: LifecycleErrorCode.abortListenerFailed
      })
    );
    expect((thrown as AggregateError).errors).toEqual([firstError, secondError]);
  });
});

describe('T-20 signal 双向结构兼容', () => {
  it('IAbortSignal ↔ ISerializeAbortSignal 双向结构赋值（compile-time）', () => {
    // serialize §4.2 将自声明的结构化 signal（reason 可选）；与 lifecycle IAbortSignal 双向兼容。
    type ISerializeAbortSignal = {
      readonly aborted: boolean;
      readonly reason?: unknown;
      addEventListener(
        type: 'abort',
        listener: () => void,
        options?: { readonly once?: boolean }
      ): void;
      removeEventListener(type: 'abort', listener: () => void): void;
    };
    const signal: IAbortSignal = createAbortController().signal;
    const forward: ISerializeAbortSignal = signal;
    const backward: IAbortSignal = forward;
    expect(backward).toBe(signal);
  });
});
