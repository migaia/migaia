import { describe, expect, it } from 'vitest';
import { cookies, localStorage, sessionStorage, memoryStorage } from '../../src/backends';
import { fakeWebStorage } from '../../src/testing/fake-web-storage';
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document';

describe('同步通道与异步通道一致性', () => {
  it('localStorage：sync 与 async 对同一序列操作的最终状态一致', async () => {
    const store = localStorage({ namespace: 'sync-check', storage: fakeWebStorage() });
    store.sync!.set('a', '1');
    await store.set('b', '2');
    store.sync!.remove('a');

    expect(store.sync!.get('a')).toBeNull();
    expect(store.sync!.get('b')).toBe('2');
    await expect(store.get('a')).resolves.toBeNull();
    await expect(store.get('b')).resolves.toBe('2');
  });

  it('sessionStorage 提供完整 sync 通道', () => {
    const store = sessionStorage({ namespace: 'sync-check', storage: fakeWebStorage() });
    expect(store.sync).toBeDefined();
    store.sync!.set('k', 'v');
    expect(store.sync!.get('k')).toBe('v');
    expect(store.sync!.has('k')).toBe(true);
    expect(store.sync!.keys()).toEqual(['k']);
    store.sync!.clearValues();
    expect(store.sync!.keys()).toEqual([]);
  });

  it('memory 提供完整 sync 通道', () => {
    const store = memoryStorage();
    expect(store.sync).toBeDefined();
    store.sync!.set('k', 'v');
    expect(store.sync!.get('k')).toBe('v');
  });

  it('所有同步写入口拒绝非法 options、policy 与异步生命周期字段', () => {
    const stores = [
      memoryStorage(),
      localStorage({ namespace: 'sync-guard-local', storage: fakeWebStorage() }),
      sessionStorage({ namespace: 'sync-guard-session', storage: fakeWebStorage() }),
      cookies({ namespace: 'sync-guard-cookie', document: fakeCookieDocument() })
    ];
    for (const store of stores)
      for (const options of [
        null,
        [],
        'options',
        1,
        { conflictPolicy: 'invalid' },
        { timeoutMs: 1 },
        { signal: new AbortController().signal }
      ])
        expect(() => store.sync.set('key', 'value', options as never)).toThrowError(
          expect.objectContaining({ code: 'INVALID_ARGUMENT' })
        );
  });

  it('所有同步写入口只读取一次 options 字段', () => {
    const stores = [
      memoryStorage(),
      localStorage({ namespace: 'sync-snapshot-local', storage: fakeWebStorage() }),
      sessionStorage({ namespace: 'sync-snapshot-session', storage: fakeWebStorage() }),
      cookies({ namespace: 'sync-snapshot-cookie', document: fakeCookieDocument() })
    ];
    for (const store of stores) {
      let reads = 0;
      store.sync.set('key', 'value', {
        get signal() {
          reads += 1;
          return undefined;
        },
        get timeoutMs() {
          reads += 1;
          return undefined;
        },
        get conflictPolicy() {
          reads += 1;
          return 'replace' as const;
        }
      } as never);
      expect(reads).toBe(3);
    }
  });
});
