import { describe, expect, it } from 'vitest';
import { Signal, createRuntime } from '../src';

describe('Signal', () => {
  it('rebuilds conditional dependencies after an untracked preview', () => {
    const runtime = createRuntime();
    const branch = new Signal(true, runtime);
    const left = new Signal(1, runtime);
    const right = new Signal(10, runtime);
    const computed = runtime.computed(() => (branch.value ? left.value : right.value));
    expect(computed.value).toBe(1);
    branch.value = false;
    expect(computed.preview()).toBe(10);
    expect(computed.value).toBe(10);
    right.value = 20;
    expect(computed.value).toBe(20);
    computed.dispose();
    branch.dispose();
    left.dispose();
    right.dispose();
  });

  it('commits a same-version preview without evaluating the derivation twice', () => {
    const runtime = createRuntime();
    const signal = new Signal(1, runtime);
    let runs = 0;
    const computed = runtime.computed(() => {
      runs++;
      return signal.value;
    });
    expect(computed.value).toBe(1);
    signal.value = 2;
    expect(computed.preview()).toBe(2);
    expect(computed.value).toBe(2);
    expect(runs).toBe(2);
    computed.dispose();
    signal.dispose();
  });

  it('starts at the version consumed by construction and only advances on a real change', () => {
    const runtime = createRuntime();
    const s = new Signal(1, runtime);
    expect(s.version).toBe(runtime.currentVersion());
    const startVersion = s.version;
    s.value = 1; // Object.is same value -> short-circuit, no version bump
    expect(s.version).toBe(startVersion);
    s.value = 2;
    expect(s.version).toBe(startVersion + 1);
    s.dispose();
  });

  it('peek() reads the current value without establishing a dependency', () => {
    const runtime = createRuntime();
    const s = new Signal(10, runtime);
    let runs = 0;
    const dispose = runtime.effect(() => {
      runs++;
      s.peek(); // read but must not subscribe
    });
    expect(runs).toBe(1);
    s.value = 20;
    runtime.flush();
    expect(runs).toBe(1); // no dependency was built, so no rerun
    expect(s.peek()).toBe(20);
    dispose();
    s.dispose();
  });

  it('observed reflects whether the signal currently has any subscriber', () => {
    const runtime = createRuntime();
    const s = new Signal(1, runtime);
    expect(s.observed).toBe(false);
    const dispose = runtime.effect(() => {
      void s.value;
    });
    expect(s.observed).toBe(true);
    dispose();
    expect(s.observed).toBe(false);
    s.dispose();
  });

  it('dispose() is idempotent and disconnects all subscribers', () => {
    const runtime = createRuntime();
    const s = new Signal(1, runtime);
    const dispose = runtime.effect(() => {
      void s.value;
    });
    expect(s.observed).toBe(true);
    s.dispose();
    expect(s.disposed).toBe(true);
    expect(() => s.dispose()).not.toThrow();
    dispose();
  });

  it('reading, writing, or peeking a disposed signal throws instead of returning stale data', () => {
    const runtime = createRuntime();
    const s = new Signal(1, runtime);
    s.dispose();
    expect(() => s.value).toThrow('cannot use a disposed signal');
    expect(() => {
      s.value = 2;
    }).toThrow('cannot use a disposed signal');
    expect(() => s.peek()).toThrow('cannot use a disposed signal');
  });

  it('addObservedHooks fires onObserved/onUnobserved exactly at first-subscriber/last-unsubscriber edges', () => {
    const runtime = createRuntime();
    const s = new Signal(1, runtime);
    const events: string[] = [];
    s.addObservedHooks({
      onObserved: () => events.push('observed'),
      onUnobserved: () => events.push('unobserved')
    });
    const disposeA = runtime.effect(() => {
      void s.value;
    });
    expect(events).toEqual(['observed']);
    const disposeB = runtime.effect(() => {
      void s.value;
    });
    expect(events).toEqual(['observed']); // second subscriber: no additional edge event
    disposeA();
    expect(events).toEqual(['observed']); // still one subscriber left
    disposeB();
    expect(events).toEqual(['observed', 'unobserved']);
  });

  it('addObservedHooks returns a token that removes only that hook', () => {
    const runtime = createRuntime();
    const s = new Signal(1, runtime);
    const events: string[] = [];
    const remove = s.addObservedHooks({ onObserved: () => events.push('a') });
    s.addObservedHooks({ onObserved: () => events.push('b') });
    remove();
    const dispose = runtime.effect(() => {
      void s.value;
    });
    expect(events).toEqual(['b']);
    dispose();
  });

  it('aggregates errors from multiple failing lifecycle hooks and reports them via onError', () => {
    const errors: unknown[] = [];
    const runtime = createRuntime({ onError: (error) => errors.push(error) });
    const s = new Signal(1, runtime);
    s.addObservedHooks({
      onObserved: () => {
        throw new Error('hook-1');
      }
    });
    s.addObservedHooks({
      onObserved: () => {
        throw new Error('hook-2');
      }
    });
    const dispose = runtime.effect(() => {
      void s.value;
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(AggregateError);
    expect((errors[0] as AggregateError).errors).toHaveLength(2);
    dispose();
  });

  it('reading a signal from another Runtime while tracking dependencies throws cross-runtime error', () => {
    const runtimeA = createRuntime();
    const runtimeB = createRuntime();
    const foreign = new Signal(1, runtimeB);
    expect(() => new Signal(1, runtimeA).runtime).not.toThrow();
    expect(() =>
      runtimeA.effect(() => {
        expect(foreign.value).toBeDefined();
      })
    ).toThrow(
      'cross-runtime dependency is not allowed: a node was read while a node from another runtime was being tracked'
    );
    foreign.dispose();
  });
});
