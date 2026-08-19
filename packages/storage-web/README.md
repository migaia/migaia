# `@migaia/storage-web`

浏览器端本地存储的统一契约实现：命名空间化的 `localStorage`/`sessionStorage`、`document.cookie`、IndexedDB，以及纯内存实现，叠加可选的实体（entity）、schema 校验、序列化（codec）扩展层。

## 适用与不适用场景

**适用**：浏览器端用户偏好、会话态、请求 cookie、IndexedDB 结构化记录，以及测试/SSR 场景下需要一个易失但接口一致的存储替身。所有能力通过 `capabilities` 显式声明，不假设每个后端都支持记录/字节/事务——调用前用 `isRecordStore`/`asRecordStore` 显式收窄，而不是假设。

**不适用**：不是服务端数据库、跨设备同步服务、跨标签页订阅 API，也不是状态管理器。跨标签页的 `storage` 事件本包不暴露，订阅属于上层状态管理职责。根导入包含浏览器后端类型；只需要易失存储的 SSR/Node/测试场景应使用 `@migaia/storage-web/memory` 子路径，避免引入 DOM/IndexedDB 类型。

## 安装

```bash
pnpm add @migaia/storage-web
```

Monorepo 内部依赖 `@migaia/storage-web@workspace:^`。

## 目录

