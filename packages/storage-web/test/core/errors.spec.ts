import { describe, expect, it, vi } from 'vitest';
import { invokeExtension } from '../../src/core/errors';
import { createStorageOperationRuntime } from '../../src/core/operation-reporter.js';

describe('invokeExtension abort lifecycle', () => {
  it('关闭 check-subscribe race 并阻止扩展结果胜出', async () => {
    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
      reason: 'extension race',
      addEventListener: () => {
        aborted = true;
      },
      removeEventListener: () => {}
    } as never;
    await expect(
      invokeExtension(
        async () => 'late result',
        'memory',
        'entity.validate',
        'schema',
        signal,
        createStorageOperationRuntime()
      )
    ).rejects.toMatchObject({
      code: 'ABORTED',
      backend: 'memory'
    });
  });

  it('listener setup 错误归一化且 cleanup 错误不覆盖扩展结果', async () => {
    const setupCause = new Error('hostile extension listener setup');
    const setupSignal = {
      aborted: false,
      addEventListener: () => {
        throw setupCause;
      },
      removeEventListener: () => {}
    } as never;
    await expect(
      invokeExtension(
        async () => 'value',
        'memory',
        'entity.validate',
        'schema',
        setupSignal,
        createStorageOperationRuntime()
      )
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    });
    const cleanupSignal = {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {
        throw new Error('hostile extension listener cleanup');
      }
    } as never;
    await expect(
      invokeExtension(
        async () => 'value',
        'memory',
        'entity.validate',
        'schema',
        cleanupSignal,
        createStorageOperationRuntime()
      )
    ).resolves.toBe('value');
  });

  it('将 hostile aborted getter 归一化为输入错误，且不启动扩展', async () => {
    const cause = new Error('hostile extension aborted getter');
    const signal = {
      get aborted(): boolean {
        throw cause;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    } as never;
    const extension = async (): Promise<string> => 'must not start';
    const call = vi.fn(extension);
    await expect(
      invokeExtension(
        call,
        'memory',
        'entity.validate',
        'schema',
        signal,
        createStorageOperationRuntime()
      )
    ).rejects.toThrow('[storage-contract] INVALID_ARGUMENT');
    expect(call).not.toHaveBeenCalled();
  });

  it('将 abort 回调中的 hostile reason getter 保留为取消 cause', async () => {
    const cause = new Error('hostile extension abort reason');
    let aborted = false;
    let listener: (() => void) | undefined;
    const signal = {
      get aborted(): boolean {
        return aborted;
      },
      get reason(): never {
        throw cause;
      },
      addEventListener: (_type: 'abort', callback: () => void): void => {
        listener = callback;
      },
      removeEventListener: (): void => undefined
    } as never;
    const pending = invokeExtension(
      () => new Promise<never>(() => undefined),
      'memory',
      'entity.validate',
      'schema',
      signal,
      createStorageOperationRuntime()
    );
    const translated = pending.then(
      () => false,
      (error: unknown) =>
        (error as { readonly code?: unknown }).code === 'ABORTED' &&
        (error as Error).cause === cause
    );
    aborted = true;
    listener?.();
    await expect(translated).resolves.toBe(true);
  });
});
