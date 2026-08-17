import { describe, expect, it } from 'vitest';
import { defineEntity } from '../../src/entity';
import { memoryStorage, localStorage } from '../../src/backends';
import { fakeWebStorage } from '../../src/testing/fake-web-storage';
import { StorageError, StorageErrorCode } from '../../src/types/errors';
import { composeRepositoryKey } from '../../src/entity/key';
import type { IStorageKey } from '../../src/types/context';

type IUser = { id: string; name: string; email: string };

const users = defineEntity<IUser>({ name: 'users', key: 'id' });

const backends = [
  { label: 'memory (structured)', create: () => memoryStorage() },
  {
    label: 'localStorage (KV-only)',
    create: () => localStorage({ namespace: 'entity-test', storage: fakeWebStorage() })
  }
] as const;

for (const { label, create } of backends) {
  describe(`repository over ${label}`, () => {
    it('put 后 get 返回同值', async () => {
      const repo = users.connect(create());
      await repo.put({ id: 'u1', name: 'Ada', email: 'ada@example.com' });
      await expect(repo.get('u1')).resolves.toEqual({
        id: 'u1',
        name: 'Ada',
        email: 'ada@example.com'
      });
    });

    it('put 返回 id', async () => {
      const repo = users.connect(create());
      await expect(repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })).resolves.toBe('u1');
    });

    it('repository operation context 每个字段只读取一次', async () => {
      const repo = users.connect(create());
      const controller = new AbortController();
      let reads = 0;
      await repo.put({ id: 'snapshot', name: 'Ada', email: 'ada@example.com' }, {
        get signal() {
          reads += 1;
          return controller.signal;
        },
        get timeoutMs() {
          reads += 1;
          return undefined;
        },
        get pageSize() {
          reads += 1;
          return 64;
        },
        get conflictPolicy() {
          reads += 1;
          return 'replace' as const;
        }
      } as never);
      expect(reads).toBe(4);
    });

    it('get 未写入的 id 返回 undefined', async () => {
      const repo = users.connect(create());
      await expect(repo.get('missing')).resolves.toBeUndefined();
    });

    it('put 缺少 key 属性时抛稳定 StorageError', async () => {
      const repo = users.connect(create());
      await expect(repo.put({ name: 'Ada' } as unknown as IUser)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      });
    });

    it('remove 后 get 返回 undefined', async () => {
      const repo = users.connect(create());
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
      await repo.remove('u1');
      await expect(repo.get('u1')).resolves.toBeUndefined();
    });

    it('list 返回全部记录', async () => {
      const repo = users.connect(create());
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' });
      const all = await repo.list();
      expect(all).toHaveLength(2);
      expect(all.map((u) => u.id).sort()).toEqual(['u1', 'u2']);
    });

    it('list 支持 limit', async () => {
      const repo = users.connect(create());
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' });
      await repo.put({ id: 'u3', name: 'Cy', email: 'c@d.e' });
      const limited = await repo.list({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('stream 接受查询 options 并在流式路径应用 limit', async () => {
      const repo = users.connect(create());
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' });
      const streamed: IUser[] = [];
      for await (const user of repo.stream({ limit: 1 })) streamed.push(user);
      expect(streamed).toHaveLength(1);
    });

    it('stream 应用 orderBy 后再应用 limit', async () => {
      const repo = users.connect(create());
      await repo.put({ id: 'a', name: 'Ada', email: 'a@b.c' });
      await repo.put({ id: 'b', name: 'Bob', email: 'b@c.d' });
      const streamed: IUser[] = [];
      for await (const user of repo.stream({
        orderBy: (left, right) => right.name.localeCompare(left.name),
        limit: 1
      }))
        streamed.push(user);
      expect(streamed.map((user) => user.name)).toEqual(['Bob']);
    });

    it('KV list 按主键排序并在排序后应用 limit/range', async () => {
      const repo = users.connect(create());
      await repo.put({ id: 'c', name: 'C', email: 'c@d.e' });
      await repo.put({ id: 'a', name: 'A', email: 'a@b.c' });
      await repo.put({ id: 'b', name: 'B', email: 'b@c.d' });
      await expect(
        repo.list({ range: { lower: 'a', upper: 'c', upperOpen: true }, limit: 1 })
      ).resolves.toEqual([{ id: 'a', name: 'A', email: 'a@b.c' }]);
    });

    it('stream 逐条产出全部记录', async () => {
      const repo = users.connect(create());
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' });
      const seen: string[] = [];
      for await (const user of repo.stream()) seen.push(user.id);
      expect(seen.sort()).toEqual(['u1', 'u2']);
    });

    it('list/stream 不会读到其他 entity 的记录', async () => {
      const store = create();
      const posts = defineEntity<{ id: string; title: string }>({ name: 'posts', key: 'id' });
      const userRepo = users.connect(store);
      const postRepo = posts.connect(store);
      await userRepo.put({ id: 'shared-id', name: 'Ada', email: 'a@b.c' });
      await postRepo.put({ id: 'shared-id', title: 'Hello' });
      await expect(userRepo.list()).resolves.toEqual([
        { id: 'shared-id', name: 'Ada', email: 'a@b.c' }
      ]);
      await expect(postRepo.list()).resolves.toEqual([{ id: 'shared-id', title: 'Hello' }]);
    });
  });
}

describe('KV-only scan diagnostics', () => {
  it('KV-only list/stream 触发一次 diagnostic 告警', async () => {
    const diagnosed: string[] = [];
    const diagnosedEntity = defineEntity<IUser>({
      name: 'users-diag',
      key: 'id',
      onDiagnostic: (message) => diagnosed.push(message)
    });
    const repo = diagnosedEntity.connect(
      localStorage({ namespace: 'diag-test', storage: fakeWebStorage() })
    );
    await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
    await repo.list();
    expect(diagnosed).toHaveLength(1);
    expect(diagnosed[0]).toContain('full key scan');
  });

  it('结构化后端上 list/stream 不触发 diagnostic', async () => {
    const diagnosed: string[] = [];
    const diagnosedEntity = defineEntity<IUser>({
      name: 'users-diag-structured',
      key: 'id',
      onDiagnostic: (message) => diagnosed.push(message)
    });
    const repo = diagnosedEntity.connect(memoryStorage());
    await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
    await repo.list();
    expect(diagnosed).toHaveLength(0);
  });

  it('KV-only diagnostic 抛错不阻断 list', async () => {
    const entity = defineEntity<IUser>({
      name: 'users-diag-throw',
      key: 'id',
      onDiagnostic: () => {
        throw new Error('diagnostic sink failed');
      }
    });
    const repo = entity.connect(
      localStorage({ namespace: 'diag-throw-test', storage: fakeWebStorage() })
    );
    await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
    await expect(repo.list()).resolves.toEqual([{ id: 'u1', name: 'Ada', email: 'a@b.c' }]);
  });
});

describe('查询排序与无效记录策略', () => {
  it('comparator 异常统一为 EXTENSION_FAILED', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'order-error', key: 'id' }).connect(
      memoryStorage()
    );
    await repo.put({ id: 'a' });
    await repo.put({ id: 'b' });
    const comparator = () => {
      throw new Error('comparator failure');
    };
    await expect(repo.list({ orderBy: comparator })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.orderBy',
      extensionStage: 'comparator'
    });
    await expect(
      (async () => {
        for await (const value of repo.stream({ orderBy: comparator })) void value;
      })()
    ).rejects.toMatchObject({ code: 'EXTENSION_FAILED', extensionStage: 'comparator' });
  });

  it('comparator 返回非 number 时不静默强制转换', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'invalid-comparator', key: 'id' }).connect(
      memoryStorage()
    );
    await repo.put({ id: 'a' });
    await repo.put({ id: 'b' });
    await expect(repo.list({ orderBy: () => 'invalid' as never })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.orderBy',
      extensionStage: 'comparator'
    });
    await expect(repo.list({ orderBy: () => Number.NaN })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.orderBy',
      extensionStage: 'comparator'
    });
  });

  it('list/stream 不把显式 null orderBy 静默当成默认排序', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'null-order-by', key: 'id' }).connect(
      memoryStorage()
    );
    await expect(repo.list({ orderBy: null as never })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
    await expect(
      (async () => {
        for await (const value of repo.stream({ orderBy: null as never })) void value;
      })()
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('list/stream 拒绝 null、数组和 primitive range', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'invalid-range', key: 'id' }).connect(
      memoryStorage()
    );
    for (const range of [null, [], 'range', 1]) {
      await expect(repo.list({ range: range as never })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      });
      await expect(
        (async () => {
          for await (const value of repo.stream({ range: range as never })) void value;
        })()
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
  });

  it('list/stream 拒绝非 boolean range open flags', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'invalid-range-flags', key: 'id' }).connect(
      memoryStorage()
    );
    for (const range of [{ lowerOpen: 'yes' }, { upperOpen: 1 }]) {
      await expect(repo.list({ range: range as never })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      });
      await expect(
        (async () => {
          for await (const value of repo.stream({ range: range as never })) void value;
        })()
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
  });

  it('list/stream 拒绝 null、数组和 primitive options', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'invalid-list-options', key: 'id' }).connect(
      memoryStorage()
    );
    for (const options of [null, [], 'options', 1]) {
      await expect(repo.list(options as never)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
      await expect(
        (async () => {
          for await (const value of repo.stream(options as never)) void value;
        })()
      ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    }
  });

  it('list/stream/migrate 在没有坏记录时也拒绝非法 onInvalid', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'invalid-on-invalid', key: 'id' }).connect(
      memoryStorage()
    );
    for (const onInvalid of [null, [], 'invalid', 1]) {
      await expect(repo.list({ onInvalid: onInvalid as never })).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      });
      expect(() => repo.stream({ onInvalid: onInvalid as never })).toThrowError(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      );
      await expect(repo.migrate({ onInvalid: onInvalid as never })).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      });
    }
  });

  it('list 支持单次 orderBy 覆盖默认顺序并在排序后 limit', async () => {
    const entity = defineEntity<IUser>({
      name: 'ordered-users',
      key: 'id',
      defaultOrderBy: (left, right) => right.name.localeCompare(left.name)
    });
    const repo = entity.connect(memoryStorage());
    await repo.put({ id: 'a', name: 'Ada', email: 'a@b.c' });
    await repo.put({ id: 'b', name: 'Bob', email: 'b@c.d' });
    await expect(repo.list({ limit: 1 })).resolves.toEqual([
      { id: 'b', name: 'Bob', email: 'b@c.d' }
    ]);
    await expect(
      repo.list({ orderBy: (left, right) => left.id.localeCompare(right.id) })
    ).resolves.toEqual([
      { id: 'a', name: 'Ada', email: 'a@b.c' },
      { id: 'b', name: 'Bob', email: 'b@c.d' }
    ]);
  });

  it('onInvalid throw 策略让坏记录终止查询', async () => {
    const entity = defineEntity<{ id: string; n: number }>({
      name: 'strict-users',
      key: 'id',
      schema: {
        name: 'strict',
        validate: async (value: { id: string; n: unknown }) => {
          const typedValue = value;
          if (typeof typedValue.n !== 'number') throw new Error('invalid n');
          return typedValue as { id: string; n: number };
        }
      }
    });
    const repo = entity.connect(memoryStorage());
    await repo.put({ id: 'good', n: 1 });
    const rawStore = memoryStorage();
    await rawStore.putRecord({ __v: 1, data: { id: 'bad', n: 'x' } }, ['strict-users', 'bad']);
    const strictRepo = entity.connect(rawStore);
    await expect(strictRepo.get('bad')).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema',
      cause: { message: 'invalid n' }
    });
    await expect(strictRepo.list({ onInvalid: 'throw' })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema',
      cause: { message: 'invalid n' }
    });
  });
});

