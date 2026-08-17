import { describe, expect, it } from 'vitest';
import { ResourceOwnershipRegistry } from '../src/store-resource-ownership.js';
import { createStoreResource } from '../src/store-resource.js';

describe('ResourceOwnershipRegistry (M-T42)', () => {
  it('forceReset() invalidates pre-reset release closures: no decrement, no onRelease', () => {
    const registry = new ResourceOwnershipRegistry<object>();
    let onReleaseCalls = 0;
    const release = registry.retainResource(() => {
      onReleaseCalls++;
    });
    expect(registry.hasOwners).toBe(true);

    registry.forceReset();

    // 旧 release 闭包在 reset 之后调用：计数器不再减、onRelease 不被调用。
    release();
    expect(registry.hasOwners).toBe(false);
    expect(onReleaseCalls).toBe(0);
  });

  it('release obtained after reset() still works normally', () => {
    const registry = new ResourceOwnershipRegistry<object>();
    let onReleaseCalls = 0;
    registry.forceReset();
    const release = registry.retainResource(() => {
      onReleaseCalls++;
    });
    expect(registry.hasOwners).toBe(true);
    release();
    expect(registry.hasOwners).toBe(false);
    expect(onReleaseCalls).toBe(1);
  });

  it('retainVersion release after reset is a no-op too', () => {
    const registry = new ResourceOwnershipRegistry<object>();
    let onReleaseCalls = 0;
    const release = registry.retainVersion(1, () => {
      onReleaseCalls++;
    });
    expect(registry.hasVersionOwners).toBe(true);

    registry.forceReset();

    release();
    expect(registry.hasVersionOwners).toBe(false);
    expect(onReleaseCalls).toBe(0);
  });
});

describe('createStoreResource getSnapshot stability (M-T43)', () => {
  it('getSnapshot() returns the same value across consecutive calls until a load notifies', async () => {
    const resource = createStoreResource<number>({
      load: async () => 1
    });
    const before = resource.getSnapshot();
    expect(resource.getSnapshot()).toBe(before); // 稳定：无变更时严格返回同值

    resource.preload();
    // 让 async load settle + notify 跑完。
    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = resource.getSnapshot();
    expect(after).toBeGreaterThan(before); // 每次 notify() 严格 +1
    expect(resource.getSnapshot()).toBe(after); // 再次稳定
  });
});
