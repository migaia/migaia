import { describe, expect, it } from 'vitest';
import { WebRpcCapabilityRegistry } from '../../src/internal/runtime';

describe('WebRpcCapabilityRegistry', () => {
  it('freezes an owned snapshot without mutating the publisher object', () => {
    const registry = new WebRpcCapabilityRegistry();
    const descriptor = { retry: { maxAttempts: 2 } };
    registry.set('timeout', descriptor);
    registry.freeze();
    descriptor.retry.maxAttempts = 9;
    expect(
      (
        registry.get<{ retry: { maxAttempts: number } }>('timeout') as {
          retry: { maxAttempts: number };
        }
      ).retry.maxAttempts
    ).toBe(2);
    expect(() => registry.set('other', {})).toThrow('frozen');
  });

  it('preserves opaque schema instances in the snapshot', () => {
    class Schema {
      parse(value: unknown): unknown {
        return value;
      }
    }
    const registry = new WebRpcCapabilityRegistry();
    const schema = new Schema();
    registry.set('contract', { schemas: { value: { params: schema } } });
    registry.freeze();
    const snapshot = registry.get<{ schemas: { value: { params: Schema } } }>('contract');
    expect(snapshot?.schemas.value.params).toBe(schema);
    expect(snapshot?.schemas.value.params.parse(1)).toBe(1);
  });
  it('clones own __proto__ entries without changing the snapshot prototype', () => {
    const registry = new WebRpcCapabilityRegistry();
    const descriptor = Object.create(null) as Record<string, unknown>;
    descriptor.__proto__ = { enabled: true };
    registry.set('config', descriptor);
    registry.freeze();
    const snapshot = registry.get<Record<string, unknown>>('config');
    expect(Object.getPrototypeOf(snapshot!)).toBe(null);
    expect(Object.hasOwn(snapshot!, '__proto__')).toBe(true);
    expect(Object.isFrozen(snapshot!)).toBe(true);
  });
});