describe('自定义 schema（normalize/encode/decode 全链路）', () => {
  it('schema 扩展 raw throw 统一为 EXTENSION_FAILED', async () => {
    const entity = defineEntity<{ id: string }>({
      name: 'schema-extension-error',
      key: 'id',
      schema: {
        name: 'throws',
        validate: async () => {
          throw new Error('schema failure');
        }
      }
    });
    await expect(entity.connect(memoryStorage()).put({ id: 'x' })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema'
    });

    const rawStore = memoryStorage();
    await rawStore.putRecord({ __v: 1, data: { id: 'x' } }, ['schema-extension-error', 'x']);
    const readRepo = entity.connect(rawStore);
    await expect(readRepo.get('x')).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema'
    });
    await expect(readRepo.list({ onInvalid: 'throw' })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema'
    });
  });

  it('schema 主动抛 StorageError 时保留 code 并补齐扩展上下文', async () => {
    const entity = defineEntity<{ id: string }>({
      name: 'schema-storage-error-context',
      key: 'id',
      schema: {
        name: 'throws-storage-error',
        validate: async () => {
          throw new StorageError(StorageErrorCode.invalidConfig);
        }
      }
    });
    const store = memoryStorage();
    await store.putRecord({ __v: 1, data: { id: 'u1' } }, ['schema-storage-error-context', 'u1']);
    await expect(entity.connect(store).get('u1')).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      operation: 'entity.schema.validate',
      extensionStage: 'schema'
    });
  });

  it('读取可关闭 validate，并拒绝畸形 envelope', async () => {
    const unchecked = defineEntity<{ id: string }>({
      name: 'unchecked-read',
      key: 'id',
      validateOnRead: false,
      schema: {
        name: 'unchecked',
        validate: async () => {
          throw new Error('must not run on read');
        }
      }
    });
    const store = memoryStorage();
    await store.putRecord({ __v: 1, data: { id: 'ok' } }, ['unchecked-read', 'ok']);
    await expect(unchecked.connect(store).get('ok')).resolves.toEqual({ id: 'ok' });

    const malformed = memoryStorage();
    await malformed.putRecord({ broken: true }, ['unchecked-read', 'broken']);
    await expect(unchecked.connect(malformed).get('broken')).rejects.toMatchObject({
      code: 'DESERIALIZE_FAILED'
    });
  });

  it('KV-only repository supports list, stream limit, put and remove', async () => {
    const repo = users.connect(
      localStorage({ namespace: 'kv-only-extra', storage: fakeWebStorage() })
    );
    await repo.put({ id: 'a', name: 'Ada', email: 'a@example.com' });
    await repo.put({ id: 'b', name: 'Bob', email: 'b@example.com' });
    await expect(
      repo.list({ orderBy: (left, right) => right.id.localeCompare(left.id), limit: 1 })
    ).resolves.toEqual([{ id: 'b', name: 'Bob', email: 'b@example.com' }]);
    const streamed: IUser[] = [];
    for await (const value of repo.stream({ limit: 1 })) streamed.push(value);
    expect(streamed).toHaveLength(1);
    await repo.remove('a');
    await expect(repo.get('a')).resolves.toBeUndefined();
  });

  type IRawUser = { id: string; createdAt: string };
  type IDomainUser = { id: string; createdAt: Date };

  const withSchema = defineEntity<IDomainUser, IRawUser>({
    name: 'users-schema',
    key: 'id',
    schema: {
      name: 'test-schema',
      validate: async (value) => value as IDomainUser,
      normalize: async (value) => ({ ...value, id: value.id.toLowerCase() }),
      encode: async (value) => ({ id: value.id, createdAt: value.createdAt.toISOString() }),
      decode: async (stored) => ({ id: stored.id, createdAt: new Date(stored.createdAt) })
    }
  });

  it('put 经 normalize+encode，get 经 decode，往返值语义一致', async () => {
    const repo = withSchema.connect(memoryStorage());
    const createdAt = new Date('2024-01-01T00:00:00.000Z');
    await repo.put({ id: 'u1', createdAt });
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', createdAt });
  });

  it('normalize 修改主键时以规范化后的主键写入', async () => {
    const repo = withSchema.connect(memoryStorage());
    await expect(
      repo.put({ id: 'ABC', createdAt: new Date('2024-01-01T00:00:00.000Z') })
    ).resolves.toBe('abc');
    await expect(repo.get('ABC')).resolves.toBeUndefined();
    await expect(repo.get('abc')).resolves.toEqual({
      id: 'abc',
      createdAt: new Date('2024-01-01T00:00:00.000Z')
    });
  });

  it('list/stream 同样经过 schema.decode', async () => {
    const repo = withSchema.connect(memoryStorage());
    const createdAt = new Date('2024-01-01T00:00:00.000Z');
    await repo.put({ id: 'u1', createdAt });
    const all = await repo.list();
    expect(all).toEqual([{ id: 'u1', createdAt }]);
  });
});

