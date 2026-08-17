import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract';
import { IDBDatabase, IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { indexedDb } from '../../src/backends/indexed-db';

const encoder = new TextEncoder();

/** 每个用例一套全新的 IndexedDB，避免相互串数据。 */
const freshFactory = () => new IDBFactory();
const freshDb = () =>
  indexedDb({
    factory: freshFactory(),
    keyRange: IDBKeyRange,
    dbName: `test-${Math.random().toString(36).slice(2)}`
  });

describe('indexedDb backend', () => {
  it('构造期拒绝 null、数组和 primitive options', () => {
    for (const options of [null, [], 'options', 1])
      expect(() => indexedDb(options as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      );
  });

  it('构造期拒绝非 boolean cleanupLegacyRecords', () => {
    for (const cleanupLegacyRecords of [null, 'yes', 1, []])
      expect(() =>
        indexedDb({
          factory: freshFactory(),
          keyRange: IDBKeyRange,
          cleanupLegacyRecords: cleanupLegacyRecords as never
        })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('构造字段 getter 异常统一返回 INVALID_CONFIG', () => {
    expect(() =>
      indexedDb({
        get dbName(): string {
          throw new Error('hostile dbName');
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('拒绝运行时非字符串 value', async () => {
    const store = freshDb();
    await expect(store.set('key', 42 as unknown as string)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
    await store.dispose();
  });
  it('L0、bytes 与 metadata 通道拒绝运行时非字符串 key', async () => {
    const store = freshDb();
    const invalidKey = 42 as unknown as string;
    for (const invoke of [
      () => store.get(invalidKey),
      () => store.set(invalidKey, 'value'),
      () => store.remove(invalidKey),
      () => store.has(invalidKey),
      () => store.getBytes(invalidKey),
      () => store.setBytes(invalidKey, new Uint8Array([1])),
      () => store.metadata!.get(invalidKey),
      () => store.metadata!.set(invalidKey, 'value'),
      () => store.metadata!.delete(invalidKey)
    ])
      await expect(invoke()).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        backend: 'indexeddb'
      });
    await store.dispose();
  });

  it('clearRecords 在 epoch 请求期间 abort 时不提交 destructive clear', async () => {
    const store = freshDb();
    await store.putRecord({ keep: true }, 'keep');
    const controller = new AbortController();
    const pending = store.clearRecords({ signal: controller.signal });
    controller.abort('cancel clear');
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(store.getRecord('keep')).resolves.toEqual({ keep: true });
    await store.dispose();
  });

  it('clearRecords revision result getter 异常会 reject 且不执行 clear', async () => {
    const store = freshDb();
    await store.putRecord({ keep: true }, 'revision-result-keep');
    const originalGet = IDBObjectStore.prototype.get;
    const cause = new Error('hostile revision result getter');
    IDBObjectStore.prototype.get = (() =>
      ({
        get result(): never {
          throw cause;
        },
        set onsuccess(handler: (() => void) | null) {
          queueMicrotask(() => handler?.());
        },
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalGet;
    try {
      await expect(store.clearRecords()).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexeddb',
        cause
      });
    } finally {
      IDBObjectStore.prototype.get = originalGet;
    }
    await expect(store.getRecord('revision-result-keep')).resolves.toEqual({ keep: true });
    await store.dispose();
  });

  it.each(['clearAll', 'deleteRecord', 'clearRecords'] as const)(
    '%s revision handler setter 异常会回滚 destructive transaction',
    async (operation) => {
      const store = freshDb();
      await store.set('keep-value', 'value');
      await store.putRecord({ keep: true }, 'keep-record');
      const originalGet = IDBObjectStore.prototype.get;
      const cause = new Error(`hostile ${operation} revision handler setter`);
      IDBObjectStore.prototype.get = (() =>
        ({
          set onsuccess(_handler: unknown) {
            throw cause;
          },
          set onerror(_handler: unknown) {}
        }) as unknown as IDBRequest) as typeof originalGet;
      try {
        const pending =
          operation === 'clearAll'
            ? store.clearAll()
            : operation === 'deleteRecord'
              ? store.deleteRecord('keep-record')
              : store.clearRecords();
        await expect(pending).rejects.toMatchObject({
          code: 'TRANSACTION_FAILED',
          backend: 'indexeddb',
          cause
        });
      } finally {
        IDBObjectStore.prototype.get = originalGet;
      }
      await expect(store.get('keep-value')).resolves.toBe('value');
      await expect(store.getRecord('keep-record')).resolves.toEqual({ keep: true });
      await store.dispose();
    }
  );

  it('clearAll 在 epoch 请求期间 abort 时不提交 destructive clear', async () => {
    const store = freshDb();
    await store.set('keep', 'value');
    await store.putRecord({ keep: true }, 'record');
    const controller = new AbortController();
    const pending = store.clearAll({ signal: controller.signal });
    controller.abort('cancel clear all');
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(store.get('keep')).resolves.toBe('value');
    await expect(store.getRecord('record')).resolves.toEqual({ keep: true });
    await store.dispose();
  });

  it('deleteRecord 在 revision 请求期间 abort 时不提交 delete', async () => {
    const store = freshDb();
    await store.putRecord({ keep: true }, 'delete-me');
    const controller = new AbortController();
    const pending = store.deleteRecord('delete-me', { signal: controller.signal });
    await Promise.resolve();
    controller.abort('cancel delete');
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(store.getRecord('delete-me')).resolves.toEqual({ keep: true });
    await store.dispose();
  });

  it('putRecord 在 revision 请求期间 abort 时不提交 put', async () => {
    const store = freshDb();
    await store.putRecord({ warm: true }, 'warm');
    const controller = new AbortController();
    const pending = store.putRecord({ keep: true }, 'put-me', {
      signal: controller.signal
    });
    await Promise.resolve();
    controller.abort('cancel put');
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(store.getRecord('put-me')).resolves.toBeUndefined();
    await store.dispose();
  });
  it('拒绝非 Uint8Array 的 bytes value', async () => {
    const store = freshDb();
    await expect(
      store.setBytes('key', new DataView(new ArrayBuffer(1)) as unknown as Uint8Array)
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    await store.dispose();
  });

  it('拒绝结构非法的 factory 与 keyRange 注入', () => {
    expect(() => indexedDb({ factory: {} as IDBFactory })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    );
    expect(() =>
      indexedDb({ factory: freshFactory(), keyRange: {} as typeof IDBKeyRange })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('拒绝空/非法数据库名、重复/保留名和空的 channel store 名', () => {
    expect(() =>
      indexedDb({ factory: freshFactory(), keyRange: IDBKeyRange, dbName: '' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() =>
      indexedDb({
        factory: freshFactory(),
        keyRange: IDBKeyRange,
        dbName: null as unknown as string
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() =>
      indexedDb({
        factory: freshFactory(),
        keyRange: IDBKeyRange,
        kvStoreName: 'same',
        bytesStoreName: 'same'
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() =>
      indexedDb({
        factory: freshFactory(),
        keyRange: IDBKeyRange,
        recordsStoreName: '__storage_web_revisions__'
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() =>
      indexedDb({ factory: freshFactory(), keyRange: IDBKeyRange, recordsStoreName: '' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    expect(() =>
      indexedDb({
        factory: freshFactory(),
        keyRange: IDBKeyRange,
        bytesStoreName: null as unknown as string
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('不同 records store 的 transaction revision 不互相污染', async () => {
    const factory = freshFactory();
    const first = indexedDb({
      factory,
      keyRange: IDBKeyRange,
      dbName: 'revision-scope',
      recordsStoreName: 'records-a'
    });
    const second = indexedDb({
      factory,
      keyRange: IDBKeyRange,
      dbName: 'revision-scope',
      recordsStoreName: 'records-b'
    });
    await first.putRecord({ value: 'a' }, 'same');
    await second.putRecord({ value: 'b' }, 'same');
    await expect(first.transaction(async (tx) => tx.get('same'))).resolves.toEqual({ value: 'a' });
    await first.dispose();
    await second.dispose();
  });

  it('首次 transaction snapshot 将 record、revision 与 epoch 绑定在同一 readonly transaction', async () => {
    const factory = freshFactory();
    const dbName = 'snapshot-epoch-atomic';
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    await store.putRecord({ value: 'before' }, 'key');
    let release: (() => void) | undefined;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = store.transaction(async (tx) => {
      await tx.get('key');
      await pause;
      await tx.put({ value: 'transaction' }, 'key');
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await store.clearRecords();
    await store.putRecord({ value: 'after-clear' }, 'key');
    release!();
    await expect(transaction).rejects.toMatchObject({ code: 'TRANSACTION_CONFLICT' });
    await expect(store.getRecord('key')).resolves.toEqual({ value: 'after-clear' });
    await store.dispose();
  });

  it('writeTo 路径在 pre-abort 时不调度写入并稳定返回 ABORTED', async () => {
    const store = indexedDb({
      factory: freshFactory(),
      keyRange: IDBKeyRange,
      dbName: 'pre-abort-write-to'
    });
    const controller = new AbortController();
    controller.abort('before remove');
    await expect(store.remove('key', { signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED'
    });
    await expect(store.clearValues({ signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED'
    });
    await store.dispose();
  });

  it('读取路径等待 readonly transaction settle 后才返回', async () => {
    const store = freshDb();
    await store.set('settle', 'ok');
    await expect(store.get('settle')).resolves.toBe('ok');
    await expect(store.getRecord('missing')).resolves.toBeUndefined();
    await store.dispose();
  });

  it('初始化 schema meta checkpoint，并补建旧库缺失的 meta store', async () => {
    const factory = freshFactory();
    const dbName = 'meta-checkpoint';
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    await store.get('probe');
    await store.dispose();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(database.objectStoreNames.contains('storage-web:meta')).toBe(true);
    const transaction = database.transaction('storage-web:meta', 'readonly');
    await new Promise<void>((resolve, reject) => {
      const request = transaction.objectStore('storage-web:meta').get('schema');
      request.onsuccess = () => {
        expect(request.result).toMatchObject({ version: 2, keySpace: 'repository-v2' });
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    database.close();
  });

  it('upgrade 将历史 documents store 复制到 records，并保留旧 store 供人工清理', async () => {
    const factory = freshFactory();
    const dbName = 'documents-to-records';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents');
        request.result.createObjectStore('records');
      };
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put({ legacy: true }, 'legacy-key');
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();

    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    await expect(store.getRecord('legacy-key')).resolves.toEqual({ legacy: true });
    await store.dispose();
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName);
      request.onsuccess = () => resolve(request.result);
    });
    expect(database.objectStoreNames.contains('documents')).toBe(true);
    const metadata = await new Promise<unknown>((resolve) => {
      const transaction = database.transaction('storage-web:meta', 'readonly');
      const request = transaction.objectStore('storage-web:meta').get('migration:records-v1-to-v2');
      request.onsuccess = () => resolve(request.result);
    });
    expect(metadata).toMatchObject({ status: 'complete', from: 'documents', to: 'records' });
    database.close();
  });

  it('后续 schema upgrade 不会重复 legacy copy 覆盖已迁移 records', async () => {
    const factory = freshFactory();
    const dbName = 'documents-copy-once';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents');
        request.result.createObjectStore('records');
      };
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put({ value: 'legacy' }, 'key');
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();
    const first = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    await expect(first.getRecord('key')).resolves.toEqual({ value: 'legacy' });
    await first.putRecord({ value: 'new' }, 'key', { conflictPolicy: 'replace' });
    await first.dispose();
    const second = indexedDb({ factory, keyRange: IDBKeyRange, dbName, kvStoreName: 'kv-next' });
    await expect(second.getRecord('key')).resolves.toEqual({ value: 'new' });
    await second.dispose();
  });

  it('cleanupLegacyRecords 显式开启时才删除 documents store', async () => {
    const factory = freshFactory();
    const dbName = 'documents-cleanup-opt-in';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put({ legacy: true }, 'key');
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName, cleanupLegacyRecords: true });
    await expect(store.getRecord('key')).resolves.toEqual({ legacy: true });
    await store.dispose();
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName);
      request.onsuccess = () => resolve(request.result);
    });
    expect(database.objectStoreNames.contains('documents')).toBe(false);
    database.close();
  });

  it('后续显式 cleanup 可清理已完成迁移但仍保留的 documents store', async () => {
    const factory = freshFactory();
    const dbName = 'documents-late-cleanup';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put({ legacy: true }, 'key');
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();
    const first = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    await expect(first.getRecord('key')).resolves.toEqual({ legacy: true });
    await first.dispose();
    const cleanup = indexedDb({
      factory,
      keyRange: IDBKeyRange,
      dbName,
      cleanupLegacyRecords: true
    });
    await expect(cleanup.getRecord('key')).resolves.toEqual({ legacy: true });
    await cleanup.dispose();
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName);
      request.onsuccess = () => resolve(request.result);
    });
    expect(database.objectStoreNames.contains('documents')).toBe(false);
    database.close();
  });

  it('legacy migration 超过单批后按 lastKey 继续，不重复首批', async () => {
    const factory = freshFactory();
    const dbName = 'documents-large-migration';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      const documents = transaction.objectStore('documents');
      for (let index = 0; index < 130; index += 1)
        documents.put({ index }, `legacy-${String(index).padStart(3, '0')}`);
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    await expect(store.getRecord('legacy-000')).resolves.toEqual({ index: 0 });
    await store.dispose();
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = database.transaction('records', 'readonly');
    const count = await new Promise<number>((resolve, reject) => {
      const request = transaction.objectStore('records').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(count).toBe(130);
    database.close();
  });

  it('legacy migration 缺少 keyRange 失败后可用新连接从 checkpoint 重试', async () => {
    const factory = freshFactory();
    const dbName = 'documents-migration-retry';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      for (let index = 0; index < 130; index += 1)
        transaction
          .objectStore('documents')
          .put({ index }, `key-${String(index).padStart(3, '0')}`);
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();
    await expect(indexedDb({ factory, dbName }).getRecord('key-000')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE'
    });
    const retry = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    await expect(retry.getRecord('key-129')).resolves.toEqual({ index: 129 });
    await retry.dispose();
  });

  it('legacy migration cursor result getter 异常会 settle 为 TRANSACTION_FAILED', async () => {
    const factory = freshFactory();
    const dbName = 'documents-hostile-cursor-result';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put({ legacy: true }, 'key');
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    const originalClose = IDBDatabase.prototype.close;
    const cause = new Error('hostile legacy cursor result getter');
    const closeCause = new Error('hostile rollback close');
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        get result(): never {
          IDBDatabase.prototype.close = () => {
            throw closeCause;
          };
          throw cause;
        },
        set onsuccess(handler: (() => void) | null) {
          queueMicrotask(() => handler?.());
        },
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor;
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    try {
      await expect(store.getRecord('key')).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexeddb',
        operation: 'indexeddb.legacy.cursor',
        cause
      });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
      IDBDatabase.prototype.close = originalClose;
      await store.dispose();
    }
  });

  it('legacy migration transaction 提前 complete 时不会永久 pending', async () => {
    const factory = freshFactory();
    const dbName = 'documents-premature-cursor-complete';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put({ legacy: true }, 'key');
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        set onsuccess(_handler: unknown) {},
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor;
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    try {
      await expect(store.getRecord('key')).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexeddb',
        operation: 'indexeddb.legacy.cursor'
      });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
      await store.dispose();
    }
  });

  it('legacy cursor request handler setter 异常会 abort 并保留 operation', async () => {
    const factory = freshFactory();
    const dbName = 'documents-hostile-cursor-setter';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put({ legacy: true }, 'key');
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    const cause = new Error('hostile legacy cursor onsuccess setter');
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        set onsuccess(_handler: unknown) {
          throw cause;
        },
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor;
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    try {
      await expect(store.getRecord('key')).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexeddb',
        operation: 'indexeddb.legacy.cursor',
        cause
      });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
      await store.dispose();
    }
  });

  it('legacy migration 不覆盖已存在的 records v2 键', async () => {
    const factory = freshFactory();
    const dbName = 'documents-migration-winner';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('documents');
        request.result.createObjectStore('records');
      };
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put({ value: 'legacy' }, 'same');
      transaction.oncomplete = () => resolve();
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('records', 'readwrite');
      transaction.objectStore('records').put({ value: 'current' }, 'same');
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    await expect(store.getRecord('same')).resolves.toEqual({ value: 'current' });
    await store.dispose();
  });

  it('backend 与 capabilities 正确声明（无 sync 通道）', () => {
    const store = freshDb();
    expect(store.backend).toBe('indexeddb');
    expect(store.capabilities.syncRead).toBe(false);
    expect(store.capabilities.binary).toBe(true);
    expect(store.capabilities.records).toBe(true);
    expect(store.sync).toBeUndefined();
    expect(store.metadata).toBeDefined();
  });

  it('metadata channel persists and deletes maintenance state', async () => {
    const store = freshDb();
    await store.metadata!.set('maintenance', { batch: 2 });
    await expect(store.metadata!.get('maintenance')).resolves.toEqual({ batch: 2 });
    await store.metadata!.delete('maintenance');
    await expect(store.metadata!.get('maintenance')).resolves.toBeUndefined();
  });

  it('未提供 factory 且 globalThis.indexedDB 不存在时抛 BACKEND_UNAVAILABLE', () => {
    expect(() => indexedDb({ factory: undefined as unknown as IDBFactory })).toThrow(
      expect.objectContaining({ code: 'BACKEND_UNAVAILABLE' })
    );
  });

  it('两条通道字节原样存取，文本通道存字符串', async () => {
    const store = freshDb();
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await store.setBytes('bin-key', bytes);
    await expect(store.getBytes('bin-key')).resolves.toEqual(bytes);
    await expect(store.get('bin-key')).resolves.toBeNull();

    await store.set('text-key', '{"a":1}');
    await expect(store.get('text-key')).resolves.toBe('{"a":1}');
    await expect(store.getBytes('text-key')).resolves.toBeNull();
  });

  it('iterateRecords 按 pageSize 分页且保持完整顺序', async () => {
    const store = freshDb();
    for (let index = 0; index < 5; index += 1) await store.putRecord({ index }, `page-${index}`);
    const keys: string[] = [];
    for await (const [key] of store.iterateRecords(undefined, { pageSize: 2 }))
      keys.push(key as string);
    expect(keys).toEqual(['page-0', 'page-1', 'page-2', 'page-3', 'page-4']);
  });

  it('非字符串 record key 不与 value/bytes 字符串 key 冲突', async () => {
    const store = freshDb();
    await store.set('1', 'text');
    await store.putRecord({ kind: 'number' }, 1);
    await expect(store.get('1')).resolves.toBe('text');
    await expect(store.getRecord(1)).resolves.toEqual({ kind: 'number' });
    await store.putRecord({ kind: 'date' }, new Date('2024-01-01T00:00:00Z'));
    await expect(store.get('1')).resolves.toBe('text');
  });

  it('已 abort 的 signal 立即拒绝', async () => {
    const store = freshDb();
    const controller = new AbortController();
    controller.abort();
    await expect(store.set('k', 'v', { signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED'
    });
  });

  it('request event 中动态 signal getter 失败会 settle 为 INVALID_CONFIG', async () => {
    const store = freshDb();
    await store.get('warm-connection');
    const originalGet = IDBObjectStore.prototype.get;
    let reads = 0;
    IDBObjectStore.prototype.get = (() => {
      const cause = new DOMException('forced request failure', 'UnknownError');
      return {
        error: cause,
        result: undefined,
        set onsuccess(_handler: unknown) {},
        set onerror(handler: (() => void) | null) {
          queueMicrotask(() => handler?.());
        }
      } as IDBRequest;
    }) as typeof originalGet;
    try {
      await expect(
        store.get('dynamic-signal', {
          signal: {
            get aborted() {
              reads += 1;
              if (reads === 9) throw new Error('hostile dynamic aborted getter');
              return false;
            },
            addEventListener: () => {},
            removeEventListener: () => {}
          } as never
        })
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(reads).toBe(9);
    } finally {
      IDBObjectStore.prototype.get = originalGet;
      await store.dispose();
    }
  });

  it('重复打开同一个 dbName 复用同一个连接（不重复升级）', async () => {
    const factory = freshFactory();
    const dbName = `shared-${Math.random().toString(36).slice(2)}`;
    const storeA = indexedDb({ factory, dbName });
    await storeA.set('k', 'from-a');
    const storeB = indexedDb({ factory, dbName });
    await expect(storeB.get('k')).resolves.toBe('from-a');
  });

  it('dispose 后关闭连接，操作抛 STORE_DISPOSED', async () => {
    const store = freshDb();
    await store.set('k', 'v');
    await store.dispose();
    await expect(store.get('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' });
  });

  it('dispose 在连接从未建立时也是无操作', async () => {
    const store = freshDb();
    await expect(store.dispose()).resolves.toBeUndefined();
  });

  it('getBytes 对已存在但类型不是字节的值返回 null', async () => {
    const store = freshDb();
    await store.set('k', 'plain text');
    await expect(store.getBytes('k')).resolves.toBeNull();
  });

  it('iterate 遍历 records store，range 按 IDBKeyRange 语义过滤', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 1);
    await store.putRecord({ v: 2 }, 2);
    await store.putRecord({ v: 3 }, 3);

    const collect = async (range?: Parameters<typeof store.iterateRecords>[0]) => {
      const seen: unknown[] = [];
      for await (const [, value] of store.iterateRecords(range)) seen.push(value);
      return seen;
    };

    expect(await collect()).toHaveLength(3);
    expect(await collect({ lower: 2 })).toEqual([{ v: 2 }, { v: 3 }]);
    expect(await collect({ upper: 2, upperOpen: true })).toEqual([{ v: 1 }]);
    expect(await collect({ lower: 1, lowerOpen: true, upper: 3 })).toEqual([{ v: 2 }, { v: 3 }]);
  });

  it('iterate 在已 abort 时抛 ABORTED', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 1);
    const controller = new AbortController();
    controller.abort();
    const iterator = store.iterateRecords(undefined, { signal: controller.signal });
    await expect(iterator.next()).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('悬挂 cursor 在外部 abort 后主动唤醒并以 ABORTED 结束', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 'hanging-key');
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = (() => ({}) as IDBRequest) as typeof originalOpenCursor;
    const controller = new AbortController();
    try {
      const pending = store.iterateRecords(undefined, { signal: controller.signal }).next();
      await Promise.resolve();
      controller.abort('hanging cursor');
      await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
    }
  });

  it('悬挂 cursor 在 timeout 到期后主动唤醒并以 ABORTED 结束', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 'timeout-hanging-key');
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = (() => ({}) as IDBRequest) as typeof originalOpenCursor;
    try {
      const pending = store.iterateRecords(undefined, { timeoutMs: 0 }).next();
      await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
    }
  });

  it('cursor listener 同步 abort race 稳定返回 ABORTED', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 'sync-abort-key');
    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
      reason: 'sync cursor abort',
      addEventListener: (_type: string, listener: () => void) => {
        aborted = true;
        listener();
      },
      removeEventListener: () => {}
    } as never;
    await expect(store.iterateRecords(undefined, { signal }).next()).rejects.toMatchObject({
      code: 'ABORTED',
      cause: 'sync cursor abort'
    });
  });

  it('cursor listener setup/cleanup 异常遵循共享 operation 协议', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 'listener-key');
    await expect(
      store
        .iterateRecords(undefined, {
          signal: {
            aborted: false,
            addEventListener: () => {
              throw new Error('hostile cursor listener setup');
            },
            removeEventListener: () => {}
          } as never
        })
        .next()
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const result = await store
      .iterateRecords(undefined, {
        signal: {
          aborted: false,
          addEventListener: () => {},
          removeEventListener: () => {
            throw new Error('hostile cursor listener cleanup');
          }
        } as never
      })
      .next();
    expect(result.value?.[1]).toEqual({ v: 1 });
  });

  it('cursor request.error 统一归一为 TRANSACTION_FAILED 并保留 cause', async () => {
    const store = freshDb();
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    const cause = new DOMException('cursor failed', 'UnknownError');
    IDBObjectStore.prototype.openCursor = (() => {
      const request = {
        error: cause,
        result: null,
        set onsuccess(_handler: unknown) {},
        set onerror(handler: (() => void) | null) {
          queueMicrotask(() => handler?.());
        }
      };
      return request;
    }) as typeof originalOpenCursor;
    try {
      await expect(store.iterateRecords().next()).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        cause
      });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
    }
  });

  it('cursor request.result getter 异常会 settle 为 TRANSACTION_FAILED', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 'cursor-result-key');
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    const cause = new Error('hostile cursor result getter');
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        get result(): never {
          throw cause;
        },
        set onsuccess(handler: (() => void) | null) {
          queueMicrotask(() => handler?.());
        },
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor;
    try {
      await expect(store.iterateRecords().next()).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexeddb',
        operation: 'indexeddb.cursor',
        cause
      });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
      await store.dispose();
    }
  });

  it('cursor request.result getter 抛 contract 错误原样穿透（不归一为 TRANSACTION_FAILED）', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 'cursor-contract-key');
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    const cause = new Error('hostile contract result getter');
    const contractError = new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause
    });
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        get result(): never {
          throw contractError;
        },
        set onsuccess(handler: (() => void) | null) {
          queueMicrotask(() => handler?.());
        },
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor;
    try {
      await expect(store.iterateRecords().next()).rejects.toMatchObject({
        source: '@migaia/storage-contract',
        code: 'INVALID_ARGUMENT',
        cause
      });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
      await store.dispose();
    }
  });

  it.each(['key', 'value', 'continue'] as const)(
    'cursor %s 异常保留 owning operation 且不会泄漏 callback',
    async (attack) => {
      const store = freshDb();
      await store.putRecord({ v: 1 }, `cursor-${attack}-key`);
      const originalOpenCursor = IDBObjectStore.prototype.openCursor;
      const cause = new Error(`hostile cursor ${attack}`);
      const cursor = {
        get key(): IDBValidKey {
          if (attack === 'key') throw cause;
          return 'key';
        },
        get value(): unknown {
          if (attack === 'value') throw cause;
          return { v: 1 };
        },
        continue: () => {
          if (attack === 'continue') throw cause;
        }
      } as unknown as IDBCursorWithValue;
      IDBObjectStore.prototype.openCursor = (() =>
        ({
          result: cursor,
          set onsuccess(handler: (() => void) | null) {
            queueMicrotask(() => handler?.());
          },
          set onerror(_handler: unknown) {}
        }) as unknown as IDBRequest) as typeof originalOpenCursor;
      try {
        await expect(store.iterateRecords().next()).rejects.toMatchObject({
          code: 'TRANSACTION_FAILED',
          backend: 'indexeddb',
          operation: 'indexeddb.cursor',
          cause
        });
      } finally {
        IDBObjectStore.prototype.openCursor = originalOpenCursor;
        await store.dispose();
      }
    }
  );

  it('cursor transaction 提前 complete 时不会永久 pending', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 'premature-complete-key');
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        set onsuccess(_handler: unknown) {},
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor;
    try {
      await expect(store.iterateRecords().next()).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexeddb',
        operation: 'indexeddb.cursor'
      });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
      await store.dispose();
    }
  });

  it('runtime cursor request handler setter 异常会 abort 并保留 operation', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 'cursor-setter-key');
    const originalOpenCursor = IDBObjectStore.prototype.openCursor;
    const cause = new Error('hostile runtime cursor onsuccess setter');
    IDBObjectStore.prototype.openCursor = (() =>
      ({
        set onsuccess(_handler: unknown) {
          throw cause;
        },
        set onerror(_handler: unknown) {}
      }) as unknown as IDBRequest) as typeof originalOpenCursor;
    try {
      await expect(store.iterateRecords().next()).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        backend: 'indexeddb',
        operation: 'indexeddb.cursor',
        cause
      });
    } finally {
      IDBObjectStore.prototype.openCursor = originalOpenCursor;
      await store.dispose();
    }
  });

  it('transaction 成功后写入持久化', async () => {
    const store = freshDb();
    await store.transaction(async (tx) => {
      await tx.put({ v: 1 }, 'tx-key');
    });
    await expect(store.getRecord('tx-key')).resolves.toEqual({ v: 1 });
  });

  it('transaction 内抛错时通过原生 abort 整批回滚', async () => {
    const store = freshDb();
    await store.putRecord({ v: 'before' }, 'existing');
    await expect(
      store.transaction(async (tx) => {
        await tx.put({ v: 'new' }, 'tx-key');
        await tx.delete('existing');
        throw new Error('boom');
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
    await expect(store.getRecord('tx-key')).resolves.toBeUndefined();
    await expect(store.getRecord('existing')).resolves.toEqual({ v: 'before' });
  });

  it('transaction 内跨宏任务 await 后仍保持单次提交语义', async () => {
    const store = freshDb();
    await expect(
      store.transaction(async (tx) => {
        await tx.put({ v: 1 }, 'k');
        // draft 事务允许回调跨宏任务，不会让底层 IDB 事务提前提交。
        await new Promise((resolve) => setTimeout(resolve, 10));
        await tx.put({ v: 2 }, 'k2');
      })
    ).resolves.toBeUndefined();
    await expect(store.getRecord('k')).resolves.toEqual({ v: 1 });
    await expect(store.getRecord('k2')).resolves.toEqual({ v: 2 });
  });

  it('自动生成 key（putRecord 不传 key）可用返回值读回', async () => {
    const store = freshDb();
    const key = await store.putRecord({ a: 1 });
    await expect(store.getRecord(key)).resolves.toEqual({ a: 1 });
  });

  it('setBytes 接受由其他 codec 产出的字节', async () => {
    const store = freshDb();
    await store.setBytes('k', encoder.encode('hello'));
    const read = await store.getBytes('k');
    expect(read).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(read!)).toBe('hello');
  });

  it('transaction 作用域内 get 可读取快照内已写入的值', async () => {
    const store = freshDb();
    await store.putRecord({ v: 1 }, 'k');
    await store.transaction(async (tx) => {
      await expect(tx.get('k')).resolves.toEqual({ v: 1 });
      await expect(tx.get('missing')).resolves.toBeUndefined();
    });
  });

  it('getBytes 对原生 ArrayBuffer（非 Uint8Array 包装）值也能识别', async () => {
    const factory = freshFactory();
    const dbName = `raw-buffer-${Math.random().toString(36).slice(2)}`;
    // 直接用原生 IDB API 写入一个裸 ArrayBuffer，模拟某些实现把字节还原成
    // ArrayBuffer 而不是 Uint8Array 的情况。
    const rawDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('kv');
        request.result.createObjectStore('bytes');
        request.result.createObjectStore('records');
      };
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = rawDb.transaction('bytes', 'readwrite');
      tx.objectStore('bytes').put(new Uint8Array([9, 8, 7]).buffer, 'raw-buffer-key');
      tx.oncomplete = () => resolve();
    });
    rawDb.close();

    const store = indexedDb({ factory, dbName, keyRange: IDBKeyRange });
    await expect(store.getBytes('raw-buffer-key')).resolves.toEqual(new Uint8Array([9, 8, 7]));
  });

  it('已有部分 store（缺 records store）时补建，不影响已有数据', async () => {
    const factory = freshFactory();
    const dbName = `partial-${Math.random().toString(36).slice(2)}`;
    // 模拟只创建过 kv store 的旧版数据库。
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = legacyDb.transaction('kv', 'readwrite');
      tx.objectStore('kv').put('legacy-value', 'legacy-key');
      tx.oncomplete = () => resolve();
    });
    legacyDb.close();

    const store = indexedDb({ factory, dbName, keyRange: IDBKeyRange });
    await expect(store.get('legacy-key')).resolves.toBe('legacy-value');
    await store.putRecord({ v: 1 }, 'doc-key');
    await expect(store.getRecord('doc-key')).resolves.toEqual({ v: 1 });
  });

  it('升级前 close 抛错时保留 recovery connection 并允许后续重试', async () => {
    const factory = freshFactory();
    const dbName = 'partial-hostile-transition-close';
    const legacyDb = await new Promise<IDBDatabase>((resolve) => {
      const request = factory.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const transaction = legacyDb.transaction('kv', 'readwrite');
      transaction.objectStore('kv').put('legacy-value', 'legacy-key');
      transaction.oncomplete = () => resolve();
    });
    legacyDb.close();

    const originalClose = IDBDatabase.prototype.close;
    const cause = new Error('hostile transition close');
    IDBDatabase.prototype.close = () => {
      throw cause;
    };
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    try {
      await expect(store.get('legacy-key')).rejects.toMatchObject({
        code: 'BACKEND_UNAVAILABLE',
        backend: 'indexeddb',
        operation: 'indexeddb.close',
        cause
      });
      IDBDatabase.prototype.close = originalClose;
      await expect(store.get('legacy-key')).resolves.toBe('legacy-value');
      await expect(store.putRecord({ recovered: true }, 'record')).resolves.toBe('record');
    } finally {
      IDBDatabase.prototype.close = originalClose;
      await store.dispose();
    }
  });

  it.each(['objectStoreNames', 'version'] as const)(
    'open schema inspection 的 %s getter 异常会关闭连接并允许重试',
    async (property) => {
      const factory = freshFactory();
      const dbName = `hostile-schema-${property}`;
      const emptyDatabase = await new Promise<IDBDatabase>((resolve) => {
        const request = factory.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
      });
      emptyDatabase.close();
      const cause = new Error(`hostile database ${property} getter`);
      let intercepted = false;
      const hostileFactory = {
        open: (name: string, version?: number) => {
          const nativeRequest =
            version === undefined ? factory.open(name) : factory.open(name, version);
          if (intercepted) return nativeRequest;
          intercepted = true;
          return {
            get result(): IDBDatabase {
              const database = nativeRequest.result;
              return new Proxy(database, {
                get: (target, key) => {
                  if (key === property) throw cause;
                  if (key === 'close') return () => target.close();
                  return Reflect.get(target, key, target);
                }
              });
            },
            get transaction(): IDBTransaction | null {
              return nativeRequest.transaction;
            },
            get error(): DOMException | null {
              return nativeRequest.error;
            },
            set onupgradeneeded(handler: (() => void) | null) {
              nativeRequest.onupgradeneeded = () => handler?.();
            },
            set onblocked(handler: (() => void) | null) {
              nativeRequest.onblocked = () => handler?.();
            },
            set onerror(handler: (() => void) | null) {
              nativeRequest.onerror = () => handler?.();
            },
            set onsuccess(handler: (() => void) | null) {
              nativeRequest.onsuccess = () => handler?.();
            }
          } as unknown as IDBOpenDBRequest;
        }
      } as unknown as IDBFactory;
      const store = indexedDb({ factory: hostileFactory, keyRange: IDBKeyRange, dbName });
      try {
        await expect(store.get('key')).rejects.toMatchObject({
          code: 'BACKEND_UNAVAILABLE',
          backend: 'indexeddb',
          operation: 'indexeddb.open',
          cause
        });
        await expect(store.set('key', 'recovered')).resolves.toBeUndefined();
        await expect(store.get('key')).resolves.toBe('recovered');
      } finally {
        await store.dispose();
      }
    }
  );

  it.each(['onversionchange', 'onclose'] as const)(
    'connection %s setter 异常会关闭连接并允许同实例重试',
    async (property) => {
      const factory = freshFactory();
      const dbName = `hostile-connection-${property}`;
      const seed = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
      await seed.set('seed', 'value');
      await seed.dispose();
      const cause = new Error(`hostile connection ${property} setter`);
      let intercepted = false;
      const hostileFactory = {
        open: (name: string, version?: number) => {
          const nativeRequest =
            version === undefined ? factory.open(name) : factory.open(name, version);
          if (intercepted) return nativeRequest;
          intercepted = true;
          return {
            get result(): IDBDatabase {
              const database = nativeRequest.result;
              return new Proxy(database, {
                get: (target, key) => {
                  if (key === 'close') return () => target.close();
                  return Reflect.get(target, key, target);
                },
                set: (target, key, value) => {
                  if (key === property) throw cause;
                  return Reflect.set(target, key, value, target);
                }
              });
            },
            get transaction(): IDBTransaction | null {
              return nativeRequest.transaction;
            },
            get error(): DOMException | null {
              return nativeRequest.error;
            },
            set onupgradeneeded(handler: (() => void) | null) {
              nativeRequest.onupgradeneeded = () => handler?.();
            },
            set onblocked(handler: (() => void) | null) {
              nativeRequest.onblocked = () => handler?.();
            },
            set onerror(handler: (() => void) | null) {
              nativeRequest.onerror = () => handler?.();
            },
            set onsuccess(handler: (() => void) | null) {
              nativeRequest.onsuccess = () => handler?.();
            }
          } as unknown as IDBOpenDBRequest;
        }
      } as unknown as IDBFactory;
      const store = indexedDb({ factory: hostileFactory, keyRange: IDBKeyRange, dbName });
      try {
        await expect(store.get('seed')).rejects.toMatchObject({
          code: 'BACKEND_UNAVAILABLE',
          backend: 'indexeddb',
          operation: 'indexeddb.open',
          cause
        });
        await expect(store.get('seed')).resolves.toBe('value');
      } finally {
        await store.dispose();
      }
    }
  );

  it('open 请求失败时归一为可读错误（而非裸 IDB 异常）', async () => {
    const failingFactory: IDBFactory = {
      open: () => {
        const listeners: Record<string, (() => void) | null> = { onerror: null };
        const request = {
          error: new DOMException('open failed', 'UnknownError'),
          get onerror() {
            return listeners.onerror;
          },
          set onerror(handler) {
            listeners.onerror = handler;
            queueMicrotask(() => handler?.());
          },
          set onupgradeneeded(_handler: unknown) {},
          set onblocked(_handler: unknown) {},
          set onsuccess(_handler: unknown) {}
        };
        return request as unknown as IDBOpenDBRequest;
      }
    } as unknown as IDBFactory;

    const store = indexedDb({ factory: failingFactory, dbName: 'x' });
    await expect(store.get('k')).rejects.toBeDefined();
  });

  it('open success result getter 异常会 settle 为 BACKEND_UNAVAILABLE', async () => {
    const cause = new Error('hostile open result getter');
    const hostileFactory = {
      open: () =>
        ({
          get result(): never {
            throw cause;
          },
          set onupgradeneeded(_handler: unknown) {},
          set onblocked(_handler: unknown) {},
          set onerror(_handler: unknown) {},
          set onsuccess(handler: (() => void) | null) {
            queueMicrotask(() => handler?.());
          }
        }) as unknown as IDBOpenDBRequest
    } as unknown as IDBFactory;
    const store = indexedDb({ factory: hostileFactory, dbName: 'hostile-open-result' });
    await expect(store.get('k')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'indexeddb',
      operation: 'indexeddb.open',
      cause
    });
  });

  it('upgrade result getter 异常会 abort 并 settle 为 BACKEND_UNAVAILABLE', async () => {
    const cause = new Error('hostile upgrade result getter');
    const hostileFactory = {
      open: () =>
        ({
          get result(): never {
            throw cause;
          },
          get transaction(): null {
            return null;
          },
          set onupgradeneeded(handler: (() => void) | null) {
            queueMicrotask(() => handler?.());
          },
          set onblocked(_handler: unknown) {},
          set onerror(_handler: unknown) {},
          set onsuccess(_handler: unknown) {}
        }) as unknown as IDBOpenDBRequest
    } as unknown as IDBFactory;
    const store = indexedDb({ factory: hostileFactory, dbName: 'hostile-upgrade-result' });
    await expect(store.get('k')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'indexeddb',
      operation: 'indexeddb.open',
      cause
    });
  });

  it.each(['onupgradeneeded', 'onblocked', 'onsuccess', 'onerror'] as const)(
    'open request %s setter 异常会 abort upgrade 并归一 open failure',
    async (property) => {
      const cause = new Error(`hostile open ${property} setter`);
      let abortCalls = 0;
      const transaction = {
        abort: () => {
          abortCalls += 1;
        }
      } as unknown as IDBTransaction;
      const hostileFactory = {
        open: () =>
          ({
            transaction,
            set onupgradeneeded(_handler: unknown) {
              if (property === 'onupgradeneeded') throw cause;
            },
            set onblocked(_handler: unknown) {
              if (property === 'onblocked') throw cause;
            },
            set onsuccess(_handler: unknown) {
              if (property === 'onsuccess') throw cause;
            },
            set onerror(_handler: unknown) {
              if (property === 'onerror') throw cause;
            }
          }) as unknown as IDBOpenDBRequest
      } as unknown as IDBFactory;
      const store = indexedDb({ factory: hostileFactory, dbName: `hostile-open-${property}` });
      await expect(store.get('key')).rejects.toMatchObject({
        code: 'BACKEND_UNAVAILABLE',
        backend: 'indexeddb',
        operation: 'indexeddb.open',
        cause
      });
      expect(abortCalls).toBe(1);
      await store.dispose();
    }
  );

  it('factory.open 同步抛错时也归一为 UNAVAILABLE', async () => {
    const cause = new DOMException('open threw', 'SecurityError');
    const throwingFactory = {
      open: () => {
        throw cause;
      }
    } as unknown as IDBFactory;
    const store = indexedDb({ factory: throwingFactory, dbName: 'sync-open-throw' });
    await expect(store.get('k')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      operation: 'indexeddb.open',
      cause
    });
  });

  it('dispose 在连接仍处于打开中途时等待其结果再关闭', async () => {
    const store = freshDb();
    const pendingGet = store.get('k');
    const disposePromise = store.dispose();
    await expect(pendingGet).rejects.toMatchObject({ code: 'STORE_DISPOSED' });
    await expect(disposePromise).resolves.toBeUndefined();
  });

  it('dispose 与异步 open 竞态时不会让操作复用已关闭连接', async () => {
    const factory = freshFactory();
    const dbName = 'dispose-open-race';
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    const pending = store.get('k');
    await store.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'STORE_DISPOSED' });
    await expect(store.get('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' });
  });

  it('versionchange close 抛错后仍清除 stale connection cache', async () => {
    const factory = freshFactory();
    const dbName = 'versionchange-hostile-close';
    const store = indexedDb({ factory, keyRange: IDBKeyRange, dbName });
    await store.set('before', 'value');
    const current = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const nextVersion = current.version + 1;
    current.close();

    const originalClose = IDBDatabase.prototype.close;
    let reportCloseAttempt!: (database: IDBDatabase) => void;
    const closeAttempted = new Promise<IDBDatabase>((resolve) => {
      reportCloseAttempt = resolve;
    });
    IDBDatabase.prototype.close = function (this: IDBDatabase): void {
      reportCloseAttempt(this);
      throw new Error('hostile versionchange close');
    };
    const upgrade = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName, nextVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const staleDatabase = await closeAttempted;
      IDBDatabase.prototype.close = originalClose;
      staleDatabase.close();
      const upgraded = await upgrade;
      upgraded.close();
      await expect(store.set('after', 'reopened')).resolves.toBeUndefined();
      await expect(store.get('after')).resolves.toBe('reopened');
    } finally {
      IDBDatabase.prototype.close = originalClose;
      await store.dispose();
    }
  });

  it('自动生成 key 在 crypto.randomUUID 不可用时回退到时间戳方案', async () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const store = freshDb();
      const key = await store.putRecord({ a: 1 });
      expect(typeof key).toBe('string');
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });

  it('transaction 作用域内 put 不传 key 时自动生成', async () => {
    const store = freshDb();
    let generatedKey: unknown;
    await store.transaction(async (tx) => {
      generatedKey = await tx.put({ v: 'auto' });
    });
    await expect(store.getRecord(generatedKey as never)).resolves.toEqual({ v: 'auto' });
  });

  it('iterate 在没有注入 keyRange 且传了 range 时抛 BACKEND_UNAVAILABLE', async () => {
    const store = indexedDb({ factory: freshFactory(), dbName: 'no-keyrange' });
    const iterator = store.iterateRecords({ lower: 1 });
    await expect(iterator.next()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });
});
