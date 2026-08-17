import { describe, expect, it } from 'vitest';
import { createRuntime } from '@migaia/reactive';
import { atomDef, createAtomStore, derivedFamilyDef, familyDef } from '../src';

describe('familyDef', () => {
  it('returns the same token for the same key (canonical identity)', () => {
    const family = familyDef((id: string) => ({ id }));
    expect(family('a')).toBe(family('a'));
    expect(family('a')).not.toBe(family('b'));
  });

  it('produces a primitive-factory definition whose init runs lazily per store', () => {
    const family = familyDef((id: string) => ({ created: id }));
    const store = createAtomStore(createRuntime());
    const value = store.get(family('conv-1'));
    expect(value).toEqual({ created: 'conv-1' });
    store.dispose();
  });

  it('same key yields independent state per AtomStore', () => {
    const family = familyDef((id: string) => id.length);
    const def = family('hello');
    const storeA = createAtomStore(createRuntime());
    const storeB = createAtomStore(createRuntime());
    storeA.set(def, 100);
    expect(storeA.get(def)).toBe(100);
    expect(storeB.get(def)).toBe(5);
    storeA.dispose();
    storeB.dispose();
  });

  it('size reflects the number of strongly-cached tokens', () => {
    const family = familyDef((id: string) => id);
    expect(family.size).toBe(0);
    family('a');
    family('b');
    expect(family.size).toBe(2);
    family('a'); // repeat lookup does not grow size
    expect(family.size).toBe(2);
  });

  it('forget() breaks canonical identity for future lookups of that key', () => {
    const family = familyDef((id: string) => id);
    const before = family('a');
    expect(family.forget('a')).toBe(true);
    expect(family.forget('a')).toBe(false); // already forgotten
    const after = family('a');
    expect(after).not.toBe(before);
  });

  it('clear() empties the cache; a subsequent lookup creates a fresh token', () => {
    const family = familyDef((id: string) => id);
    const before = family('a');
    family.clear();
    expect(family.size).toBe(0);
    expect(family('a')).not.toBe(before);
  });

  it('LRU eviction from the strong cache still resolves to the same token via the weak canonical map', () => {
    const family = familyDef((id: string) => id, { maxSize: 1 });
    const first = family('a'); // strongly cached
    family('b'); // evicts 'a' from the strong LRU, demotes it to weak-only
    expect(family.size).toBe(1);
    // 'a' has not been garbage collected (still referenced by `first`), so the
    // weak canonical map resurrects the same token instead of creating a new one.
    const again = family('a');
    expect(again).toBe(first);
    expect(family.size).toBe(1); // 'a' promoted back, 'b' evicted
  });

  it('rejects a non-positive-integer maxSize', () => {
    expect(() => familyDef((id: string) => id, { maxSize: 0 })).toThrow(
      '[store] family maxSize must be a positive integer'
    );
    expect(() => familyDef((id: string) => id, { maxSize: 1.5 })).toThrow(RangeError);
    expect(() => familyDef((id: string) => id, { maxSize: -1 })).toThrow(RangeError);
  });
});

describe('derivedFamilyDef', () => {
  it('produces a read-only derived definition per key', () => {
    const source = atomDef(10);
    const family = derivedFamilyDef((multiplier: number) => (get) => get(source) * multiplier);
    const store = createAtomStore(createRuntime());
    expect(store.get(family(3))).toBe(30);
    store.set(source, 5);
    expect(store.get(family(3))).toBe(15);
    store.dispose();
  });

  it('rejects a write attempt since the definition is read-only', () => {
    const family = derivedFamilyDef((id: string) => () => id);
    const store = createAtomStore(createRuntime());
    expect(() => store.set(family('x') as never, 'y')).toThrow(
      '[store] atom override resolved to a read-only definition'
    );
    store.dispose();
  });

  it('returns the same token per key and supports forget()/clear()', () => {
    const family = derivedFamilyDef((id: string) => () => id);
    const before = family('a');
    expect(family('a')).toBe(before);
    expect(family.forget('a')).toBe(true);
    expect(family('a')).not.toBe(before);
    family.clear();
    expect(family.size).toBe(0);
  });

  it('rejects a non-positive-integer maxSize', () => {
    expect(() => derivedFamilyDef((id: string) => () => id, { maxSize: 0 })).toThrow(RangeError);
  });
});