describe('结构化后端上的自定义 repository codec', () => {
  it('codec raw throw 统一为 EXTENSION_FAILED', async () => {
    const entity = defineEntity<{ id: string }>({
      name: 'codec-extension-error',
      key: 'id',
      codec: {
        name: 'throws',
        output: 'structured',
        encode: async () => {
          throw new Error('codec failure');
        },
        decode: async (value) => value
      }
    });
    await expect(entity.connect(memoryStorage()).put({ id: 'x' })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.codec.encode',
      extensionStage: 'codec'
    });
  });

  it('put/get 都经过显式 codec，而不是绕过 codec 直存 envelope', async () => {
    let encodeCount = 0;
    let decodeCount = 0;
    const entity = defineEntity<{ id: string; value: number }>({
      name: 'structured-codec-users',
      key: 'id',
      codec: {
        name: 'counting-structured',
        output: 'structured',
        encode: async (value) => {
          encodeCount += 1;
          const envelope = value as { __v: number; data: { id: string; value: number } };
          return { ...envelope, data: { ...envelope.data, encoded: true } };
        },
        decode: async (value) => {
          decodeCount += 1;
          const envelope = value as {
            __v: number;
            data: { id: string; value: number; encoded: boolean };
          };
          const stored = envelope.data;
          expect(stored.encoded).toBe(true);
          return { ...envelope, data: { id: stored.id, value: stored.value } };
        }
      }
    });
    const repo = entity.connect(memoryStorage());

    await repo.put({ id: 'u1', value: 7 });
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', value: 7 });
    expect(encodeCount).toBe(1);
    expect(decodeCount).toBe(1);
  });
});

