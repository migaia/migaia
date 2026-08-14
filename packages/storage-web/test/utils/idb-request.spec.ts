import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { fromIdbRequest, idbTransactionCommit } from '../../src/utils/idb-request';

const openDb = (): Promise<IDBDatabase> => {
  const factory = new IDBFactory();
  return new Promise((resolve) => {
    const request = factory.open(`idb-request-test-${Math.random().toString(36).slice(2)}`);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
  });
};

describe('fromIdbRequest', () => {
  it('resolves with request.result on success', async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put('v', 'k');
    await idbTransactionCommit(tx);
    await expect(fromIdbRequest(db.transaction('kv').objectStore('kv').get('k'))).resolves.toBe(
      'v'
    );
  });
  it('rejects when the request errors', async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    const pending = fromIdbRequest(tx.objectStore('kv').put('v', 'k'));
    tx.abort();
    await expect(pending).rejects.toBeDefined();
  });
  it('已 abort 的 signal 立即拒绝', async () => {
    const db = await openDb();
    const controller = new AbortController();
    controller.abort('reason');
    await expect(
      fromIdbRequest(db.transaction('kv').objectStore('kv').get('k'), { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });
  it('mid-flight abort 通过 addEventListener 触发拒绝', async () => {
    const db = await openDb();
    const controller = new AbortController();
    const pending = fromIdbRequest(db.transaction('kv').objectStore('kv').get('k'), {
      signal: controller.signal
    });
    controller.abort('mid-flight');
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  });
  it('context.signal 只读取一次且不会丢失 check-subscribe 窗口内的 abort', async () => {
    const db = await openDb();
    let aborted = false;
    let contextReads = 0;
    const signal = {
      get aborted() {
        return aborted;
      },
      reason: 'request race',
      addEventListener: () => {
        aborted = true;
      },
      removeEventListener: () => {}
    };
    await expect(
      fromIdbRequest(db.transaction('kv').objectStore('kv').get('k'), {
        get signal() {
          contextReads += 1;
          return signal as never;
        }
      })
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(contextReads).toBe(1);
  });
  it('listener setup/cleanup 异常遵循共享 operation 协议', async () => {
    const db = await openDb();
    await expect(
      fromIdbRequest(db.transaction('kv').objectStore('kv').get('missing'), {
        signal: {
          aborted: false,
          addEventListener: () => {
            throw new Error('hostile request listener setup');
          },
          removeEventListener: () => {}
        } as never
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      fromIdbRequest(db.transaction('kv').objectStore('kv').get('missing'), {
        signal: {
          aborted: false,
          addEventListener: () => {},
          removeEventListener: () => {
            throw new Error('hostile request listener cleanup');
          }
        } as never
      })
    ).resolves.toBeUndefined();
  });
  it('request result/error getter 异常会 reject 而非悬挂', async () => {
    const resultCause = new Error('hostile request result getter');
    const successRequest = {
      get result(): never {
        throw resultCause;
      },
      set onsuccess(handler: (() => void) | null) {
        queueMicrotask(() => handler?.());
      },
      set onerror(_handler: unknown) {}
    } as unknown as IDBRequest<unknown>;
    await expect(fromIdbRequest(successRequest)).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
      backend: 'indexeddb',
      cause: resultCause
    });

    const errorCause = new Error('hostile request error getter');
    const errorRequest = {
      get error(): never {
        throw errorCause;
      },
      set onsuccess(_handler: unknown) {},
      set onerror(handler: (() => void) | null) {
        queueMicrotask(() => handler?.());
      }
    } as unknown as IDBRequest<unknown>;
    await expect(fromIdbRequest(errorRequest)).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
      backend: 'indexeddb',
      cause: errorCause
    });
  });
  it.each(['onsuccess', 'onerror'] as const)(
    'request %s setter 异常归一为 TRANSACTION_FAILED',
    async (property) => {
      const cause = new Error(`hostile request ${property} setter`);
      const request = {
        set onsuccess(_handler: unknown) {
          if (property === 'onsuccess') throw cause;
        },
        set onerror(_handler: unknown) {
          if (property === 'onerror') throw cause;
        }
      } as unknown as IDBRequest<unknown>;
      await expect(fromIdbRequest(request)).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexeddb',
        cause
      });
    }
  );
});

