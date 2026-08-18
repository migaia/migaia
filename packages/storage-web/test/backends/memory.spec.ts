import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../../src/backends/memory';

describe('memoryStorage', () => {
  it('自动生成 key 即使随机源重复也不会覆盖已有 record', async () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => 'fixed-auto-key' }
    });
    try {
      const store = memoryStorage();
      const first = await store.putRecord({ value: 1 });
      const second = await store.putRecord({ value: 2 });
      expect(second).not.toEqual(first);
      await expect(store.getRecord(first)).resolves.toEqual({ value: 1 });
      await expect(store.getRecord(second)).resolves.toEqual({ value: 2 });
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    }
  });
  it('在无冲突写入路径也拒绝非法 conflictPolicy', async () => {
    const store = memoryStorage();
    await expect(
      store.set('key', 'value', { conflictPolicy: 'invalid' as never })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    });
  });

  it('拒绝运行时非字符串 value', async () => {
    const store = memoryStorage();
    expect(() => store.sync!.set('key', 42 as unknown as string)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    );
    await expect(store.set('key', 42 as unknown as string)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
  });
  it('L0 与 bytes 通道拒绝运行时非字符串 key', async () => {
    const store = memoryStorage();
    const invalidKey = 42 as unknown as string;
    for (const invoke of [
      () => store.get(invalidKey),
      () => store.set(invalidKey, 'value'),
      () => store.remove(invalidKey),
      () => store.has(invalidKey),
      () => store.getBytes(invalidKey),
      () => store.setBytes(invalidKey, new Uint8Array([1]))
    ])
      await expect(invoke()).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        backend: 'memory'
      });
    for (const invoke of [
      () => store.sync.get(invalidKey),
      () => store.sync.set(invalidKey, 'value'),
      () => store.sync.remove(invalidKey),
      () => store.sync.has(invalidKey)
    ])
      expect(invoke).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
  it('拒绝非 Uint8Array 的 bytes value', async () => {
    const store = memoryStorage();
    await expect(
      store.setBytes('key', new DataView(new ArrayBuffer(1)) as unknown as Uint8Array)
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
  });
  it('record replace 在 clone 失败时保留原 value 通道', async () => {
    const store = memoryStorage();
    await store.set('shared', 'original');
    await expect(
      store.putRecord({ uncloneable: () => {} }, 'shared', { conflictPolicy: 'replace' })
    ).rejects.toMatchObject({ code: 'SERIALIZE_FAILED', backend: 'memory' });
    await expect(store.get('shared')).resolves.toBe('original');
    await expect(store.getRecord('shared')).resolves.toBeUndefined();
  });
  it('bytes replace 在 detached buffer 复制失败时保留原 value 通道', async () => {
    const store = memoryStorage();
    await store.set('shared', 'original');
    const buffer = new ArrayBuffer(4);
    const detached = new Uint8Array(buffer);
    structuredClone(buffer, { transfer: [buffer] });
    await expect(
      store.setBytes('shared', detached, { conflictPolicy: 'replace' })
    ).rejects.toMatchObject({ code: 'SERIALIZE_FAILED', backend: 'memory' });
    await expect(store.get('shared')).resolves.toBe('original');
    await expect(store.getBytes('shared')).resolves.toBeNull();
  });

  it('optimistic transaction detects revision changed during await', async () => {
    const store = memoryStorage();
    await store.putRecord({ value: 0 }, 'revision-key');
    let release: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = store.transaction(async (tx) => {
      await tx.get('revision-key');
      await paused;
      await tx.put({ value: 1 }, 'revision-key');
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await store.putRecord({ value: 2 }, 'revision-key', { conflictPolicy: 'replace' });
    release!();
    await expect(first).rejects.toMatchObject({
      code: 'TRANSACTION_CONFLICT',
      operation: 'transaction.commit'
    });
    await expect(store.getRecord('revision-key')).resolves.toEqual({ value: 2 });
  });
  it('transaction reads a repeatable snapshot even when an external write commits', async () => {
    const store = memoryStorage();
    await store.putRecord({ value: 0 }, 'snapshot-key');
    let release: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = store.transaction(async (tx) => {
      await expect(tx.get('snapshot-key')).resolves.toEqual({ value: 0 });
      await paused;
      await expect(tx.get('snapshot-key')).resolves.toEqual({ value: 0 });
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await store.putRecord({ value: 1 }, 'snapshot-key', { conflictPolicy: 'replace' });
    release!();
    await expect(transaction).rejects.toMatchObject({ code: 'TRANSACTION_CONFLICT' });
  });
  it('clear and recreate cannot pass an old transaction revision check', async () => {
    const store = memoryStorage();
    await store.putRecord({ value: 0 }, 'aba-key');
    let release: (() => void) | undefined;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = store.transaction(async (tx) => {
      await tx.get('aba-key');
      await paused;
      await tx.put({ value: 2 }, 'aba-key');
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await store.clearRecords();
    await store.putRecord({ value: 1 }, 'aba-key');
    release!();
    await expect(transaction).rejects.toMatchObject({ code: 'TRANSACTION_CONFLICT' });
    await expect(store.getRecord('aba-key')).resolves.toEqual({ value: 1 });
  });
  it('transaction 进入同步 commit point 后不因 hostile signal 漂移留下半提交', async () => {
    const store = memoryStorage();
    let abortedReads = 0;
    const signal = {
      get aborted(): boolean {
        abortedReads += 1;
        return abortedReads >= 8;
      },
      reason: new Error('hostile late abort'),
      addEventListener: () => {},
      removeEventListener: () => {}
    } as unknown as AbortSignal;
    await expect(
      store.transaction(
        async (tx) => {
          await tx.put({ value: 1 }, 'first');
          await tx.put({ value: 2 }, 'second');
        },
        { signal }
      )
    ).resolves.toBeUndefined();
    await expect(store.getRecord('first')).resolves.toEqual({ value: 1 });
    await expect(store.getRecord('second')).resolves.toEqual({ value: 2 });
    expect(abortedReads).toBe(6);
  });
  it('backend 与 capabilities 正确声明', () => {
    const store = memoryStorage();
    expect(store.backend).toBe('memory');
    expect(store.capabilities.records).toBe(true);
    expect(store.capabilities.syncRead).toBe(true);
  });
  it('sync 通道全方法可用', () => {
    const store = memoryStorage();
    store.sync!.set('k', 'v');
    expect(store.sync!.get('k')).toBe('v');
    expect(store.sync!.has('k')).toBe(true);
    expect(store.sync!.keys()).toEqual(['k']);
    store.sync!.remove('k');
    expect(store.sync!.get('k')).toBeNull();
  });
  it('每个实例独立隔离', () => {
    const a = memoryStorage();
    const b = memoryStorage();
    a.sync!.set('k', 'a-value');
    expect(b.sync!.get('k')).toBeNull();
  });
  it('dispose 后 sync 方法也拒绝', async () => {
    const store = memoryStorage();
    await store.dispose();
    expect(() => store.sync!.get('k')).toThrow(expect.objectContaining({ code: 'STORE_DISPOSED' }));
  });
  it('iterate 按 range 的 lower/upper 边界过滤', async () => {
    const store = memoryStorage();
    await store.putRecord({ v: 1 }, 1);
    await store.putRecord({ v: 2 }, 2);
    await store.putRecord({ v: 3 }, 3);
    const collect = async (range: Parameters<typeof store.iterateRecords>[0]) => {
      const seen: unknown[] = [];
      for await (const [, value] of store.iterateRecords(range)) seen.push(value);
      return seen;
    };
    expect(await collect({ lower: 1, lowerOpen: true, upper: 3 })).toEqual([{ v: 2 }, { v: 3 }]);
    expect(await collect({ lower: 1, lowerOpen: false })).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
    expect(await collect({ upper: 2, upperOpen: true })).toEqual([{ v: 1 }]);
    expect(await collect({ upper: 2, upperOpen: false })).toEqual([{ v: 1 }, { v: 2 }]);
  });
  it('iterate 首次 yield 后修改复合 range 不影响剩余结果', async () => {
    const store = memoryStorage();
    await store.putRecord({ value: 1 }, ['tenant', 1]);
    await store.putRecord({ value: 2 }, ['tenant', 2]);
    await store.putRecord({ value: 3 }, ['tenant', 3]);
    const upper: Array<string | number> = ['tenant', 3];
    const iterator = store.iterateRecords({ upper });
    await expect(iterator.next()).resolves.toMatchObject({ value: [['tenant', 1], { value: 1 }] });
    upper[1] = 1;
    await expect(iterator.next()).resolves.toMatchObject({ value: [['tenant', 2], { value: 2 }] });
    await expect(iterator.next()).resolves.toMatchObject({ value: [['tenant', 3], { value: 3 }] });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });
  it('自动生成 key 在 crypto.randomUUID 不可用时回退', async () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const store = memoryStorage();
      const key = await store.putRecord({ a: 1 });
      expect(typeof key).toBe('string');
      await expect(store.getRecord(key)).resolves.toEqual({ a: 1 });
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
  it('transaction 作用域内 put 不传 key 时自动生成，get 可读取快照内的值', async () => {
    const store = memoryStorage();
    let generatedKey: unknown;
    await store.transaction(async (tx) => {
      generatedKey = await tx.put({ v: 'auto' });
      await expect(tx.get(generatedKey as never)).resolves.toEqual({ v: 'auto' });
    });
    await expect(store.getRecord(generatedKey as never)).resolves.toEqual({ v: 'auto' });
  });
  it('iterate 在 signal 已 abort 时抛 ABORTED', async () => {
    const store = memoryStorage();
    await store.putRecord({ v: 1 }, 'a');
    const controller = new AbortController();
    controller.abort();
    await expect(
      store.iterateRecords(undefined, { signal: controller.signal }).next()
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });
  it('dispose 后 getBytes/getRecord/iterate/transaction 均拒绝', async () => {
    const store = memoryStorage();
    await store.dispose();
    await expect(store.putRecord({ a: 1 })).rejects.toMatchObject({ code: 'STORE_DISPOSED' });
    await expect(store.setBytes('k', new Uint8Array())).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    });
    await expect(store.transaction(async () => {})).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    });
  });
  it('复合主键编码无碰撞且事务边界结构化克隆', async () => {
    const store = memoryStorage();
    await store.putRecord({ value: 'comma' }, ['a,b']);
    await store.putRecord({ value: 'split' }, ['a', 'b']);
    await expect(store.getRecord(['a,b'])).resolves.toEqual({ value: 'comma' });
    await expect(store.getRecord(['a', 'b'])).resolves.toEqual({ value: 'split' });
    const input = { nested: { value: 1 } };
    await store.transaction(async (tx) => {
      await tx.put(input, 'tx-clone');
      const read = await tx.get('tx-clone');
      (read as typeof input).nested.value = 9;
    });
    input.nested.value = 8;
    await expect(store.getRecord('tx-clone')).resolves.toEqual({ nested: { value: 1 } });
  });
  it('direct/transaction/iterate 均不泄漏复合 key 的可变引用', async () => {
    const store = memoryStorage();
    const directKey: (string | number)[] = ['direct', 1];
    await store.putRecord({ source: 'direct' }, directKey);
    directKey[1] = 9;

    const transactionKey: (string | number)[] = ['transaction', 1];
    await store.transaction(async (tx) => {
      await tx.put({ source: 'transaction' }, transactionKey);
      transactionKey[1] = 9;
    });

    const firstPass: unknown[] = [];
    for await (const [key] of store.iterateRecords()) firstPass.push(key);
    expect(firstPass).toEqual([
      ['direct', 1],
      ['transaction', 1]
    ]);
    (firstPass[0] as (string | number)[])[1] = 7;

    const secondPass: unknown[] = [];
    for await (const [key] of store.iterateRecords()) secondPass.push(key);
    expect(secondPass).toEqual([
      ['direct', 1],
      ['transaction', 1]
    ]);
    await expect(store.getRecord(['direct', 1])).resolves.toEqual({ source: 'direct' });
    await expect(store.getRecord(['transaction', 1])).resolves.toEqual({ source: 'transaction' });
    await expect(store.getRecord(['direct', 9])).resolves.toBeUndefined();
    await expect(store.getRecord(['transaction', 9])).resolves.toBeUndefined();

    const overriddenMapKey = ['overridden-map', 1] as (string | number)[];
    overriddenMapKey.map = (() => ['overridden-map', 2]) as typeof overriddenMapKey.map;
    await store.putRecord({ source: 'map-safe' }, overriddenMapKey);
    await expect(store.getRecord(['overridden-map', 1])).resolves.toEqual({
      source: 'map-safe'
    });
    await expect(store.getRecord(['overridden-map', 2])).resolves.toBeUndefined();
  });
});