describe('list 显式 range', () => {
  it('结构化后端上 list 支持显式 range，且不会逃逸到其他 entity', async () => {
    const store = memoryStorage();
    const posts = defineEntity<{ id: string; title: string }>({ name: 'posts-range', key: 'id' });
    const rangedUsers = defineEntity<IUser>({ name: 'users-range', key: 'id' });
    const userRepo = rangedUsers.connect(store);
    const postRepo = posts.connect(store);
    await userRepo.put({ id: 'a', name: 'Ada', email: 'a@b.c' });
    await userRepo.put({ id: 'm', name: 'Mid', email: 'm@b.c' });
    await userRepo.put({ id: 'z', name: 'Zed', email: 'z@b.c' });
    await postRepo.put({ id: 'a', title: 'should not leak' });

    const results = await userRepo.list({ range: { lower: 'b', upper: 'z', upperOpen: true } });
    expect(results.map((u) => u.id).sort()).toEqual(['m']);
  });
});

describe('版本迁移', () => {
  it('读取未来 envelope version 时明确失败', async () => {
    const store = memoryStorage();
    await store.putRecord({ __v: 2, data: { id: 'u1', name: 'Ada' } }, ['future-users', 'u1']);
    const repo = defineEntity<{ id: string; name: string }>({
      name: 'future-users',
      key: 'id'
    }).connect(store);
    await expect(repo.get('u1')).rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' });
    await expect(repo.list({ onInvalid: 'skip' })).resolves.toEqual([]);
    await expect(repo.list({ onInvalid: 'throw' })).rejects.toMatchObject({
      code: 'VERSION_UNSUPPORTED'
    });
  });

  it('拒绝超出 safe integer 的 envelope version', async () => {
    const store = memoryStorage();
    await store.putRecord({ __v: 1, data: { id: 'u1' } }, ['unsafe-envelope-version', 'u1']);
    const repo = defineEntity<{ id: string }>({
      name: 'unsafe-envelope-version',
      key: 'id',
      codec: {
        name: 'unsafe-envelope',
        output: 'structured',
        encode: async (value) => value,
        decode: async () => ({ __v: Number.MAX_SAFE_INTEGER + 1, data: { id: 'u1' } })
      }
    }).connect(store);
    await expect(repo.get('u1')).rejects.toMatchObject({ code: 'DESERIALIZE_FAILED' });
  });

  it('KV-only 后端上读取旧版本记录时执行迁移但不隐式写回', async () => {
    const store = localStorage({ namespace: 'migrate-test', storage: fakeWebStorage() });
    const v1 = defineEntity<{ id: string; name: string }>({
      name: 'people',
      key: 'id',
      version: 1
    });
    await v1.connect(store).put({ id: 'u1', name: 'Ada' });

    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'people',
      key: 'id',
      version: 2,
      migrations: { 2: async (prev: any) => ({ id: prev.id, displayName: prev.name }) }
    });
    const repo = v2.connect(store);
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' });
  });

  it('显式 migrate 才持久化新版本并返回统计', async () => {
    const store = memoryStorage();
    const v1 = defineEntity<{ id: string; name: string }>({ name: 'explicit-migrate', key: 'id' });
    await v1.connect(store).put({ id: 'u1', name: 'Ada' });
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'explicit-migrate',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    });
    await expect(v2.connect(store).migrate({ batchSize: 1 })).resolves.toEqual({
      scanned: 1,
      eligible: 1,
      migrated: 1,
      alreadyCurrent: 0,
      skipped: 0,
      conflicted: 0
    });
    await expect(
      store.getRecord(composeRepositoryKey('explicit-migrate', 'u1'))
    ).resolves.toMatchObject({
      __v: 2
    });
  });

  it('migrate 不把显式 null batchSize 静默当成默认值', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'null-batch-size', key: 'id' }).connect(
      memoryStorage()
    );
    await expect(repo.migrate({ batchSize: null as never })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
  });

  it('migrate 拒绝超出 safe integer 的 batchSize', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'unsafe-batch-size', key: 'id' }).connect(
      memoryStorage()
    );
    await expect(repo.migrate({ batchSize: Number.MAX_SAFE_INTEGER + 1 })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
  });

  it('migrate 对每个 options 字段只读取一次', async () => {
    const repo = defineEntity<{ id: string }>({
      name: 'migrate-options-snapshot',
      key: 'id'
    }).connect(memoryStorage());
    const reads = { batchSize: 0, onInvalid: 0 };
    await expect(
      repo.migrate({
        get batchSize() {
          reads.batchSize += 1;
          if (reads.batchSize > 1) throw new Error('batchSize read twice');
          return 1;
        },
        get onInvalid() {
          reads.onInvalid += 1;
          if (reads.onInvalid > 1) throw new Error('onInvalid read twice');
          return 'skip' as const;
        }
      })
    ).resolves.toMatchObject({ scanned: 0, migrated: 0 });
    expect(reads).toEqual({ batchSize: 1, onInvalid: 1 });
  });

  it('migrate 拒绝 null、数组和 primitive options', async () => {
    const repo = defineEntity<{ id: string }>({
      name: 'invalid-migrate-options',
      key: 'id'
    }).connect(memoryStorage());
    for (const options of [null, [], 'options', 1])
      await expect(repo.migrate(options as never)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      });
  });

  it('KV-only migrate 按批次写回新版本', async () => {
    const store = localStorage({ namespace: 'kv-migrate', storage: fakeWebStorage() });
    await defineEntity<{ id: string; name: string }>({ name: 'kv-people', key: 'id' })
      .connect(store)
      .put({ id: 'u1', name: 'Ada' });
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'kv-people',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    });
    await expect(v2.connect(store).migrate({ batchSize: 1 })).resolves.toMatchObject({
      eligible: 1,
      migrated: 1
    });
  });

  it('migrate 统计被跳过的坏记录', async () => {
    const store = memoryStorage();
    const entity = defineEntity<{ id: string; value: number }>({
      name: 'explicit-migrate-invalid',
      key: 'id',
      schema: {
        name: 'strict',
        validate: async (value: { id: string; value: number | string }) => {
          if (typeof value.value !== 'number') throw new Error('invalid value');
          return value as { id: string; value: number };
        }
      }
    });
    await store.putRecord({ __v: 1, data: { id: 'good', value: 1 } }, [
      'explicit-migrate-invalid',
      'good'
    ]);
    await store.putRecord({ __v: 1, data: { id: 'bad', value: 'x' } }, [
      'explicit-migrate-invalid',
      'bad'
    ]);
    await expect(entity.connect(store).migrate()).resolves.toMatchObject({
      scanned: 2,
      eligible: 0,
      migrated: 0,
      alreadyCurrent: 1,
      skipped: 1
    });
  });

  it('migrate 在 optimistic transaction 冲突时统计整批 conflicted', async () => {
    const source = memoryStorage();
    const v1 = defineEntity<{ id: string; name: string }>({
      name: 'explicit-migrate-conflict',
      key: 'id'
    });
    await v1.connect(source).put({ id: 'u1', name: 'Ada' });
    const conflictStore = {
      ...source,
      transaction: async () => {
        throw new StorageError(StorageErrorCode.transactionConflict, {
          backend: 'memory',
          operation: 'transaction.commit'
        });
      }
    };
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'explicit-migrate-conflict',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    });
    await expect(v2.connect(conflictStore).migrate({ batchSize: 1 })).resolves.toEqual({
      scanned: 1,
      eligible: 1,
      migrated: 0,
      alreadyCurrent: 0,
      skipped: 0,
      conflicted: 1
    });
  });

  it('migrate 归一化 backend transaction 的裸异常', async () => {
    const source = memoryStorage();
    await defineEntity<{ id: string; name: string }>({ name: 'raw-migrate-error', key: 'id' })
      .connect(source)
      .put({ id: 'u1', name: 'Ada' });
    const failingStore = {
      ...source,
      transaction: async () => {
        throw new Error('transaction exploded');
      }
    };
    const entity = defineEntity<{ id: string; displayName: string }>({
      name: 'raw-migrate-error',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    });
    await expect(entity.connect(failingStore).migrate()).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
      cause: { message: 'transaction exploded' }
    });
  });

  it('migrate 批冲突后逐条重试，避免整批跳过', async () => {
    const source = memoryStorage();
    const v1 = defineEntity<{ id: string; name: string }>({ name: 'retry-migrate', key: 'id' });
    await v1.connect(source).put({ id: 'u1', name: 'Ada' });
    let calls = 0;
    const retryStore = {
      ...source,
      transaction: async (run: any, ctx: any) => {
        calls += 1;
        if (calls === 1)
          throw new StorageError(StorageErrorCode.transactionConflict, {
            backend: 'memory',
            operation: 'transaction.commit'
          });
        return source.transaction(run, ctx);
      }
    };
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'retry-migrate',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    });
    await expect(v2.connect(retryStore).migrate({ batchSize: 1 })).resolves.toMatchObject({
      eligible: 1,
      migrated: 1,
      conflicted: 0
    });
  });

  it('migrate 冲突重试发现并发方已迁移时不虚报 migrated', async () => {
    const source = memoryStorage();
    const v1 = defineEntity<{ id: string; name: string }>({ name: 'retry-current', key: 'id' });
    await v1.connect(source).put({ id: 'u1', name: 'Ada' });
    let first = true;
    const retryStore = {
      ...source,
      transaction: async (run: any, ctx: any) => {
        if (first) {
          first = false;
          await source.transaction(async (tx) => {
            await tx.put(
              { __v: 2, data: { id: 'u1', displayName: 'Ada' } },
              composeRepositoryKey('retry-current', 'u1')
            );
            await tx.delete(['retry-current', 'u1']);
          }, ctx);
          throw new StorageError(StorageErrorCode.transactionConflict, {
            backend: 'memory',
            operation: 'transaction.commit'
          });
        }
        return source.transaction(run, ctx);
      }
    };
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'retry-current',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    });
    await expect(v2.connect(retryStore).migrate({ batchSize: 1 })).resolves.toMatchObject({
      migrated: 0,
      alreadyCurrent: 1,
      conflicted: 0
    });
  });

  it('迁移读取不触发隐式写回', async () => {
    const diagnosed: string[] = [];
    const inner = memoryStorage();
    const v1 = defineEntity<{ id: string; name: string }>({
      name: 'people2',
      key: 'id',
      version: 1
    });
    await v1.connect(inner).put({ id: 'u1', name: 'Ada' });

    // 读正常、写失败的包装 store：用 putCalls 证明读取路径没有尝试隐式写回。
    let putCalls = 0;
    const flakyStore = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'putRecord')
          return async () => {
            putCalls += 1;
            throw new Error('write-back boom');
          };
        return Reflect.get(target, prop, receiver);
      }
    });

    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'people2',
      key: 'id',
      version: 2,
      migrations: { 2: async (prev: any) => ({ id: prev.id, displayName: prev.name }) },
      onDiagnostic: (message) => diagnosed.push(message)
    });
    const repo = v2.connect(flakyStore);
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' });
    expect(putCalls).toBe(0);
    expect(diagnosed).toHaveLength(0);
  });

  it('迁移读取不触发非 Error 写回异常', async () => {
    const diagnosed: string[] = [];
    const inner = memoryStorage();
    const v1 = defineEntity<{ id: string; name: string }>({
      name: 'people3',
      key: 'id',
      version: 1
    });
    await v1.connect(inner).put({ id: 'u1', name: 'Ada' });

    const flakyStore = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'putRecord')
          return async () => {
            // eslint-disable-next-line @typescript-eslint/no-throw-literal
            throw 'boom-string-cause';
          };
        return Reflect.get(target, prop, receiver);
      }
    });

    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'people3',
      key: 'id',
      version: 2,
      migrations: { 2: async (prev: any) => ({ id: prev.id, displayName: prev.name }) },
      onDiagnostic: (message) => diagnosed.push(message)
    });
    const repo = v2.connect(flakyStore);
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' });
    expect(diagnosed).toHaveLength(0);
  });

  it('batch 作用域内 get 读到旧版本记录时触发迁移，但事务内不写回（writeBackTarget 为 undefined）', async () => {
    const store = memoryStorage();
    const v1 = defineEntity<{ id: string; name: string }>({
      name: 'people4',
      key: 'id',
      version: 1
    });
    await v1.connect(store).put({ id: 'u1', name: 'Ada' });

    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'people4',
      key: 'id',
      version: 2,
      migrations: { 2: async (prev: any) => ({ id: prev.id, displayName: prev.name }) }
    });
    const repo = v2.connect(store);
    let seen: { id: string; displayName: string } | undefined;
    await repo.batch(async (tx) => {
      seen = await tx.get('u1');
    });
    expect(seen).toEqual({ id: 'u1', displayName: 'Ada' });
  });
});