describe('idbTransactionCommit', () => {
  it('resolves on oncomplete', async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put('v', 'k');
    await expect(idbTransactionCommit(tx)).resolves.toBeUndefined();
  });
  it('rejects on onabort', async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put('v', 'k');
    const pending = idbTransactionCommit(tx);
    tx.abort();
    await expect(pending).rejects.toBeDefined();
  });
  it('非 signal abort 不归类为 ABORTED', async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put('v', 'k');
    const pending = idbTransactionCommit(tx);
    tx.abort();
    await expect(pending).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
  });
  it('已 abort 的 signal 立即拒绝', async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    const controller = new AbortController();
    controller.abort('reason');
    await expect(idbTransactionCommit(tx, { signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED'
    });
  });
  it('mid-flight abort 通过 addEventListener 触发拒绝', async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put('v', 'k');
    const controller = new AbortController();
    const pending = idbTransactionCommit(tx, { signal: controller.signal });
    controller.abort('mid-flight');
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  });
  it('context.signal 只读取一次且不会丢失 check-subscribe 窗口内的 abort', async () => {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put('v', 'k');
    let aborted = false;
    let contextReads = 0;
    const signal = {
      get aborted() {
        return aborted;
      },
      reason: 'transaction race',
      addEventListener: () => {
        aborted = true;
      },
      removeEventListener: () => {}
    };
    await expect(
      idbTransactionCommit(tx, {
        get signal() {
          contextReads += 1;
          return signal as never;
        }
      })
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(contextReads).toBe(1);
  });
  it('transaction listener setup/cleanup 异常遵循共享 operation 协议', async () => {
    const db = await openDb();
    const setupTransaction = db.transaction('kv', 'readwrite');
    setupTransaction.objectStore('kv').put('setup', 'setup');
    await expect(
      idbTransactionCommit(setupTransaction, {
        signal: {
          aborted: false,
          addEventListener: () => {
            throw new Error('hostile transaction listener setup');
          },
          removeEventListener: () => {}
        } as never
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      fromIdbRequest(db.transaction('kv').objectStore('kv').get('setup'))
    ).resolves.toBeUndefined();

    const cleanupTransaction = db.transaction('kv', 'readwrite');
    cleanupTransaction.objectStore('kv').put('cleanup', 'cleanup');
    await expect(
      idbTransactionCommit(cleanupTransaction, {
        signal: {
          aborted: false,
          addEventListener: () => {},
          removeEventListener: () => {
            throw new Error('hostile transaction listener cleanup');
          }
        } as never
      })
    ).resolves.toBeUndefined();
  });
  it('transaction.error getter 异常会 reject 而非逃逸 event callback', async () => {
    const cause = new Error('hostile transaction error getter');
    const transaction = {
      abort: () => {},
      get error(): never {
        throw cause;
      },
      set oncomplete(_handler: unknown) {},
      set onerror(handler: (() => void) | null) {
        queueMicrotask(() => handler?.());
      },
      set onabort(_handler: unknown) {}
    } as unknown as IDBTransaction;
    await expect(idbTransactionCommit(transaction)).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
      backend: 'indexeddb',
      cause
    });
  });
  it.each(['oncomplete', 'onerror', 'onabort'] as const)(
    'transaction %s setter 异常会 reject 并主动 abort',
    async (property) => {
      const cause = new Error(`hostile transaction ${property} setter`);
      let abortCalls = 0;
      const transaction = {
        abort: () => {
          abortCalls += 1;
        },
        set oncomplete(_handler: unknown) {
          if (property === 'oncomplete') throw cause;
        },
        set onerror(_handler: unknown) {
          if (property === 'onerror') throw cause;
        },
        set onabort(_handler: unknown) {
          if (property === 'onabort') throw cause;
        }
      } as unknown as IDBTransaction;
      await expect(idbTransactionCommit(transaction)).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexeddb',
        cause
      });
      expect(abortCalls).toBe(1);
    }
  );
});