- [`localStorage` / `sessionStorage`](#web-storage-模块)：命名空间化的同步 Web Storage 封装
- [`cookies`](#cookies-模块)：`document.cookie` 封装，带 scope 与可见性歧义处理
- [`indexedDb`](#indexeddb-模块)：唯一支持记录/字节/事务的浏览器后端
- [`memoryStorage`](#memorystorage-模块)：纯内存 L0+L1 实现，测试/SSR/降级用
- [契约与能力模块](#契约与能力模块)：`IKeyValueStore`/`IRecordStore`/`isRecordStore`/`asRecordStore`/命名空间编码
- [序列化（codec）模块](#序列化-codec-模块)：`jsonCodec`/`structuredCodec`/`binaryCodec`/`selectCodec`
- [Schema 模块](#schema-模块)：`passthrough`/`fromStandardSchema`/`runMigrations`
- [Entity 模块](#entity-模块)：`defineEntity` 与仓储（repository）
- [错误模块](#错误模块)：`StorageError`/`StorageErrorCode`/契约错误
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与全部错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="web-storage-模块"></a>

## `localStorage` / `sessionStorage` 模块

```ts
import { localStorage, sessionStorage } from '@migaia/storage-web';
```

**`localStorage`｜5 秒上手**：

```ts
const store = localStorage({ namespace: 'settings' });
await store.set('theme', 'dark');
await store.get('theme'); // 'dark'
store.sync.set('theme', 'light'); // 同步 API，Web Storage 天然同步
```

`sessionStorage(options)` 用法完全一致，仅默认注入 `globalThis.sessionStorage`。

全部选项（`ILocalStorageOptions` / `ISessionStorageOptions`，均继承 `IWebStorageOptions`）：

- `namespace?: string` —— 默认 `'default'`；必须非空字符串，否则抛 `INVALID_CONFIG`。同命名空间内的 `keys()`/`clearValues()`/`clearAll()` 互相隔离。
- `namespaceCodec?: INamespaceCodec` —— 默认 `lengthPrefixedNamespaceCodec`；决定命名空间如何编码进物理 key。
- `storage?: IWebStorageLike` —— 注入点，测试/非浏览器环境用；默认 `globalThis.localStorage`（或 `sessionStorage`）。

构造期会真实写一次探测 key 再删除（`localStorage()`/`sessionStorage()` 都会），Safari 隐私模式下 `setItem` 抛错也能被探测到，失败时立即抛 `BACKEND_UNAVAILABLE`，而不是等到第一次业务写入才发现。

能力（`store.capabilities`）恒为：`{ syncRead: true, binary: false, records: false, transactions: false, iteration: false, maxValueBytes: 5*1024*1024, opaqueEntries: false }`（cookie 与两个 Web Storage 后端的 `maxValueBytes` 是近似上限，不是精确配额）。

```ts
const store = localStorage({ storage: myFakeStorage }); // 测试环境注入
```

---

<a id="cookies-模块"></a>

## `cookies` 模块

```ts
import { cookies } from '@migaia/storage-web';
```

**`cookies`｜10 秒上手**：

```ts
const jar = cookies({ namespace: 'app', scope: { path: '/', secure: true, sameSite: 'lax' } });
await jar.set('session', 'abc123', { maxAge: 3600 });
await jar.get('session'); // 'abc123'
await jar.remove('session');
```

全部选项（`ICookiesOptions`）：

- `namespace?: string` —— 默认 `'default'`；同 Web Storage。
- `namespaceCodec?: INamespaceCodec` —— 默认 `lengthPrefixedNamespaceCodec`。
- `scope?: ICookieScope` —— 构造期固定，写入与删除全程复用同一 scope，不可运行期更改：
  - `path?: string` —— 必须以 `/` 开头且不含 `;`；默认 `'/'`。
  - `domain?: string` —— 非空且不含空白/`;`。
  - `sameSite?: 'strict' | 'lax' | 'none'` —— `'none'` 要求同时 `secure: true`，否则抛 `INVALID_CONFIG`。
  - `secure?: boolean`
  - `partitioned?: boolean` —— 为 `true` 要求同时 `secure: true`，否则抛 `INVALID_CONFIG`。
- `document?: ICookieDocument`（结构 `{ cookie: string }`）—— 注入点，测试环境用；默认 `globalThis.document`，缺失时抛 `BACKEND_UNAVAILABLE`。

`set(key, value, ctx?)` 的 `ctx: ICookieWriteContext` 额外字段：`expires?: Date`、`maxAge?: number`（安全整数）、`signal?`、`timeoutMs?`。`maxAge <= 0` 或 `expires` 早于当前时间，会立即写入删除态。`remove(key, ctx?)` 的 `ctx: ICookieRemoveContext` 只有 `signal?`/`timeoutMs?`。同步版本 `sync.set(key, value, ctx?)` 接受 `expires`/`maxAge`/`conflictPolicy`，不接受 `signal`/`timeoutMs`。

能力：`{ syncRead: true, binary: false, records: false, transactions: false, iteration: false, maxValueBytes: 4096, opaqueEntries: true }`。`opaqueEntries: true` 是硬承诺：HttpOnly cookie 对 JS 不可见，`has()` 返回 `false` 不代表不存在，`remove()` 也不保证生效；同名多 scope 同时可见时，`get`/`set`/`has`/`keys` 会抛 `COOKIE_SCOPE_AMBIGUOUS`，而不是返回其中一个。

---

<a id="indexeddb-模块"></a>

## `indexedDb` 模块

```ts
import { indexedDb } from '@migaia/storage-web';
```

**`indexedDb`｜10 秒上手** —— 唯一原生支持字节/记录/事务/游标迭代的浏览器后端：

```ts
const db = indexedDb<{ id: string; name: string }>({ dbName: 'app-data' });
await db.putRecord({ id: 'ada', name: 'Ada' }, 'ada');
await db.getRecord('ada'); // { id: 'ada', name: 'Ada' }
for await (const [key, value] of db.iterateRecords()) console.log(key, value);
```

全部选项（`IIndexedDbOptions`）：

- `dbName?: string` —— 默认 `'storage-web'`。
- `kvStoreName?: string` —— 默认 `'kv'`。
- `bytesStoreName?: string` —— 默认 `'bytes'`。
- `recordsStoreName?: string` —— 默认 `'records'`。以上三个 store 名必须非空、互不相同，且不能撞上内部保留名（`__storage_web_revisions__`、`storage-web:meta`）。
- `cleanupLegacyRecords?: boolean` —— 默认 `false`；`true` 时在确认旧版 `documents` store 已完整迁移到 `recordsStoreName` 后才真正删除它，只在确认没有客户端还需要回滚时开启。
- `factory?: IDBFactory` —— 测试/非浏览器环境注入点；默认 `globalThis.indexedDB`，缺失抛 `BACKEND_UNAVAILABLE`。
- `keyRange?: typeof IDBKeyRange` —— 测试环境（jsdom 无原生 IndexedDB）须与 `factory` 一起从 `fake-indexeddb` 显式传入；默认 `globalThis.IDBKeyRange`。

能力：`{ syncRead: false, binary: true, records: true, transactions: true, iteration: true, maxValueBytes: undefined, opaqueEntries: false }`（无 `sync` 字段，IndexedDB 没有同步 API）。

内部维护 schema 版本（当前为 2）与记录 revision，用于事务乐观并发检测；连接只开一次并复用，失败会清空缓存以便下次重连；`onversionchange`/`onblocked` 会主动让路给其他标签页的升级请求。额外暴露 `metadata: { get, set, delete }` 只读附加通道，供 `repository.migrate()` 做可恢复的迁移检查点。

---

<a id="memorystorage-模块"></a>

## `memoryStorage` 模块

```ts
import { memoryStorage } from '@migaia/storage-web'; // 或 '@migaia/storage-web/memory'
```

**`memoryStorage`｜3 秒上手**：

```ts
const store = memoryStorage<{ id: string }>();
await store.putRecord({ id: '1' }, '1');
```

无入参，无选项。每次调用创建一个独立、进程内、易失的存储，天然隔离，不需要命名空间。实现全部 L0（值）+ L1（字节/记录/迭代/事务）接口，能力恒为 `{ syncRead: true, binary: true, records: true, transactions: true, iteration: true, maxValueBytes: undefined, opaqueEntries: false }`。适合测试、SSR 占位、以及其他后端不可用时的显式降级目标，绝不用于需要持久化的场景。

---

<a id="契约与能力模块"></a>

## 契约与能力模块

```ts
import {
  isRecordStore,
  asRecordStore,
  ConflictPolicy,
  lengthPrefixedNamespaceCodec
} from '@migaia/storage-web';
```

**`isRecordStore` / `asRecordStore`｜5 秒上手** —— 从 `IKeyValueStore`（L0）安全收窄到 `IRecordStore`（L1）：

```ts
const store = indexedDb();
if (isRecordStore(store)) await store.putRecord({ a: 1 }, 'k');
const records = asRecordStore(store); // 能力不足时抛 StorageContractError(UNSUPPORTED_CAPABILITY)
```

单参数 `store: IKeyValueStore`，均无选项。判定同时检查 `backend` 是否为已知种类、`capabilities.records/binary/transactions/iteration` 是否全为 `true`，以及 L1 全部方法（`getBytes`/`setBytes`/`clearBytes`/`getRecord`/`putRecord`/`deleteRecord`/`clearRecords`/`iterateRecords`/`transaction`）是否都是函数。

**`ConflictPolicy`｜3 秒上手** —— 常量对象，无调用参数：

```ts
await store.set('k', 'v', { conflictPolicy: ConflictPolicy.replace });
```

取值 `{ conflict: 'conflict', replace: 'replace' }`。默认 `'conflict'`：一个逻辑 key 同时占用 value/bytes/record 三个通道之一时，另一通道写入会抛 `DUPLICATE_KEY`；显式传 `'replace'` 才会原子删除其他通道的同名值。

**`lengthPrefixedNamespaceCodec`｜3 秒上手** —— 默认物理 key 编码器，`localStorage`/`sessionStorage`/`cookies` 的 `namespaceCodec` 默认值：

```ts
lengthPrefixedNamespaceCodec.encode('app', 'theme'); // 'sw1:3:app:theme'
lengthPrefixedNamespaceCodec.decode('app', 'sw1:3:app:theme'); // 'theme'
```

自定义 `INamespaceCodec` 需实现 `encode(namespace, key): string` 与 `decode(namespace, physicalKey): string | undefined`（不属于该命名空间返回 `undefined`）；自定义 codec 自行承担迁移与防碰撞责任。

关键契约类型（均从根导出，直接标注调用点即可，无需额外导入函数）：`IKeyValueStore`（L0，`get`/`set`/`remove`/`has`/`keys`/`clearValues`/`clearAll`/`dispose`/`backend`/`capabilities`/可选 `sync`）、`IRecordStore<T>`（在 L0 基础上加 `getBytes`/`setBytes`/`clearBytes`/`getRecord`/`putRecord`/`deleteRecord`/`clearRecords`/`iterateRecords`/`transaction`/可选 `metadata`）、`IStorageCapabilities`（`syncRead`/`binary`/`records`/`transactions`/`iteration`/`maxValueBytes`/`opaqueEntries`）、`IOperationContext`（`signal?`/`timeoutMs?`/`pageSize?`）、`IWriteOptions`（`IOperationContext` 叠加 `conflictPolicy?`）。

---

<a id="序列化-codec-模块"></a>

## 序列化（codec）模块

```ts
import { jsonCodec, structuredCodec, binaryCodec, selectCodec } from '@migaia/storage-web';
```

**`jsonCodec`｜3 秒上手** —— 默认 codec，零依赖，全后端可用：

```ts
await jsonCodec.encode({ a: 1 }); // '{"a":1}'
await jsonCodec.decode('{"a":1}'); // { a: 1 }
```

`output: 'text'`。`JSON.stringify` 返回 `undefined`（如输入本身是 `undefined`）时落盘为字符串 `'null'`；`stringify`/`parse` 抛错分别归一化为 `SERIALIZE_FAILED`/`DESERIALIZE_FAILED`。

**`structuredCodec`｜3 秒上手** —— 恒等编解码，交给后端自身的 structured clone：

```ts
await structuredCodec.encode({ date: new Date(), blob: myBlob }); // 原样返回
```

`output: 'structured'`。只能用于支持 `records`（`capabilities.records === true`）的后端；可直接存 `Blob`/`File`/`ArrayBuffer`/`Map`/`Set`/`Date`，甚至循环引用。

**`binaryCodec`｜5 秒上手**：

```ts
await binaryCodec.encode(new Uint8Array([1, 2, 3])); // 原样返回（校验类型）
```

`output: 'binary'`。`encode`/`decode` 均要求输入是 `Uint8Array`，否则分别抛 `SERIALIZE_FAILED`/`DESERIALIZE_FAILED`。

**`selectCodec`｜10 秒上手** —— 按后端能力为 codec 选路，实体层内部使用，也可直接调用：

```ts
const selected = selectCodec(binaryCodec, store.capabilities, (msg) => console.warn(msg));
await selected.encode(bytes); // text-only 后端上自动转 base64
```

参数：`codec: ICodec`（必填）、`capabilities: IStorageCapabilities`（必填）、`onDiagnostic?: (message: string) => void`。选路规则：`structured` 输出遇到 `capabilities.records === false` 抛 `UNSUPPORTED_CAPABILITY`（structured clone 能力无法用 JSON 表达，不做隐式转换避免丢数据）；`binary` 输出遇到 `capabilities.binary === false` 自动降级为 base64 文本（体积 +33%），并调用一次 `onDiagnostic` 报告；其余情况原样直连。

---

<a id="schema-模块"></a>

## Schema 模块

```ts
import { passthrough, fromStandardSchema, runMigrations } from '@migaia/storage-web';
```

**`passthrough`｜3 秒上手** —— 默认 schema，零校验直接透传：

```ts
const schema = passthrough<{ id: string }>();
```

无参数（泛型指定类型）。返回 `{ name: 'passthrough', validate: async (value) => value }`。

**`fromStandardSchema`｜5 秒上手** —— 适配任意实现 [Standard Schema](https://standardschema.dev) v1 规范的库（zod ≥3.24、valibot ≥1.0、arktype ≥2.0）：

```ts
import { z } from 'zod';
const schema = fromStandardSchema(z.object({ id: z.string() }));
```

单参数 `schema: IStandardSchemaV1`（必填），无选项。校验失败时抛 `VALIDATION_FAILED`，`cause.message` 是各条 issue 消息用 `; ` 拼接的结果。

**`runMigrations`｜10 秒上手** —— 按版本升序执行迁移函数链，独立于 entity 层可单独调用：

```ts
await runMigrations(oldValue, 1, 3, {
  2: async (value) => ({ ...value, addedInV2: true }),
  3: async (value) => ({ ...value, addedInV3: true })
});
```

参数：`value: unknown`（必填）、`fromVersion: number`（必填，非负安全整数）、`toVersion: number`（必填，非负安全整数）、`migrations?: Record<number, IMigration>`、`signal?: IAbortSignal`。`fromVersion >= toVersion` 直接原样返回 `value`；某个版本缺失对应迁移函数视为该版本无形状变化（no-op），不是错误——这一点与 entity 定义期的迁移图校验（要求每一步都存在）不同。

---

<a id="entity-模块"></a>

## Entity 模块

```ts
import { defineEntity } from '@migaia/storage-web';
```

**`defineEntity`｜15 秒上手** —— 声明式定义一类记录，`connect(store)` 绑定到具体后端产出仓储：

```ts
type IPreference = { id: string; theme: 'light' | 'dark' };

const definition = defineEntity<IPreference>({
  name: 'preferences',
  key: 'id',
  version: 2,
  migrations: { 2: async (previous) => ({ ...(previous as { id: string }), theme: 'light' }) }
});

const preferences = definition.connect(indexedDb({ dbName: 'app-data' }));
await preferences.put({ id: 'appearance', theme: 'dark' });
await preferences.get('appearance'); // { id: 'appearance', theme: 'dark' }
```

全部选项（`IEntityOptions<TDomain, TStored>`）：

- `name: string`（必填）—— 非空，不能以 `__` 开头（保留前缀）。
- `key: Extract<keyof TDomain, string>`（必填）—— 领域对象上作为主键的属性名。
- `schema?: ISchemaAdapter<TDomain, TStored>` —— 默认 `passthrough<TDomain>()`。
- `codec?: ICodec` —— 未显式提供时，`connect(store)` 才按后端能力决定：结构化后端（IndexedDB/memory）默认 `structuredCodec`，KV-only 后端（local/session/cookie）默认 `jsonCodec`；显式提供的 codec 一律经 `selectCodec` 按能力选路。
- `version?: number` —— 默认 `1`，必须是正安全整数。
- `migrations?: Record<number, IMigration>` —— `version > 1` 时必须**完整**提供第 2 到 `version` 每一步，缺一步就抛 `INVALID_CONFIG`（与 `runMigrations` 的"缺失即 no-op"不同，这里是构造期硬校验）。
- `validateOnRead?: boolean` —— 默认 `true`：读出的数据总要经过 `schema.validate`，因为持久化数据会跨版本存活，读到脏数据比写入脏数据更常见。
- `onDiagnostic?: (message: string) => void` —— 默认 `console.warn`；诊断回调自身抛错会被吞掉，不影响存储语义。
- `defaultOrderBy?: (left: TDomain, right: TDomain) => number` —— `list`/`stream` 未显式传 `orderBy` 时的默认排序。

`connect(store)` 返回的 `IRepository<TDomain>`：

- `get(id, ctx?)`：按主键读取并经 schema/迁移物化；找不到返回 `undefined`。
- `put(value, ctx?)`：`validate → normalize → encode → codec.encode` 全链路后写入，返回写入的 `IStorageKey`。
- `remove(id, ctx?)`：删除主键对应记录（同时清理历史存储形态遗留的键）。
- `list(options?, ctx?)` / `stream(options?, ctx?)`：`options: IListOptions<TDomain>` 为 `{ range?, limit?, orderBy?, onInvalid? }`；`onInvalid` 取 `'skip'`（默认）、`'throw'`，或 `(issue) => 'skip' | 'throw'` 处理器，`issue.stage` 取 `'decode' | 'migrate' | 'validate'`。KV-only 后端会全表扫描并触发一次诊断；结构化后端按实体前缀 range 扫描。
- `migrate(options?, ctx?)`：`options: IMigrateOptions<TDomain>` 为 `{ batchSize?(默认 100，正安全整数), onInvalid? }`；返回 `{ scanned, eligible, migrated, skipped, alreadyCurrent, conflicted }`。IndexedDB 可用 `metadata` 通道持久化检查点、跨调用断点续跑；`memoryStorage`/KV-only 后端没有 `metadata` 通道，无法跨调用恢复。
- `batch(run, ctx?)`：仅结构化后端（有真正事务）支持；`run` 收到 `IEntityTransactionScope<TDomain>`（`get`/`put`/`remove`），KV-only 后端调用会抛 `StorageContractError(UNSUPPORTED_CAPABILITY)`。

---

<a id="错误模块"></a>

## 错误模块

```ts
import {
  StorageError,
  StorageErrorCode,
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-web';
```

**`StorageError`｜3 秒上手** —— 本包（`@migaia/storage-web`）专有失败的统一类型：

```ts
try {
  await store.set('k', 'v', { conflictPolicy: ConflictPolicy.conflict });
} catch (error) {
  if (error instanceof StorageError && error.code === StorageErrorCode.duplicateKey) {
    // error.backend / error.key / error.existingChannel / error.attemptedChannel 均可读
  }
}
```

`source` 恒为 `'@migaia/storage-web'`；`cause` 恒保留原始异常，永不改写 `message`。

全部错误码（`StorageErrorCode`）：`unavailable`(`BACKEND_UNAVAILABLE`)、`quotaExceeded`(`QUOTA_EXCEEDED`)、`valueTooLarge`(`VALUE_TOO_LARGE`)、`serializeFailed`(`SERIALIZE_FAILED`)、`deserializeFailed`(`DESERIALIZE_FAILED`)、`validationFailed`(`VALIDATION_FAILED`)、`migrationFailed`(`MIGRATION_FAILED`)、`transactionFailed`(`TRANSACTION_FAILED`)、`duplicateKey`(`DUPLICATE_KEY`)、`versionUnsupported`(`VERSION_UNSUPPORTED`)、`extensionFailed`(`EXTENSION_FAILED`)、`transactionConflict`(`TRANSACTION_CONFLICT`)、`writeFailed`(`WRITE_FAILED`)、`cookieScopeAmbiguous`(`COOKIE_SCOPE_AMBIGUOUS`)、`invalidConfig`(`INVALID_CONFIG`)。

契约级失败（跨包共享，`@migaia/storage-contract`）经根路径透传：`StorageContractError`（`source: '@migaia/storage-contract'`）、`StorageContractErrorCode`（`invalidArgument`/`invalidKey`/`unsupported`/`disposed`/`aborted`）、`isStorageContractError` 类型守卫。两类错误都保留 `cause` 链。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. IndexedDB + Standard Schema + 版本迁移

```ts
import { z } from 'zod';
import { defineEntity, fromStandardSchema, indexedDb } from '@migaia/storage-web';

const UserV2 = z.object({ id: z.string(), email: z.string(), verified: z.boolean() });

const users = defineEntity({
  name: 'users',
  key: 'id',
  schema: fromStandardSchema(UserV2),
  version: 2,
  migrations: { 2: async (previous) => ({ ...(previous as object), verified: false }) }
}).connect(indexedDb({ dbName: 'app-data' }));

await users.put({ id: 'ada', email: 'ada@example.com', verified: true });
const result = await users.migrate({ batchSize: 200, onInvalid: 'skip' });
console.log(result.migrated, result.conflicted);
```

### 2. KV-only 后端上做能力检查后再决定用记录还是值

```ts
import { asRecordStore, cookies, isRecordStore, memoryStorage } from '@migaia/storage-web';

const primary = cookies({ scope: { path: '/', secure: true, sameSite: 'lax' } });
const fallback = memoryStorage();
const store = isRecordStore(primary) ? asRecordStore(primary) : fallback;
// cookies 是 L0-only，isRecordStore(primary) 为 false，实际会走 memoryStorage 分支
```

### 3. 批量事务写入 + 冲突重试（结构化后端）

```ts
import { defineEntity, indexedDb, StorageError, StorageErrorCode } from '@migaia/storage-web';

const orders = defineEntity<{ id: string; total: number }>({ name: 'orders', key: 'id' }).connect(
  indexedDb()
);

const applyBatch = async (items: Array<{ id: string; total: number }>) => {
  try {
    await orders.batch(async (tx) => {
      for (const item of items) await tx.put(item);
    });
  } catch (error) {
    if (error instanceof StorageError && error.code === StorageErrorCode.transactionConflict) {
      await applyBatch(items); // 并发冲突：重读后重试整个回调
    } else {
      throw error;
    }
  }
};
```

### 4. 自定义 codec + 二进制降级诊断

```ts
import { binaryCodec, memoryStorage, selectCodec, sessionStorage } from '@migaia/storage-web';

const textOnly = sessionStorage();
const selected = selectCodec(binaryCodec, textOnly.capabilities, (message) =>
  console.warn('[codec fallback]', message)
);
const encoded = await selected.encode(new Uint8Array([1, 2, 3])); // base64 字符串，触发一次诊断

const recordBackend = memoryStorage();
const direct = selectCodec(binaryCodec, recordBackend.capabilities);
await direct.encode(new Uint8Array([1, 2, 3])); // 原样透传，无降级
```

### 5. 命名空间隔离 + 显式 replace 冲突策略

```ts
import { ConflictPolicy, localStorage } from '@migaia/storage-web';

const teamA = localStorage({ namespace: 'team-a' });
const teamB = localStorage({ namespace: 'team-b' });
await teamA.set('config', '{}');
await teamB.set('config', '{}'); // 不同命名空间，互不冲突

await teamA.clearValues(); // 只清 team-a 命名空间下的键，team-b 不受影响
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm --filter @migaia/storage-web run fmt
pnpm --filter @migaia/storage-web run lint
pnpm --filter @migaia/storage-web run typecheck
pnpm --filter @migaia/storage-web run typecheck:test
pnpm --filter @migaia/storage-web run test
pnpm --filter @migaia/storage-web run test:e2e
```

`test` 会先执行 `build`（Vite 打包 + `tsc --emitDeclarationOnly`）再跑 `vitest run --coverage`；`test:e2e` 使用 `e2e/playwright.config.ts`，需要本机已安装 Playwright 浏览器依赖。完整 API/配置参考、迁移指南与故障排查，见 [USEGUIDE.md](./USEGUIDE.md)。