describe('batch', () => {
  it('batch 拒绝非函数 callback', async () => {
    const repo = users.connect(memoryStorage());
    for (const callback of [null, undefined, {}, 'run'])
      await expect(repo.batch(callback as never)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      });
  });

  it('结构化后端上 batch 成功后所有写入持久化', async () => {
    const repo = users.connect(memoryStorage());
    await repo.batch(async (tx) => {
      await tx.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
      await tx.put({ id: 'u2', name: 'Bob', email: 'b@c.d' });
    });
    await expect(repo.get('u1')).resolves.toBeDefined();
    await expect(repo.get('u2')).resolves.toBeDefined();
  });

  it('batch put 使用 normalize 后的主键', async () => {
    const batchEntity = defineEntity<{ id: string; createdAt: Date }>({
      name: 'batch-normalized',
      key: 'id',
      schema: {
        name: 'batch-normalized-schema',
        validate: async (value) => value as { id: string; createdAt: Date },
        normalize: async (value) => ({ ...value, id: value.id.toLowerCase() })
      }
    });
    const repo = batchEntity.connect(memoryStorage());
    await repo.batch(async (tx) => {
      await expect(
        tx.put({ id: 'BATCH-ABC', createdAt: new Date('2024-01-01T00:00:00.000Z') })
      ).resolves.toBe('batch-abc');
    });
    await expect(repo.get('BATCH-ABC')).resolves.toBeUndefined();
    await expect(repo.get('batch-abc')).resolves.toBeDefined();
  });

  it('结构化后端上 batch 内抛错时整批回滚', async () => {
    const repo = users.connect(memoryStorage());
    await repo.put({ id: 'existing', name: 'Old', email: 'old@x.y' });
    await expect(
      repo.batch(async (tx) => {
        await tx.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
        await tx.remove('existing');
        throw new Error('boom');
      })
    ).rejects.toThrow();
    await expect(repo.get('u1')).resolves.toBeUndefined();
    await expect(repo.get('existing')).resolves.toEqual({
      id: 'existing',
      name: 'Old',
      email: 'old@x.y'
    });
  });

  it('batch 作用域内 get 可读取快照内已写入的值', async () => {
    const repo = users.connect(memoryStorage());
    await repo.batch(async (tx) => {
      await tx.put({ id: 'u1', name: 'Ada', email: 'a@b.c' });
      await expect(tx.get('u1')).resolves.toEqual({ id: 'u1', name: 'Ada', email: 'a@b.c' });
      await expect(tx.get('missing')).resolves.toBeUndefined();
    });
  });

  it('KV-only 后端上 batch 抛 UNSUPPORTED_CAPABILITY', async () => {
    const repo = users.connect(
      localStorage({ namespace: 'batch-test', storage: fakeWebStorage() })
    );
    await expect(repo.batch(async () => {})).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY'
    });
  });
});

