import { describe, expect, it } from 'vitest';
import { Computed, Effect, Signal, createRuntime } from '../src';

describe('reactive foundation', () => {
  it('propagates signal changes through computed and effect', () => {
    const runtime = createRuntime();
    const source = new Signal(1, runtime);
    const derived = new Computed(() => source.value * 2, runtime);
    const values: number[] = [];
    const effect = new Effect(() => {
      values.push(derived.value);
    }, runtime);

    expect(derived.value).toBe(2);
    source.value = 3;
    runtime.flush();
    expect(values).toEqual([2, 6]);

    effect.dispose();
    derived.dispose();
    source.dispose();
  });
});
