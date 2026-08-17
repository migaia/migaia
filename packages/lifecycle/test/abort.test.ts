import { describe, expect, it } from 'vitest';
import { createAbortController, type IAbortSignal } from '../src/abort';

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