describe('entity key and invalid-record boundaries', () => {
  it('accepts supported key domains and rejects invalid keys', async () => {
    const entity = defineEntity<{ id: IStorageKey; value: string }>({
      name: 'key-domains',
      key: 'id'
    });
    const repo = entity.connect(memoryStorage());
    for (const id of [
      1,
      new Date('2024-01-01T00:00:00Z'),
      new Uint8Array([1]).buffer,
      ['tenant', ['user']]
    ] as IStorageKey[]) {
      await repo.put({ id, value: 'ok' });
      await expect(repo.get(id)).resolves.toMatchObject({ value: 'ok' });
    }
    for (const id of [true, NaN, new Date('invalid'), { id: 'bad' }] as unknown[]) {
      await expect(repo.put({ id, value: 'bad' } as never)).rejects.toMatchObject({
        code: 'INVALID_KEY'
      });
    }
  });

  it('batch() 内的 tx.get()/tx.remove() 对非法 key 报的错误码要跟顶层 get()/remove() 一致', async () => {
    // 顶层 get()/remove() 在进入 key composition 前先 assertStorageKey；batch() 作用域内的
    // scope.get/scope.remove 曾经跳过这一步，让同一个非法输入在 batch 里被误分类成
    // TRANSACTION_FAILED（暗示"可重试"）而不是 INVALID_KEY（永久性、重试无意义）。
    const repo = defineEntity<{ id: IStorageKey; value: string }>({
      name: 'batch-key-guard',
      key: 'id'
    }).connect(memoryStorage());
    for (const id of [true, {}, 42n] as unknown[]) {
      await expect(repo.batch((tx) => tx.get(id as IStorageKey))).rejects.toMatchObject({
        code: 'INVALID_KEY'
      });
      await expect(repo.batch((tx) => tx.remove(id as IStorageKey))).rejects.toMatchObject({
        code: 'INVALID_KEY'
      });
    }
  });

  it('rejects invalid list limits before reading', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'limit-guard', key: 'id' }).connect(
      memoryStorage()
    );
    for (const limit of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await expect(repo.list({ limit })).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    await expect(repo.list({ limit: 0 })).resolves.toEqual([]);
  });

  it('list 与 stream 对每个 options 字段只读取一次', async () => {
    const repo = defineEntity<{ id: string }>({ name: 'list-options-snapshot', key: 'id' }).connect(
      memoryStorage()
    );
    await repo.put({ id: 'a' });
    const createOptions = () => {
      const reads = { range: 0, limit: 0, orderBy: 0, onInvalid: 0 };
      const options = {
        get range() {
          reads.range += 1;
          if (reads.range > 1) throw new Error('range read twice');
          return { lower: 'a', upper: 'z' };
        },
        get limit() {
          reads.limit += 1;
          if (reads.limit > 1) throw new Error('limit read twice');
          return 1;
        },
        get orderBy() {
          reads.orderBy += 1;
          if (reads.orderBy > 1) throw new Error('orderBy read twice');
          return undefined;
        },
        get onInvalid() {
          reads.onInvalid += 1;
          if (reads.onInvalid > 1) throw new Error('onInvalid read twice');
          return 'throw' as const;
        }
      };
      return { options, reads };
    };
    const listed = createOptions();
    await expect(repo.list(listed.options)).resolves.toEqual([{ id: 'a' }]);
    expect(listed.reads).toEqual({ range: 1, limit: 1, orderBy: 1, onInvalid: 1 });
    const streamed = createOptions();
    const values: Array<{ id: string }> = [];
    for await (const value of repo.stream(streamed.options)) values.push(value);
    expect(values).toEqual([{ id: 'a' }]);
    expect(streamed.reads).toEqual({ range: 1, limit: 1, orderBy: 1, onInvalid: 1 });
  });

  it('handler can skip an invalid KV record and reports its decoded key', async () => {
    const entity = defineEntity<{ id: string; n: number }>({
      name: 'handler-users',
      key: 'id',
      schema: {
        name: 'handler',
        validate: async (value) => {
          if (typeof (value as { n: unknown }).n !== 'number') throw new Error('bad');
          return value as { id: string; n: number };
        }
      }
    });
    const store = localStorage({ namespace: 'handler-users', storage: fakeWebStorage() });
    const repo = entity.connect(store);
    await repo.put({ id: 'good', n: 1 });
    await store.set(
      'handler-users:k:%5B%22s%22%2C%22bad%22%5D',
      JSON.stringify({ __v: 1, data: { id: 'bad', n: 'x' } })
    );
    const issues: IStorageKey[] = [];
    await expect(
      repo.list({
        onInvalid: (issue) => {
          issues.push(issue.key);
          return 'skip';
        }
      })
    ).resolves.toHaveLength(1);
    expect(issues).toEqual(['bad']);
  });

  it('onInvalid.stage 区分 decode 与 validate', async () => {
    const store = memoryStorage();
    const decodeEntity = defineEntity<{ id: string; n: number }>({
      name: 'stage-users',
      key: 'id',
      codec: {
        name: 'throws-decode',
        output: 'structured',
        encode: async (value) => value,
        decode: async () => {
          throw new Error('decode failure');
        }
      },
      schema: {
        name: 'stage-schema',
        validate: async (value) => value as { id: string; n: number }
      }
    });
    await store.putRecord({ __v: 1, data: { id: 'bad', n: 1 } }, ['stage-users', 'bad']);
    const stages: string[] = [];
    await decodeEntity.connect(store).list({
      onInvalid: (issue) => {
        stages.push(issue.stage);
        return 'skip';
      }
    });
    expect(stages).toEqual(['decode']);
  });

  it('rejects an invalid onInvalid policy or handler result', async () => {
    const store = memoryStorage();
    const entity = defineEntity<{ id: string; n: number }>({
      name: 'invalid-policy-users',
      key: 'id',
      codec: {
        name: 'invalid-policy-codec',
        output: 'structured',
        encode: async (value) => value,
        decode: async () => ({ invalid: true })
      }
    });
    await store.putRecord({ __v: 1, data: { id: 'bad', n: 1 } }, ['invalid-policy-users', 'bad']);
    await expect(
      entity.connect(store).list({ onInvalid: 'invalid' as never })
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    });
    await expect(
      entity.connect(store).list({ onInvalid: () => 'invalid' as never })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('onInvalid.stage 区分 migration failure', async () => {
    const store = memoryStorage();
    const entity = defineEntity<{ id: string; n: number }>({
      name: 'migration-stage-users',
      key: 'id',
      version: 2,
      migrations: {
        2: async () => {
          throw new Error('migration failure');
        }
      },
      schema: {
        name: 'migration-stage',
        validate: async (value) => value as { id: string; n: number }
      }
    });
    await store.putRecord({ __v: 1, data: { id: 'bad', n: 1 } }, ['migration-stage-users', 'bad']);
    const stages: string[] = [];
    await entity.connect(store).list({
      onInvalid: (issue) => {
        stages.push(issue.stage);
        return 'skip';
      }
    });
    expect(stages).toEqual(['migrate']);
  });
});
