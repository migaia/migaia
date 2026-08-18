import { describe, expect, it, vi } from 'vitest';
import type { IRuntime } from '@migaia/reactive';
import { notifyReact } from '../src/notify-react';

function fakeRuntime(overrides: Partial<IRuntime> = {}): IRuntime {
  return {
    untracked: vi.fn(<T>(fn: () => T) => fn()),
    reportError: vi.fn(),
    ...overrides
  } as unknown as IRuntime;
}

describe('notifyReact', () => {
  it('runs onChange inside runtime.untracked', () => {
    const runtime = fakeRuntime();
    const onChange = vi.fn();

    notifyReact(runtime, onChange);

    expect(runtime.untracked).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing listener via runtime.reportError instead of propagating', () => {
    const boom = new Error('listener exploded');
    const onChange = vi.fn(() => {
      throw boom;
    });
    const runtime = fakeRuntime({
      untracked: vi.fn(<T>(fn: () => T) => fn()) as unknown as IRuntime['untracked']
    });

    expect(() => notifyReact(runtime, onChange)).not.toThrow();
    expect(runtime.reportError).toHaveBeenCalledTimes(1);
    expect(runtime.reportError).toHaveBeenCalledWith(boom, { phase: 'subscription-listener' });
  });

  it('reports errors thrown by runtime.untracked itself (not just the listener)', () => {
    const boom = new Error('untracked exploded');
    const runtime = fakeRuntime({
      untracked: vi.fn(() => {
        throw boom;
      })
    });
    const onChange = vi.fn();

    expect(() => notifyReact(runtime, onChange)).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
    expect(runtime.reportError).toHaveBeenCalledWith(boom, { phase: 'subscription-listener' });
  });

  it('contains a runtime reporter failure at the listener boundary', () => {
    const reported: unknown[] = [];
    const previous = (globalThis as { reportError?: (error: unknown) => void }).reportError;
    (globalThis as { reportError?: (error: unknown) => void }).reportError = (error) => {
      reported.push(error);
    };
    const runtime = fakeRuntime({
      untracked: vi.fn(() => {
        throw new Error('listener exploded');
      }),
      reportError: vi.fn(() => {
        throw new Error('runtime reporter failed');
      })
    });
    try {
      expect(() => notifyReact(runtime, () => undefined)).not.toThrow();
      expect(reported).toHaveLength(1);
      expect(reported[0]).toMatchObject({ message: 'runtime reporter failed' });
    } finally {
      if (previous)
        (globalThis as { reportError?: (error: unknown) => void }).reportError = previous;
      else delete (globalThis as { reportError?: (error: unknown) => void }).reportError;
    }
  });
});
