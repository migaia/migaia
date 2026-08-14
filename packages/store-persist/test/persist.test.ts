import { describe, expect, it } from 'vitest';
import { memoryStorage } from '@migaia/storage-web';
import { createStore } from '@migaia/store-light';
import { persist } from '../src';

describe('persist（store-light）', () => {
  it('hydrate 未命中时立即可用，写入后 flush 落盘', async () => {
    const store = createStore({ count: 1 });
    const storage = memoryStorage();
    const handle = persist(store, { key: 'count', storage });
    store.count = 2;
    await handle.flush();
    const raw = await storage.get('count');
    expect(raw).toContain('2');
    handle.dispose();
    store.$dispose();
  });

  it('hydrate 命中时把持久化值写回 store', async () => {
    const storage = memoryStorage();
    await storage.set('settings', JSON.stringify({ version: 0, state: { theme: 'dark' } }));
    const store = createStore({ theme: 'light' });
    const handle = persist(store, { key: 'settings', storage });
    await handle.ready;
    expect(store.theme).toBe('dark');
    handle.dispose();
    store.$dispose();
  });

  it('partialize 只持久化裁剪后的字段', async () => {
    const store = createStore({ theme: 'light', session: 'secret' });
    const storage = memoryStorage();
    const handle = persist(store, {
      key: 'partial',
      storage,
      partialize: (state) => ({ theme: state.theme })
    });
    store.theme = 'dark';
    store.session = 'other';
    await handle.flush();
    const raw = await storage.get('partial');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { state: Record<string, unknown> };
    expect(parsed.state).toEqual({ theme: 'dark' });
    handle.dispose();
    store.$dispose();
  });

  it('version 不一致且未提供 migrate 时 hydrate 失败，status 变 error', async () => {
    const storage = memoryStorage();
    await storage.set('versioned', JSON.stringify({ version: 5, state: { count: 1 } }));
    const store = createStore({ count: 0 });
    const handle = persist(store, { key: 'versioned', storage, version: 1 });
    await expect(handle.ready).rejects.toThrow(/provide migrate/);
    expect(handle.status.value).toBe('error');
    handle.dispose();
    store.$dispose();
  });

  it('migrate 转换旧版本存档', async () => {
    const storage = memoryStorage();
    await storage.set('migratable', JSON.stringify({ version: 1, state: { legacyCount: 3 } }));
    const store = createStore({ count: 0 });
    const handle = persist(store, {
      key: 'migratable',
      storage,
      version: 2,
      migrate: (persisted) => ({ count: persisted.legacyCount as number })
    });
    await handle.ready;
    expect(store.count).toBe(3);
    handle.dispose();
    store.$dispose();
  });

  it('合法的 falsy 持久化值（0/false/空字符串）不会被误判成"未命中"', async () => {
    const storage = memoryStorage();
    await storage.set('falsy', JSON.stringify({ version: 0, state: { count: 0, active: false } }));
    const store = createStore({ count: 99, active: true });
    const handle = persist(store, { key: 'falsy', storage });
    await handle.ready;
    expect(store.count).toBe(0);
    expect(store.active).toBe(false);
    handle.dispose();
    store.$dispose();
  });

  it('dispose 在 hydrate 还没落地时调用，settled/ready 都能收敛，不遗留挂起状态', async () => {
    const store = createStore({ count: 1 });
    const storage = memoryStorage();
    const handle = persist(store, { key: 'dispose-during-hydrate', storage });
    handle.dispose(); // 没有 await handle.ready，立刻 dispose
    await handle.settled;
    expect(handle.status.value).toBe('disposed');
    store.$dispose();
  });

  it('dispose 后 flush/clear 立即以 AbortError 结束', async () => {
    const store = createStore({ count: 0 });
    const storage = memoryStorage();
    const handle = persist(store, { key: 'disposed', storage });
    await handle.ready;
    handle.dispose();
    await expect(handle.flush()).rejects.toMatchObject({ name: 'AbortError' });
    await expect(handle.clear()).rejects.toMatchObject({ name: 'AbortError' });
    store.$dispose();
  });

  it('clear() 删除存档但不重置 store 字段', async () => {
    const store = createStore({ count: 1 });
    const storage = memoryStorage();
    const handle = persist(store, { key: 'clearable', storage });
    store.count = 9;
    await handle.flush();
    await handle.clear();
    expect(await storage.get('clearable')).toBeNull();
    expect(store.count).toBe(9);
    handle.dispose();
    store.$dispose();
  });
});
