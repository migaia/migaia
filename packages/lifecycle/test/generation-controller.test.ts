import { describe, expect, it, vi } from 'vitest';
import { createGenerationController } from '../src/generation-controller';
import { LifecycleErrorCode } from '../src/error-code';

describe('L-T6 GenerationController: new generation, late arrival, disposed', () => {
  it('a late (superseded) result cannot be adopted and is released instead', () => {
    const controller = createGenerationController();
    const first = controller.begin();
    controller.begin(); // supersedes `first`
    const release = vi.fn();
    const accepted = controller.adopt(first.token, 'stale-value', release);
    expect(accepted).toBe(false);
    expect(release).toHaveBeenCalledWith('stale-value');
  });

  it('the current generation adopts successfully without releasing', () => {
    const controller = createGenerationController();
    const request = controller.begin();
    const release = vi.fn();
    const accepted = controller.adopt(request.token, 'value', release);
    expect(accepted).toBe(true);
    expect(release).not.toHaveBeenCalled();
  });

  it('a token from a disposed controller is never current and its result is released', () => {
    const controller = createGenerationController();
    const request = controller.begin();
    controller.dispose();
    const release = vi.fn();
    expect(controller.adopt(request.token, 'v', release)).toBe(false);
    expect(release).toHaveBeenCalled();
  });

  it('begin() throws GENERATION_DISPOSED on a disposed controller', () => {
    const controller = createGenerationController();
    controller.dispose();
    expect(() => controller.begin()).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.generationDisposed })
    );
  });

  it("begin()'s AbortSignal aborts when superseded by a later begin()", () => {
    const controller = createGenerationController();
    const first = controller.begin();
    expect(first.signal.aborted).toBe(false);
    controller.begin();
    expect(first.signal.aborted).toBe(true);
  });

  it('isCurrent() reflects only the most recent token', () => {
    const controller = createGenerationController();
    const first = controller.begin();
    expect(controller.isCurrent(first.token)).toBe(true);
    const second = controller.begin();
    expect(controller.isCurrent(first.token)).toBe(false);
    expect(controller.isCurrent(second.token)).toBe(true);
  });

  it('an unrelated foreign token is never current', () => {
    const controller = createGenerationController();
    controller.begin();
    expect(controller.isCurrent({})).toBe(false);
  });

  it('begin({ timeoutMs }) auto-aborts the returned signal after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const controller = createGenerationController();
      const request = controller.begin({ timeoutMs: 100 });
      expect(request.signal.aborted).toBe(false);
      vi.advanceTimersByTime(101);
      expect(request.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('L-T30 GenerationController: old generation cleanup failure does not poison new generation', () => {
  it('a release failure for a superseded token leaves the new generation state untouched', () => {
    const controller = createGenerationController();
    const stale = controller.begin();
    const fresh = controller.begin();
    const onReleaseError = vi.fn();
    const release = () => {
      throw new Error('cleanup failed');
    };
    const accepted = controller.adopt(stale.token, 'v', release, onReleaseError);
    expect(accepted).toBe(false);
    expect(onReleaseError).toHaveBeenCalledTimes(1);
    // The new generation is unaffected: it can still adopt normally.
    expect(controller.isCurrent(fresh.token)).toBe(true);
    const freshRelease = vi.fn();
    expect(controller.adopt(fresh.token, 'fresh-value', freshRelease)).toBe(true);
    expect(freshRelease).not.toHaveBeenCalled();
  });

  it('an async release rejection for a superseded token is observed without becoming an unhandled rejection', async () => {
    const controller = createGenerationController();
    const stale = controller.begin();
    controller.begin();
    const onReleaseError = vi.fn();
    controller.adopt(
      stale.token,
      'v',
      () => Promise.reject(new Error('async cleanup failed')),
      onReleaseError
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(onReleaseError).toHaveBeenCalledTimes(1);
    expect((onReleaseError.mock.calls[0]![0] as Error).message).toBe('async cleanup failed');
  });

  it('a throwing onReleaseError callback does not propagate out of adopt()', () => {
    const controller = createGenerationController();
    const stale = controller.begin();
    controller.begin();
    expect(() =>
      controller.adopt(
        stale.token,
        'v',
        () => {
          throw new Error('cleanup failed');
        },
        () => {
          throw new Error('reporter also failed');
        }
      )
    ).not.toThrow();
  });
});

describe('L-T31 GenerationController: parent closing', () => {
  it("auto-aborts the current generation's signal when the parent signal aborts", () => {
    const parent = new AbortController();
    const controller = createGenerationController({ parentSignal: parent.signal });
    const request = controller.begin();
    expect(request.signal.aborted).toBe(false);
    parent.abort('parent closing');
    expect(request.signal.aborted).toBe(true);
  });

  it('a controller created with an already-aborted parent signal starts every generation pre-aborted', () => {
    const parent = new AbortController();
    parent.abort('already closed');
    const controller = createGenerationController({ parentSignal: parent.signal });
    const request = controller.begin();
    expect(request.signal.aborted).toBe(true);
  });

  it("the parent's abort does not throw or reject anything by itself — it only changes signal state", () => {
    const parent = new AbortController();
    const controller = createGenerationController({ parentSignal: parent.signal });
    controller.begin();
    expect(() => parent.abort('closing')).not.toThrow();
  });
});
