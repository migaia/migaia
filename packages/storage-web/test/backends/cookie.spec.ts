import { describe, expect, it } from 'vitest';
import { cookies } from '../../src/backends/cookie';
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document';

describe('cookies backend', () => {
  it('构造期拒绝 null、数组和 primitive options', () => {
    for (const options of [null, [], 'options', 1])
      expect(() => cookies(options as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      );
  });

  it('拒绝数组 cookie scope 配置', () => {
    expect(() =>
      cookies({ scope: [] as never, namespace: 'array-scope', document: fakeCookieDocument() })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('构造 options 与固定 scope 的每个字段只读取一次', async () => {
    const document = fakeCookieDocument();
    let optionReads = 0;
    let scopeReads = 0;
    const store = cookies({
      get namespace() {
        optionReads += 1;
        return 'constructor-snapshot';
      },
      get namespaceCodec() {
        optionReads += 1;
        return undefined;
      },
      get scope() {
        optionReads += 1;
        return {
          get path() {
            scopeReads += 1;
            return '/';
          },
          get domain() {
            scopeReads += 1;
            return undefined;
          },
          get sameSite() {
            scopeReads += 1;
            return 'lax' as const;
          },
          get secure() {
            scopeReads += 1;
            return false;
          },
          get partitioned() {
            scopeReads += 1;
            return false;
          }
        };
      },
      get document() {
        optionReads += 1;
        return document;
      }
    });
    await store.set('key', 'value');
    await store.remove('key');
    expect(optionReads).toBe(4);
    expect(scopeReads).toBe(5);
  });

  it('拒绝数组 namespace codec 配置', () => {
    expect(() =>
      cookies({
        namespace: 'array-codec',
        namespaceCodec: [] as never,
        document: fakeCookieDocument()
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('namespace codec 描述符只读取一次并固定后续行为', async () => {
    let reads = 0;
    const codec = {
      get encode() {
        reads += 1;
        return (namespace: string, key: string) => `${namespace}-${key}`;
      },
      get decode() {
        reads += 1;
        return (namespace: string, physicalKey: string) =>
          physicalKey.startsWith(`${namespace}-`)
            ? physicalKey.slice(namespace.length + 1)
            : undefined;
      }
    };
    const store = cookies({
      namespace: 'cookie-codec',
      namespaceCodec: codec,
      document: fakeCookieDocument()
    });
    await store.set('key', 'value');
    await expect(store.get('key')).resolves.toBe('value');
    expect(reads).toBe(2);
  });

  it('namespace codec getter 异常统一返回 INVALID_ARGUMENT', () => {
    expect(() =>
      cookies({
        namespaceCodec: {
          encode: (namespace: string, key: string) => `${namespace}:${key}`,
          get decode(): never {
            throw new Error('hostile cookie codec getter');
          }
        },
        document: fakeCookieDocument()
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', backend: 'cookie' }));
  });

  it('拒绝非法 expires 写入上下文', async () => {
    const store = cookies({ namespace: 'expires-guard', document: fakeCookieDocument() });
    for (const expires of [
      null,
      'date',
      1,
      {},
      { getTime: () => 'date' },
      { getTime: () => Infinity },
      {
        getTime: () => {
          throw new Error('hostile date');
        }
      }
    ])
      await expect(store.set('key', 'value', { expires: expires as never })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      });
  });

  it('只读取一次 Date-like expires 并使用快照序列化', async () => {
    const document = fakeCookieDocument();
    const store = cookies({ namespace: 'expires-snapshot', document });
    let reads = 0;
    const expires = {
      getTime: () => {
        reads += 1;
        if (reads > 1) throw new Error('expires read twice');
        return Date.now() + 60_000;
      }
    };

    await expect(store.set('key', 'value', { expires: expires as never })).resolves.toBeUndefined();
    expect(reads).toBe(1);
    await expect(store.get('key')).resolves.toBe('value');
  });

  it('write context 字段只读取一次且 getter 异常统一返回 INVALID_ARGUMENT', async () => {
    const store = cookies({ namespace: 'write-context-snapshot', document: fakeCookieDocument() });
    let reads = 0;
    await store.set('key', 'value', {
      get signal() {
        reads += 1;
        return undefined;
      },
      get timeoutMs() {
        reads += 1;
        return undefined;
      },
      get expires() {
        reads += 1;
        return undefined;
      },
      get maxAge() {
        reads += 1;
        return undefined;
      }
    });
    expect(reads).toBe(4);
    const operation = store.set('hostile', 'value', {
      get maxAge(): never {
        throw new Error('hostile maxAge getter');
      }
    });
    expect(operation).toBeInstanceOf(Promise);
    await expect(operation).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', backend: 'cookie' });
  });

  it('write lifecycle getter 异常保留 Cookie 操作诊断元数据', async () => {
    const cause = new Error('hostile signal getter');
    const store = cookies({
      namespace: 'write-lifecycle-metadata',
      document: fakeCookieDocument()
    });
    await expect(
      store.set('hostile', 'value', {
        get signal(): never {
          throw cause;
        }
      })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      backend: 'cookie',
      operation: 'cookie.set',
      key: 'hostile',
      cause
    });
  });

  it('所有 Cookie async 方法的 lifecycle 错误保留操作诊断元数据', async () => {
    const store = cookies({
      namespace: 'async-lifecycle-metadata',
      document: fakeCookieDocument()
    });
    const operations = [
      ['cookie.get', 'key', (context: never) => store.get('key', context)],
      ['cookie.remove', 'key', (context: never) => store.remove('key', context)],
      ['cookie.has', 'key', (context: never) => store.has('key', context)],
      ['cookie.keys', undefined, (context: never) => store.keys(context)],
      ['cookie.clearValues', undefined, (context: never) => store.clearValues(context)],
      ['cookie.clearAll', undefined, (context: never) => store.clearAll(context)]
    ] as const;
    for (const [operation, key, invoke] of operations) {
      const cause = new Error(`hostile ${operation} timeout getter`);
      await expect(
        invoke({
          get timeoutMs(): never {
            throw cause;
          }
        } as never)
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        backend: 'cookie',
        operation,
        key,
        cause
      });
    }
  });

  it('拒绝超出 safe integer 的 maxAge', async () => {
    const store = cookies({ namespace: 'max-age-guard', document: fakeCookieDocument() });
    await expect(
      store.set('key', 'value', { maxAge: Number.MAX_SAFE_INTEGER + 1 })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('拒绝非法 document 注入容器', () => {
    expect(() => cookies({ document: null as never })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => cookies({ document: [] as never })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => cookies({ document: {} as never })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });

  it('构造期 document.cookie getter 异常统一返回 INVALID_ARGUMENT', () => {
    const cause = new Error('constructor cookie getter');
    expect(() =>
      cookies({
        document: {
          get cookie(): string {
            throw cause;
          },
          set cookie(_value: string) {}
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause }));
  });

  it('运行期 document.cookie getter 异常统一返回 BACKEND_UNAVAILABLE', async () => {
    const cause = new Error('runtime cookie getter');
    let reads = 0;
    const store = cookies({
      document: {
        get cookie() {
          reads += 1;
          if (reads > 1) throw cause;
          return '';
        },
        set cookie(_value: string) {}
      }
    });
    await expect(store.get('key')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      operation: 'cookie.get',
      cause
    });
  });

  it('运行期 document.cookie 类型漂移保留 owning operation', async () => {
    let reads = 0;
    const causeDocument = {
      get cookie(): string {
        reads += 1;
        return (reads === 1 ? '' : 42) as never;
      },
      set cookie(_value: string) {}
    };
    const store = cookies({ document: causeDocument });
    await expect(store.get('key')).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'cookie',
      operation: 'cookie.get',
      key: 'key',
      cause: expect.any(TypeError)
    });
  });

  it('运行期 document.cookie setter 异常统一返回 WRITE_FAILED', async () => {
    const cause = new Error('runtime cookie setter');
    const store = cookies({
      document: {
        get cookie() {
          return '';
        },
        set cookie(_value: string) {
          throw cause;
        }
      }
    });
    await expect(store.set('key', 'value')).rejects.toMatchObject({
      code: 'WRITE_FAILED',
      operation: 'cookie.set',
      cause
    });
    await expect(store.remove('key')).rejects.toMatchObject({
      code: 'WRITE_FAILED',
      operation: 'cookie.remove',
      cause
    });
  });

  it('backend 与 capabilities 正确声明', () => {
    const store = cookies({ namespace: 'ns', document: fakeCookieDocument() });
    expect(store.backend).toBe('cookie');
    expect(store.capabilities.maxValueBytes).toBe(4096);
    expect(store.capabilities.opaqueEntries).toBe(true);
    expect(store.capabilities.syncRead).toBe(true);
  });
  it('set 后 get 返回同值，值经过编解码往返', async () => {
    const store = cookies({ namespace: 'ns', document: fakeCookieDocument() });
    await store.set('token', 'a b; c,d');
    await expect(store.get('token')).resolves.toBe('a b; c,d');
  });
  it('拒绝运行时非字符串 key，不把它隐式编码为 cookie 名', async () => {
    const store = cookies({ namespace: 'ns', document: fakeCookieDocument() });
    await expect(store.set(42 as unknown as string, 'value')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    });
    expect(() => store.sync!.get(42 as unknown as string)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    await expect(store.set('key', 42 as unknown as string)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    });
  });
  it('自定义 namespace codec encode 异常统一归一化', async () => {
    const codec = {
      encode: () => {
        throw new Error('encode failure');
      },
      decode: () => undefined
    };
    const store = cookies({
      namespace: 'ns',
      document: fakeCookieDocument(),
      namespaceCodec: codec
    });
    await expect(store.set('key', 'value')).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      backend: 'cookie'
    });
  });
  it('自定义 namespace codec decode 异常在 keys 路径统一归一化', async () => {
    const doc = fakeCookieDocument();
    const codec = {
      encode: (namespace: string, key: string) => `physical:${namespace}:${key}`,
      decode: () => {
        throw new Error('decode failure');
      }
    };
    const store = cookies({ namespace: 'ns', document: doc, namespaceCodec: codec });
    await store.set('key', 'value');
    await expect(store.keys()).rejects.toMatchObject({ code: 'EXTENSION_FAILED' });
  });
  it('clearValues 删除枚举到的物理 cookie，不依赖 codec decode→encode 可逆', async () => {
    const document = fakeCookieDocument();
    const codec = {
      encode: (namespace: string, key: string) => `${namespace}:wire:${key.toLowerCase()}`,
      decode: (namespace: string, physicalKey: string) => {
        const prefix = `${namespace}:wire:`;
        return physicalKey.startsWith(prefix)
          ? physicalKey.slice(prefix.length).toUpperCase()
          : undefined;
      }
    };
    const store = cookies({ namespace: 'codec-clear', document, namespaceCodec: codec });
    await store.set('mixed', 'value');
    await expect(store.keys()).resolves.toEqual(['MIXED']);
    await store.clearValues();
    expect(document.cookie).not.toContain('codec-clear%3Awire%3Amixed');
  });
  it('clearAll 中途失败报告 operation/key 且不伪报完整回滚', async () => {
    const document = fakeCookieDocument();
    let removals = 0;
    const hostileDocument = {
      get cookie(): string {
        return document.cookie;
      },
      set cookie(value: string) {
        if (value.toLowerCase().includes('expires=thu, 01 jan 1970')) {
          removals += 1;
          if (removals === 2) throw new Error('hostile second cookie removal');
        }
        document.cookie = value;
      }
    };
    const store = cookies({ namespace: 'partial-clear', document: hostileDocument });
    await store.set('first', 'one');
    await store.set('second', 'two');
    await expect(store.clearAll()).rejects.toMatchObject({
      code: 'WRITE_FAILED',
      backend: 'cookie',
      operation: 'cookie.clearAll',
      key: 'second'
    });
    await expect(store.get('first')).resolves.toBeNull();
    await expect(store.get('second')).resolves.toBe('two');
  });
  it('clearAll 快照读取失败归属公开 operation，不降级为 cookie.keys', async () => {
    const cause = new Error('hostile cookie clear snapshot');
    let reads = 0;
    const store = cookies({
      namespace: 'snapshot-failure',
      document: {
        get cookie(): string {
          reads += 1;
          if (reads > 1) throw cause;
          return '';
        },
        set cookie(_value: string) {}
      }
    });
    await expect(store.clearAll()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'cookie',
      operation: 'cookie.clearAll',
      cause
    });
  });
  it.each([
    ['cookie.get', (store: ReturnType<typeof cookies>) => store.get('key')],
    ['cookie.has', (store: ReturnType<typeof cookies>) => store.has('key')],
    ['cookie.remove', (store: ReturnType<typeof cookies>) => store.remove('key')],
    ['cookie.keys', (store: ReturnType<typeof cookies>) => store.keys()],
    ['cookie.clearValues', (store: ReturnType<typeof cookies>) => store.clearValues()],
    ['cookie.clearAll', (store: ReturnType<typeof cookies>) => store.clearAll()],
    ['cookie.set', (store: ReturnType<typeof cookies>) => store.set('key', 'new')]
  ] as const)('%s 拒绝同一物理名的多个可见 scope', async (operation, invoke) => {
    const store = cookies({
      namespace: 'duplicate-scope',
      namespaceCodec: {
        encode: (namespace: string, key: string) => `${namespace}:${key}`,
        decode: (namespace: string, physicalKey: string) =>
          physicalKey.startsWith(`${namespace}:`)
            ? physicalKey.slice(namespace.length + 1)
            : undefined
      },
      document: {
        get cookie(): string {
          return 'duplicate-scope:key=first; duplicate-scope:key=second';
        },
        set cookie(_value: string) {}
      }
    });
    await expect(invoke(store)).rejects.toMatchObject({
      code: 'COOKIE_SCOPE_AMBIGUOUS',
      backend: 'cookie',
      operation,
      key: 'key'
    });
  });
  it('clearAll 在删除项之间观察同步重入 abort，不继续扩大 partial progress', async () => {
    const document = fakeCookieDocument();
    const controller = new AbortController();
    const reason = new Error('stop after first cookie removal');
    let armed = false;
    const store = cookies({
      namespace: 'reentrant-abort',
      document: {
        get cookie(): string {
          return document.cookie;
        },
        set cookie(value: string) {
          document.cookie = value;
          if (armed && value.toLowerCase().includes('expires=thu, 01 jan 1970'))
            controller.abort(reason);
        }
      }
    });
    await store.set('first', 'one');
    await store.set('second', 'two');
    armed = true;
    await expect(store.clearAll({ signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED',
      backend: 'cookie',
      operation: 'cookie.clearAll',
      key: 'second',
      cause: reason
    });
    await expect(store.get('first')).resolves.toBeNull();
    await expect(store.get('second')).resolves.toBe('two');
  });
  it('拒绝 namespace codec 的非法输出类型', async () => {
    const store = cookies({
      namespace: 'ns',
      document: fakeCookieDocument(),
      namespaceCodec: { encode: () => 42, decode: () => undefined } as never
    });
    await expect(store.set('key', 'value')).rejects.toMatchObject({ code: 'EXTENSION_FAILED' });
  });
  it('set 携带属性时透传给 document.cookie 赋值串', async () => {
    let lastAssignment = '';
    const doc = {
      get cookie() {
        return lastAssignment.split(';')[0] ?? '';
      },
      set cookie(value: string) {
        lastAssignment = value;
      }
    };
    const store = cookies({
      namespace: 'ns',
      document: doc,
      scope: { path: '/app', domain: 'example.com', sameSite: 'strict', secure: true }
    });
    await store.set('k', 'v', { maxAge: 3600 });
    expect(lastAssignment).toContain('max-age=3600');
    expect(lastAssignment).toContain('path=/app');
    expect(lastAssignment).toContain('domain=example.com');
    expect(lastAssignment).toContain('samesite=strict');
    expect(lastAssignment).toContain('secure');
  });
  it('remove 后 get 返回 null', async () => {
    const store = cookies({ namespace: 'ns', document: fakeCookieDocument() });
    await store.set('k', 'v');
    await store.remove('k');
    await expect(store.get('k')).resolves.toBeNull();
  });
  it('固定 scope 用于 remove', async () => {
    const invocations: string[] = [];
    const doc = {
      get cookie() {
        return '';
      },
      set cookie(value: string) {
        invocations.push(value);
      }
    };
    const store = cookies({
      namespace: 'ns',
      document: doc,
      scope: { path: '/app', domain: 'example.com' }
    });
    await store.remove('k');
    expect(invocations[0]).toContain('path=/app');
    expect(invocations[0]).toContain('domain=example.com');
  });

  it('sync remove 忽略运行时 scope override，不读取额外对象', async () => {
    const document = fakeCookieDocument();
    const store = cookies({
      namespace: 'sync-remove-fixed-scope',
      document,
      scope: { path: '/fixed', sameSite: 'lax' }
    });
    await store.set('key', 'value');
    let reads = 0;
    const hostileOverride = {
      get path(): never {
        reads += 1;
        throw new Error('sync remove read runtime scope');
      }
    };
    (store.sync!.remove as (key: string, context: unknown) => void)('key', hostileOverride);
    expect(reads).toBe(0);
    await expect(store.get('key')).resolves.toBeNull();
  });

  it('async remove 的 lifecycle context 字段只读取一次', async () => {
    const store = cookies({ namespace: 'remove-context', document: fakeCookieDocument() });
    await store.set('k', 'v');
    const controller = new AbortController();
    let reads = 0;
    await store.remove('k', {
      get signal() {
        reads += 1;
        return controller.signal;
      },
      get timeoutMs() {
        reads += 1;
        return undefined;
      }
    });
    expect(reads).toBe(2);
    await expect(store.get('k')).resolves.toBeNull();
  });

  it('过期写按删除处理，不把不可见写误报为 WRITE_FAILED', async () => {
    const doc = fakeCookieDocument();
    const store = cookies({ namespace: 'expiry', document: doc });
    await store.set('k', 'v');
    await expect(store.set('k', 'new', { maxAge: 0 })).resolves.toBeUndefined();
    await expect(store.get('k')).resolves.toBeNull();
  });

  it('构造时拒绝不安全的 SameSite=None 与 Partitioned scope', () => {
    const document = fakeCookieDocument();
    expect(() => cookies({ document, scope: { sameSite: 'none' } })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => cookies({ document, scope: { partitioned: true } })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => cookies({ document, scope: null as never })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => cookies({ document, scope: { path: 42 } as never })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => cookies({ document, namespace: '' })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => cookies({ document, namespaceCodec: {} as never })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
  });
  it('clearAll 删除本实例 scope 下写入的 cookie', async () => {
    const doc = fakeCookieDocument();
    const store = cookies({ namespace: 'path', document: doc, scope: { path: '/app' } });
    await store.set('k', 'v');
    await store.clearAll();
    await expect(store.get('k')).resolves.toBeNull();
  });
  it('keys/clear 只作用于本命名空间', async () => {
    const doc = fakeCookieDocument();
    const nsA = cookies({ namespace: 'a', document: doc });
    const nsB = cookies({ namespace: 'b', document: doc });
    await nsA.set('k1', 'v1');
    await nsB.set('k1', 'v1');
    await expect(nsA.keys()).resolves.toEqual(['k1']);
    await nsA.clearAll();
    await expect(nsA.keys()).resolves.toEqual([]);
    await expect(nsB.keys()).resolves.toEqual(['k1']);
  });
  it('sync 通道全方法与异步一致', () => {
    const store = cookies({ namespace: 'ns', document: fakeCookieDocument() });
    expect(store.sync).toBeDefined();
    store.sync!.set('k', 'v');
    expect(store.sync!.get('k')).toBe('v');
    expect(store.sync!.has('k')).toBe(true);
    expect(store.sync!.keys()).toEqual(['k']);
    store.sync!.remove('k');
    expect(store.sync!.get('k')).toBeNull();
  });
  it('dispose 后任何操作抛 STORE_DISPOSED', async () => {
    const store = cookies({ namespace: 'ns', document: fakeCookieDocument() });
    await store.dispose();
    await expect(store.get('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' });
  });
  it('超过 4096 字节的值 set 抛 VALUE_TOO_LARGE', async () => {
    const store = cookies({ namespace: 'ns', document: fakeCookieDocument() });
    await expect(store.set('k', 'x'.repeat(4097))).rejects.toMatchObject({
      code: 'VALUE_TOO_LARGE'
    });
  });
  it('未传 document 时使用 globalThis.document（jsdom 环境）', async () => {
    const store = cookies({ namespace: 'global-check' });
    await store.set('k', 'v');
    await expect(store.get('k')).resolves.toBe('v');
    await store.remove('k');
  });
});
