import { describe, expect, it } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import { atomDef, createAtomStore } from '../src';

describe('store-keyed', () => {
  it('keeps definition state scoped to each AtomStore', () => {
    const count = atomDef(0, 'count');
    const first = createAtomStore(createRuntime());
    const second = createAtomStore(createRuntime());

    first.set(count, 1);
    second.set(count, 2);
    expect(first.get(count)).toBe(1);
    expect(second.get(count)).toBe(2);

    first.dispose();
    second.dispose();
  });
});
