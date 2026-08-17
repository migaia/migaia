import { describe, expect, it } from 'vitest';
import { createObjectLeaseRegistry, createStringLeaseRegistry } from '../src/quiescence-tracker';

describe('L-T9 LeaseRegistry: object keys vs string keys', () => {
  it('object-keyed and string-keyed registries are isolated from each other', () => {
    const objectRegistry = createObjectLeaseRegistry<object>();
    const stringRegistry = createStringLeaseRegistry();
    const key = {};
    objectRegistry.retain(key);
    expect(objectRegistry.count(key)).toBe(1);
    expect(stringRegistry.count('k')).toBe(0);
  });

  it('retain()/release() are idempotent for both variants', () => {
    const objectRegistry = createObjectLeaseRegistry<object>();
    const key = {};
    const release = objectRegistry.retain(key);
    release();
    release();
    expect(objectRegistry.count(key)).toBe(0);

    const stringRegistry = createStringLeaseRegistry();
    const releaseString = stringRegistry.retain('k');
    releaseString();
    releaseString();
    expect(stringRegistry.count('k')).toBe(0);
  });

  it('whenZero() does not cross-contaminate between distinct keys in the same registry', async () => {
    const registry = createStringLeaseRegistry();
    const releaseA = registry.retain('a');
    registry.retain('b');
    registry.seal('a');
    registry.seal('b');
    let aResolved = false;
    void registry.whenZero('a').then(() => {
      aResolved = true;
    });
    await Promise.resolve();
    expect(aResolved).toBe(false);
    releaseA(); // only releases 'a', 'b' still held
    await Promise.resolve();
    expect(aResolved).toBe(true);
    // 'b' should still be non-zero and unaffected by 'a' settling.
    expect(registry.count('b')).toBe(1);
  });

  it('the facade passes whenZero()/whenZeroOnce()/seal() straight through — no polling-only surface', () => {
    const registry = createStringLeaseRegistry();
    expect(typeof registry.whenZero).toBe('function');
    expect(typeof registry.whenZeroOnce).toBe('function');
    expect(typeof registry.seal).toBe('function');
    expect(typeof registry.isSealed).toBe('function');
  });
});
