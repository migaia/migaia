/* oxlint-disable unicorn/no-thenable -- 对抗夹具刻意构造 hostile then getter 以验证单次探测语义 */
import { describe, expect, it, vi } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import { createManualScheduler } from '@migaia/lifecycle';
import { Resource } from '../src';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('AF-T6 resource scheduler injection', () => {
  it('retry delay is driven by the injected manual scheduler, not a host timer or microtask', async () => {
    const manual = createManualScheduler();
    const runtime = createRuntime();
    let attempts = 0;
    const resource = new Resource(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('first fail');
        return 'ok';
      },
      runtime,
      { retry: 1, retryDelay: 60_000, scheduler: manual }
    );
    const promise = resource.promise;
    await flush();
    // 60s retry delay must NOT run immediately.
    expect(attempts).toBe(1);
    manual.advance(60_000);
    await expect(promise).resolves.toBe('ok');
    expect(attempts).toBe(2);
    resource.dispose();
  });
});

describe('AF-T7 SWR cancel state consistency', () => {
  it('cancel during a SWR refresh keeps stale data and clears refreshing', async () => {
    const runtime = createRuntime();
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => new Promise<string>(() => {}));
    const resource = new Resource(fetcher, runtime, { staleWhileRevalidate: true });
    await resource.promise;
    expect(resource.state).toEqual({ status: 'success', data: 'first' });

    void resource.refetch();
    expect(resource.refreshing).toBe(true);
    expect(resource.fetchStatus).toBe('fetching');

    resource.cancel();
    expect(resource.refreshing).toBe(false);
    expect(resource.fetchStatus).toBe('idle');
    expect(resource.state).toEqual({ status: 'success', data: 'first' });
    resource.dispose();
  });
});

describe('AF-T8 Suspense throw then-getter probe', () => {
  it('surfaces the getter error and keeps the thrown value reachable', async () => {
    const runtime = createRuntime();
    const getterError = new Error('then getter boom');
    let reads = 0;
    const thrown = {
      get then() {
        reads += 1;
        throw getterError;
      }
    };
    const resource = new Resource(() => {
      throw thrown;
    }, runtime);
    let rejection: (Error & { errors?: unknown[]; code?: string }) | undefined;
    await resource.promise.catch((error: unknown) => {
      rejection = error as Error & { errors?: unknown[]; code?: string };
    });
    expect(rejection?.code).toBe('SUSPENSE_PROBE_FAILED');
    expect(rejection?.errors?.[0]).toBe(thrown);
    expect(rejection?.errors?.[1]).toBe(getterError);
    expect(reads).toBe(1);
    resource.dispose();
  });
});

describe('AF-T21 resource scheduler entry validation', () => {
  it('a scheduler missing now/schedule is rejected with INVALID_OPTION at construction', () => {
    const runtime = createRuntime();
    expect(() => new Resource(async () => 1, runtime, { scheduler: {} as any })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    );
    expect(() => new Resource(async () => 1, runtime, { scheduler: { now: 'x' } as any })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    );
  });

  it('AF-T28: hostile scheduler getter is wrapped as INVALID_OPTION with the original as cause', () => {
    const runtime = createRuntime();
    const getterError = new Error('scheduler getter boom');
    const scheduler = new Proxy(
      {},
      {
        get() {
          throw getterError;
        }
      }
    );
    let caught: unknown;
    try {
      new Resource(async () => 1, runtime, { scheduler: scheduler as any });
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('INVALID_OPTION');
    expect((caught as { cause?: unknown }).cause).toBe(getterError);
  });

  it('AF-T31: scheduler is read exactly once and the validated snapshot is used', () => {
    const runtime = createRuntime();
    let reads = 0;
    const scheduler = { now: () => 0, schedule: () => ({ cancel: () => {} }) };
    const options = {
      get scheduler() {
        reads += 1;
        return scheduler;
      }
    };
    new Resource(async () => 1, runtime, options as any);
    expect(reads).toBe(1);
  });
});
