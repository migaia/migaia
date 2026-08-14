import { describe, expect, it } from 'vitest';
import { defaultRuntime } from '@migaia/reactive';
import { ObservableArray, ObservableMap, ObservableSet } from '../src';

describe('store-indexed', () => {
  it('supports indexed collection reads and writes', () => {
    const collection = new ObservableArray([1, 2, 3]);
    expect(collection.at(1)).toBe(2);
    collection.set(1, 4);
    expect(collection.at(1)).toBe(4);
    collection.dispose();
  });

  it('ObservableMap.replace() atomically swaps content with a single structural notification', () => {
    const map = new ObservableMap<string, number>([
      ['a', 1],
      ['b', 2]
    ]);
    let runs = 0;
    const dispose = defaultRuntime.effect(() => {
      map.snapshot();
      runs++;
    });
    expect(runs).toBe(1);

    map.replace([
      ['c', 3],
      ['d', 4]
    ]);

    // One notification for the whole swap, not one per removed/added key.
    expect(runs).toBe(2);
    expect(map.snapshot()).toEqual(
      new Map([
        ['c', 3],
        ['d', 4]
      ])
    );
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(false);
    expect(map.size).toBe(2);

    dispose();
    map.dispose();
  });

  it('ObservableMap.replace() accepts a ReadonlyMap and no-ops the notification when content is unchanged', () => {
    const map = new ObservableMap<string, number>([['a', 1]]);
    let runs = 0;
    const dispose = defaultRuntime.effect(() => {
      map.snapshot();
      runs++;
    });
    expect(runs).toBe(1);

    map.replace(new Map([['a', 1]]));
    expect(runs).toBe(1);

    dispose();
    map.dispose();
  });

  it('ObservableSet.replace() atomically swaps content with a single structural notification', () => {
    const set = new ObservableSet<number>([1, 2]);
    let runs = 0;
    const dispose = defaultRuntime.effect(() => {
      set.snapshot();
      runs++;
    });
    expect(runs).toBe(1);

    set.replace([3, 4, 5]);

    // One notification for the whole swap, not one per removed/added value.
    expect(runs).toBe(2);
    expect(set.snapshot()).toEqual(new Set([3, 4, 5]));
    expect(set.has(1)).toBe(false);
    expect(set.has(2)).toBe(false);
    expect(set.size).toBe(3);

    dispose();
    set.dispose();
  });

  it('ObservableSet.replace() no-ops the notification when content is unchanged', () => {
    const set = new ObservableSet<number>([1, 2]);
    let runs = 0;
    const dispose = defaultRuntime.effect(() => {
      set.snapshot();
      runs++;
    });
    expect(runs).toBe(1);

    set.replace([2, 1]);
    expect(runs).toBe(1);

    dispose();
    set.dispose();
  });
});
