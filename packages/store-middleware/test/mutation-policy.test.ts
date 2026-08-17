import { describe, expect, it } from 'vitest';
import { createMutationPolicy, MutationPolicy } from '../src/index';

describe('MutationPolicy', () => {
  it('defaults to "off": never throws, even with no runInAction wrapping', () => {
    const policy = createMutationPolicy();
    expect(policy.insideAction).toBe(false);
    expect(() => policy.assertMutationAllowed()).not.toThrow();
    expect(() => policy.assertMutationAllowed('set(count)')).not.toThrow();
  });

  it('"actions-only": rejects mutation outside an action with the operation name in the message', () => {
    const policy = createMutationPolicy('actions-only');
    expect(() => policy.assertMutationAllowed('set(count)')).toThrow(
      '[store] set(count) is not allowed outside an action'
    );
    // default operation label when none is supplied
    expect(() => policy.assertMutationAllowed()).toThrow(
      '[store] mutation is not allowed outside an action'
    );
  });

  it('"actions-only": allows mutation while inside runInAction', () => {
    const policy = createMutationPolicy('actions-only');
    let insideDuringRun = false;
    policy.runInAction(() => {
      insideDuringRun = policy.insideAction;
      expect(() => policy.assertMutationAllowed()).not.toThrow();
    });
    expect(insideDuringRun).toBe(true);
    expect(policy.insideAction).toBe(false);
    expect(() => policy.assertMutationAllowed()).toThrow();
  });

  it('supports nested runInAction: depth increments/decrements correctly', () => {
    const policy = createMutationPolicy('actions-only');
    policy.runInAction(() => {
      expect(policy.insideAction).toBe(true);
      policy.runInAction(() => {
        expect(policy.insideAction).toBe(true);
      });
      // still inside the outer action after the inner one returns
      expect(policy.insideAction).toBe(true);
    });
    expect(policy.insideAction).toBe(false);
  });

  it('runInAction returns the wrapped function result', () => {
    const policy = createMutationPolicy('actions-only');
    const result = policy.runInAction(() => 42);
    expect(result).toBe(42);
  });

  it('runInAction decrements depth via finally even when fn throws, and rethrows', () => {
    const policy = createMutationPolicy('actions-only');
    expect(() =>
      policy.runInAction(() => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    // depth must have been restored despite the throw
    expect(policy.insideAction).toBe(false);
    expect(() => policy.assertMutationAllowed()).toThrow();
  });

  it('MutationPolicy is directly constructible and behaves the same as the factory', () => {
    const policy = new MutationPolicy('actions-only');
    expect(() => policy.assertMutationAllowed()).toThrow();
  });
});
