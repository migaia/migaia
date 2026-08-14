# @migaia/storage-web 使用手册

本文是 `@migaia/storage-web` 的完整参考手册。先看 [README.md](./README.md#5-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来"，本文讲"每一个 API 的精确签名、每一种边界行为、每一个错误码"。

## 目录

1. [契约总览：L0 / L1](#1-契约总览l0--l1)
2. [后端参考](#2-后端参考)
3. [Entity / Repository 完整参考](#3-entity--repository-完整参考)
4. [Schema 扩展点](#4-schema-扩展点)
5. [Serialize / Codec 扩展点](#5-serialize--codec-扩展点)
6. [错误码完整参考](#6-错误码完整参考)
7. [事务与并发冲突检测](#7-事务与并发冲突检测)
8. [取消与超时](#8-取消与超时)
9. [生命周期与资源释放](#9-生命周期与资源释放)
10. [Interop：转 store-persist adapter](#10-interop转-store-persist-adapter)
11. [完整生产示例](#11-完整生产示例)
12. [常见问题排查](#12-常见问题排查)

---

## 1. 契约总览：L0 / L1

```ts
import type { IKeyValueStore, IRecordStore, ISyncKeyValueStore } from '@migaia/storage-web';
```

### 1.1 L0：`IKeyValueStore`（所有后端都实现）

| 方法 | 参数类型 | 签名 | 同步/异步 | 说明 |
| --- | --- | --- | --- | --- |
| `backend` | — | `IBackendKind`（`'local'\|'session'\|'cookie'\|'indexeddb'\|'memory'`） | — | 只读字段，标识当前实例的后端类型。 |
| `capabilities` | — | `IStorageCapabilities` | — | 只读能力描述，见下表。 |
| `get(key, ctx?)` | `key: string`；`ctx?: IOperationContext` | `Promise<string \| null>` | 异步 | 不存在返回 `null`。 |
| `set(key, value, ctx?)` | `key: string`；`value: string`；`ctx?: IWriteOptions` | `Promise<void>` | 异步 | `value` 必须是 `string`，否则抛 `INVALID_ARGUMENT`。 |
| `remove(key, ctx?)` | `key: string`；`ctx?: IOperationContext` | `Promise<void>` | 异步 | 删除单个 key；key 不存在时静默成功。 |
| `has(key, ctx?)` | `key: string`；`ctx?: IOperationContext` | `Promise<boolean>` | 异步 | 存在性探测。 |
| `keys(ctx?)` | `ctx?: IOperationContext` | `Promise<string[]>` | 异步 | 返回当前命名空间/实例下的全部 L0 key。 |
| `clearValues(ctx?)` | `ctx?: IOperationContext` | `Promise<void>` | 异步 | 只清空 L0 字符串通道，不影响 bytes/records。 |
| `clearAll(ctx?)` | `ctx?: IOperationContext` | `Promise<void>` | 异步 | 清空该实例拥有的全部通道（L0 + L1）；结构化后端会同时使内存中悬挂的并发 `transaction()` 冲突失效（见 [§7](#7-事务与并发冲突检测)）。 |
| `dispose()` | — | `Promise<void>` | 异步 | 标记实例不可再用，之后任何方法调用抛 `STORE_DISPOSED`。**不清空底层数据**，只是让这个 JS 实例失效。 |
| `sync?` | — | `ISyncKeyValueStore` | — | 仅同步后端（local/session/cookie/memory）提供；IndexedDB 上为 `undefined`。 |

`IStorageCapabilities`：

| 字段 | 含义 |
| --- | --- |
| `syncRead: boolean` | 是否提供 `sync` 通道。 |
| `binary: boolean` | 是否原生支持 `setBytes`/`getBytes`（不支持时 binary codec 会自动 base64 降级，见 [§5](#5-serialize--codec-扩展点)）。 |
| `records: boolean` | 是否实现 L1（`isRecordStore(store)` 就是在检查这个字段 + 方法形状）。 |
| `transactions: boolean` | 是否支持 `transaction()`。 |
| `iteration: boolean` | 是否支持 `iterateRecords()`。 |
| `maxValueBytes: number \| undefined` | 单值近似上限（字节）：cookie 4096，local/session ~5MB，IndexedDB/memory 为 `undefined`（不设单值硬上限，受配额约束）。 |
| `opaqueEntries: boolean` | 该后端上是否可能存在 JS 不可见的键（目前仅 cookie，因 HttpOnly）。 |

### 1.2 同步通道：`ISyncKeyValueStore`

仅 local/session/cookie/memory 提供，直接同步执行，跳过 `Promise` 与 `AbortSignal` 开销：

```ts
get(key: string): string | null;
set(key: string, value: string, options?: IWriteOptions): void;
remove(key: string): void;
has(key: string): boolean;
keys(): string[];
clearValues(): void;
```

cookie 的 `sync` 变体（`ISyncCookieStore`）签名略有不同：`set`/`remove` 的 `ctx` 类型是去掉 `signal`/`timeoutMs` 的 cookie 专属选项（`expires`/`maxAge`/`path`/...），因为同步调用没有取消语义。

### 1.3 L1：`IRecordStore<TValue>`（仅 `memoryStorage`、`indexedDb`）

在 L0 基础上追加字节与结构化文档通道：

| 方法 | 参数类型 | 签名 | 同步/异步 | 说明 |
| --- | --- | --- | --- | --- |
| `getBytes(key, ctx?)` | `key: string`；`ctx?: IOperationContext` | `Promise<Uint8Array \| null>` | 异步 | |
| `setBytes(key, value, ctx?)` | `key: string`；`value: Uint8Array`；`ctx?: IWriteOptions` | `Promise<void>` | 异步 | `value` 必须是 `Uint8Array`（跨 iframe/realm 实例也被识别，用 `ArrayBuffer.isView` 而非 `instanceof`），否则 `INVALID_ARGUMENT`。 |
| `clearBytes(ctx?)` | `ctx?: IOperationContext` | `Promise<void>` | 异步 | 只清 bytes 通道。 |
| `getRecord(key, ctx?)` | `key: IStorageKey`；`ctx?: IOperationContext` | `Promise<TValue \| undefined>` | 异步 | `key` 类型见 §1.4；不存在返回 `undefined`。 |
| `putRecord(value, key?, ctx?)` | `value: TValue`；`key?: IStorageKey`；`ctx?: IWriteOptions` | `Promise<IStorageKey>` | 异步 | 不传 `key` 时用 `crypto.randomUUID()` 自动生成（不支持 `crypto.randomUUID` 的环境退化为时间戳+随机数）；返回实际写入的 key。 |
| `deleteRecord(key, ctx?)` | `key: IStorageKey`；`ctx?: IOperationContext` | `Promise<void>` | 异步 | |
| `clearRecords(ctx?)` | `ctx?: IOperationContext` | `Promise<void>` | 异步 | 只清 records 通道，同时使并发中的 `transaction()` 因 epoch 变化而冲突失败。 |
| `metadata?` | — | `{ get/set/delete }` | — | 后端自有的元数据通道，供断点续传式迁移存 checkpoint；**仅 IndexedDB 提供，`memoryStorage` 上是 `undefined`**（见 [§3.3](#33-迁移-migrate)）。`get`/`set`/`delete` 均为异步方法，返回 `Promise`。 |
| `iterateRecords(range?, ctx?)` | `range?: IKeyRange`；`ctx?: IOperationContext` | `AsyncIterableIterator<[IStorageKey, TValue]>` | 异步 | `ctx.pageSize` 控制游标分页大小（IndexedDB 默认 128，范围 1–4096）。 |
| `transaction(run, ctx?)` | `run: (tx: ITransactionScope<TValue>) => Promise<T>`；`ctx?: IOperationContext` | `Promise<T>` | 异步 | 见 [§7](#7-事务与并发冲突检测)。 |

### 1.4 类型收窄

```ts
import { isRecordStore, asRecordStore } from '@migaia/storage-web';

if (isRecordStore(store)) {
  await store.putRecord({ id: 'u1' });
}
const records = asRecordStore(store); // 能力或方法形状不足会抛 UNSUPPORTED_CAPABILITY
```

### 1.5 Key 与 Range

```ts
type IStorageKey = string | number | Date | ArrayBuffer | readonly IStorageKey[];
type IKeyRange = { lower?: IStorageKey; lowerOpen?: boolean; upper?: IStorageKey; upperOpen?: boolean };
```

`IStorageKey` 校验有硬上限：嵌套数组深度 ≤32、总节点数 ≤4096、单个 `ArrayBuffer` ≤1MB；超出或含循环引用抛 `INVALID_KEY`。`IKeyRange` 构造时会校验 `lower`/`upper` 都在这个 key 域内，且 `lower` 不能大于 `upper`（相等时若任一端是开区间也非法），否则 `INVALID_ARGUMENT`。

### 1.6 写入选项与冲突策略

```ts
type IWriteOptions = { signal?: AbortSignal; timeoutMs?: number; pageSize?: number; conflictPolicy?: 'conflict' | 'replace' };
```

仅结构化后端（`memoryStorage`、`indexedDb`）区分 value/bytes/record 三条通道；同一个 key 已经以某条通道存在时，再往另一条通道写默认抛 `DUPLICATE_KEY`（`conflictPolicy` 默认 `'conflict'`），传 `{ conflictPolicy: 'replace' }` 才会先删旧通道再写。

---

## 2. 后端参考

### 2.1 `localStorage()` / `sessionStorage()`

```ts
localStorage(options?: ILocalStorageOptions): ISyncCapableStore<IKeyValueStore>
sessionStorage(options?: ISessionStorageOptions): ISyncCapableStore<IKeyValueStore>
```

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `namespace` | `string` | `'default'` | 物理 key 前缀，隔离多实例/多应用；必须非空字符串。 |
| `namespaceCodec` | `INamespaceCodec` | `lengthPrefixedNamespaceCodec` | 高级扩展点，改变物理 key 编码格式（见下）。 |
| `storage` | `IWebStorageLike` | `globalThis.localStorage` / `globalThis.sessionStorage` | 注入点：测试、非浏览器环境、自定义存储实现。 |

默认命名空间编码 `lengthPrefixedNamespaceCodec` 产出形如 `sw1:<namespace 字节长度>:<encodeURIComponent(namespace)>:<key>` 的物理 key——长度前缀是为了在解码时精确切分 namespace 边界，避免 namespace 里出现分隔符导致的碰撞。

**构造期即会探测可用性**：内部真的写一次 probe key 再删除/还原（`probeWebStorage`），因为 Safari 隐私模式下 `localStorage` 对象存在，但 `setItem` 会抛异常（旧版本 `SecurityError`，新版本是 quota=0 的 `QuotaExceededError`）——唯一可靠的探测方式就是真的写一次。探测失败抛 `BACKEND_UNAVAILABLE`。

`sync` 通道直接读写；异步方法（`get`/`set`/...）是 `sync` 的薄包装，仅额外处理 `AbortSignal`/`timeoutMs`。配额超限（`QuotaExceededError`、Firefox 的 `NS_ERROR_DOM_QUOTA_REACHED`、旧版 DOM `code 22`/`1014`）被识别为 `QUOTA_EXCEEDED`，其余异常归一化为 `BACKEND_UNAVAILABLE`（原始异常保留在 `error.cause`）。

`dispose()` 只标记实例失效，不清空 `localStorage` 里的数据；跨标签页的 `storage` 事件不在本层暴露，订阅属于状态管理层职责。

### 2.2 `cookies()`

```ts
cookies(options?: ICookiesOptions): ISyncCapableStore<ICookieStore>
```

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `namespace` | `string` | `'default'` | 同上。 |
| `namespaceCodec` | `INamespaceCodec` | `lengthPrefixedNamespaceCodec` | 同上。 |
| `scope` | `ICookieScope` | `{ path: '/' }` | 固定作用域，构造后所有写入/删除都用同一份 `path`/`domain`/`sameSite`/`secure`/`partitioned`，不能按次覆盖。 |
| `document` | `{ cookie: string }` | `globalThis.document` | 注入点：测试环境或非 DOM 环境。 |

`scope` 在构造期严格校验：`path` 必须以 `/` 开头且不含 `;`；`domain` 不能含空白/`;`；`sameSite` 只能是 `'strict'|'lax'|'none'`；`sameSite: 'none'` 必须搭配 `secure: true`；`partitioned: true` 也必须搭配 `secure: true`。任何一条不满足都在 `cookies(...)` 调用时同步抛 `INVALID_ARGUMENT`，不会等到第一次 `set()` 才发现。

写入语义（`set(key, value, ctx?)`，`ctx` 可传 `expires: Date`、`maxAge: number`）：

- `maxAge <= 0` 或 `expires` 已过去 → 实际执行的是删除写入。
- 写入后会立即读回 `document.cookie` 校验可见性：如果写入值与读回值不一致，且该 key 名下确实有值可见（说明浏览器用了另一个未知的 scope），抛 `COOKIE_SCOPE_AMBIGUOUS`；如果读回完全不可见，抛 `WRITE_FAILED`。这两种情况都不是本包主动拒绝，而是浏览器 cookie 存储本身的隐式失败（超出浏览器自身的 cookie 数量上限、被扩展拦截等）在包装层显式暴露出来。
- 序列化后的 cookie 字符串（含所有属性）超过 4096 字节直接抛 `VALUE_TOO_LARGE`，不做截断。

`capabilities.opaqueEntries === true`：HttpOnly cookie 对 JS 不可见，`has()` 返回 `false` 不代表真的不存在，`remove()` 也不保证能删掉它。本后端**不处理服务端 cookie**——SSR 场景下，调用方应在服务端自行解析 `req.headers.cookie` 后注入到 `memoryStorage()`，不要指望 `cookies()` 在 Node 里工作。

不支持 L1（`records`/`transactions`/`iteration` 均为 `false`）。

### 2.3 `memoryStorage<TValue>()`

```ts
memoryStorage<TValue = unknown>(): ISyncCapableStore<IRecordStore<TValue>>
```

无参数——每次调用产出一个全新的、完全隔离的实例（内部是独立的 `Map`），因此不需要命名空间。同时实现 L0 + L1，`capabilities.maxValueBytes` 为 `undefined`（进程内内存，不设单值上限）。

- `getRecord`/`putRecord` 读写都做 `structuredClone` 隔离：拿到的对象与存储的对象不是同一引用，改动返回值不会污染存储，反之亦然。`structuredClone` 失败（例如值里含函数）抛 `SERIALIZE_FAILED`。
- 跨通道冲突检测同 [§1.6](#16-写入选项与冲突策略)。
- `transaction()`：草稿在独立 `Map` 上构建，提交前完全不碰真实数据；回调失败或提交前检测到 revision/epoch 变化时草稿直接丢弃，真实数据从未被触碰过（见 [§7](#7-事务与并发冲突检测)）。
- **没有 `metadata` 通道**：`entity.migrate()` 的断点续传只在 IndexedDB 上生效，`memoryStorage` 每次调用都会从头扫描（幂等，只是不会跳过已处理部分）。
- `dispose()` 清空全部三个 Map 并标记失效。

### 2.4 `indexedDb<TValue>()`

```ts
indexedDb<TValue = unknown>(options?: IIndexedDbOptions): IRecordStore<TValue>
```

| 选项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dbName` | `string` | `'storage-web'` | |
| `kvStoreName` | `string` | `'kv'` | L0 object store 名。 |
| `bytesStoreName` | `string` | `'bytes'` | |
| `recordsStoreName` | `string` | `'records'` | |
| `cleanupLegacyRecords` | `boolean` | `false` | 见下方「历史数据迁移」，破坏性发布动作。 |
| `factory` | `IDBFactory` | `globalThis.indexedDB` | 注入点：测试环境（jsdom 无原生 IndexedDB）需配合 `fake-indexeddb` 传入。 |
| `keyRange` | `typeof IDBKeyRange` | `globalThis.IDBKeyRange` | 注入点：同上，测试环境需与 `factory` 一起传。 |

三个 store 名（`kvStoreName`/`bytesStoreName`/`recordsStoreName`）必须互不相同，且不能与内部保留名（`__storage_web_revisions__`、`storage-web:meta`）冲突，否则构造期抛 `INVALID_ARGUMENT`。

**连接管理**：一个实例只 `open()` 一次，后续操作复用同一个连接 Promise；如果这次打开失败，缓存会被清掉，下次调用会重新尝试（不会把实例"毒死"）。不写死固定版本号：先按当前版本打开，发现缺少必需 object store 才升一版补建，这样即使同一个 `dbName` 已被别处用不同 `storeName` 建过库，也不会因为版本号冲突而失败。

**跨标签页协作**：

- `onblocked`（另一个标签页握着旧版本连接，导致这次升级被阻塞）→ 拒绝并抛 `BACKEND_UNAVAILABLE`。
- `onversionchange`（另一个上下文正在升级）→ 当前连接自动 `close()`，缓存失效，下次调用透明地重新打开，不需要调用方处理。

**历史数据迁移**：如果数据库里存在旧版（v1）的 `documents` object store，会在后台以 128 条/批的方式复制到当前 `recordsStoreName`，迁移状态 checkpoint 到内部 meta store（key: `migration:records-v1-to-v2`），可跨会话续传，**默认不删除旧 store**。只有显式传 `cleanupLegacyRecords: true` 且迁移状态已确认为 `complete`、目标 store 匹配时，才会在下一次打开时触发一次版本升级删除旧 `documents` store——这是需要在确认所有活跃客户端都已完成迁移、不再需要回滚旧版本后才在发布配置里打开的破坏性动作。

**Schema 版本保护**：内部维护一条 schema checkpoint 记录；如果打开一个已被"更新版本的本包"写过 schema 的数据库（记录的版本号大于当前包认识的版本），直接抛 `VERSION_UNSUPPORTED`，防止用旧版本代码错误解读新格式数据。

**写入可靠性**：所有写操作都等待 `transaction.oncomplete` 而非 `request.onsuccess`——后者只代表"请求被接受"，事务仍可能因配额超限、`commit` 失败或被 `abort` 而整体回滚；只有等到 `oncomplete` 才能确认真正落盘。

`getBytes()` 对读回值同时兼容 `Uint8Array` 视图和裸 `ArrayBuffer`（IndexedDB 的 structured clone 还原形态因实现而异），统一归一化为 `Uint8Array`。

无 `sync` 字段——IndexedDB 没有同步 API，不要对这个后端的返回值做 `store.sync` 判空以外的假设。

---

## 3. Entity / Repository 完整参考

```ts
import { defineEntity } from '@migaia/storage-web';
```

### 3.1 `defineEntity(options)`

```ts
type IEntityOptions<TDomain, TStored = TDomain> = {
  readonly name: string;
  readonly key: Extract<keyof TDomain, string>;
  readonly schema?: ISchemaAdapter<TDomain, TStored>;
  readonly codec?: ICodec<unknown, unknown>;
  readonly version?: number;
  readonly migrations?: Record<number, IMigration>;
  readonly validateOnRead?: boolean;
  readonly onDiagnostic?: (message: string) => void;
  readonly defaultOrderBy?: (left: TDomain, right: TDomain) => number;
};
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `name` | 必填 | 非空字符串，不能以 `__` 开头（保留前缀）。 |
| `key` | 必填 | 领域对象上作为主键的属性名。 |
| `schema` | `passthrough()` | 零校验直接透传。 |
| `codec` | 未显式提供时按后端类型选：结构化后端（IndexedDB/memory）默认 `structuredCodec`，KV-only 后端默认 `jsonCodec`。 | 显式配置的 codec 在所有后端上统一生效，经 `selectCodec` 按 `store.capabilities` 选路（见 [§5.3](#53-选路规则-selectcodec)），不会被结构化后端绕过。 |
| `version` | `1` | 正整数。 |
| `migrations` | — | `version > 1` 时必须提供，且键必须**恰好**覆盖 `2..version` 这段区间（缺一个都会在 `defineEntity()` 调用时抛 `INVALID_ARGUMENT`）。 |
| `validateOnRead` | `true` | 每次读取（含跨版本迁移后）都重新跑一次 `schema.validate()`——持久化数据会跨版本存活，读到脏数据比写入脏数据更常见。 |
| `onDiagnostic` | `console.warn` | 接收非致命提示（如"KV-only 后端上 list() 走全量扫描"）；处理函数自身抛错会被吞掉，不影响存储逻辑。 |
| `defaultOrderBy` | — | `list()`/`stream()` 未显式传 `orderBy` 时使用的默认排序。 |

`connect(store)` 在绑定时会校验 `store` 是否具备 `IKeyValueStore` 的最小方法/能力形状，不满足抛 `INVALID_ARGUMENT`。同一个 definition 可以 `connect()` 到多个后端，行为在两者上保持一致。

**存储信封**：每条记录物理存储为 `{ __v: number, data: <schema 输出> }`。读到的信封版本号大于当前 `version` 时抛 `VERSION_UNSUPPORTED`（防止代码回滚后读到更新版本写入的数据）；小于当前 `version` 时依次跑 `migrations[fromVersion+1..version]`（某个版本号缺失迁移函数视为该版本无数据形状变化，不是错误）。

写入管线：`schema.validate()` → `schema.normalize()`（默认恒等于 `validate` 之后的值）→ `schema.encode()`（默认恒等）→ `codec.encode()` → 落盘。
读取管线：`codec.decode()` → 解出信封 → 按版本号跑 `runMigrations()` → `schema.decode()`（默认恒等）→（`validateOnRead` 为真时）`schema.validate()`。

### 3.2 `IRepository<TDomain>` 方法参考

| 方法 | 参数类型 | 签名 | 同步/异步 | 说明 |
| --- | --- | --- | --- | --- |
| `get(id, ctx?)` | `id: IStorageKey`；`ctx?: IOperationContext` | `Promise<TDomain \| undefined>` | 异步 | |
| `put(value, ctx?)` | `value: TDomain`；`ctx?: IOperationContext` | `Promise<IStorageKey>` | 异步 | 返回值取自 `value[key]`；结构化后端上在一次 `transaction()` 内完成"写入新格式记录 + 删除该 id 可能存在的历史格式记录"，KV-only 后端只是一次 `store.set()`。 |
| `remove(id, ctx?)` | `id: IStorageKey`；`ctx?: IOperationContext` | `Promise<void>` | 异步 | 同时删除新旧两种物理 key 形态，避免历史遗留记录复活。 |
| `list(options?, ctx?)` | `options?: IListOptions<TDomain>`；`ctx?: IOperationContext` | `Promise<TDomain[]>` | 异步 | |
| `stream(options?, ctx?)` | `options?: IListOptions<TDomain>`；`ctx?: IOperationContext` | `AsyncIterableIterator<TDomain>` | 异步 | 惰性版本，语义与 `list()` 一致。 |
| `migrate(options?, ctx?)` | `options?: IMigrateOptions<TDomain>`；`ctx?: IOperationContext` | `Promise<IMigrateResult>` | 异步 | 见 [§3.3](#33-迁移-migrate)。 |
| `batch(run, ctx?)` | `run: (tx: IEntityTransactionScope<TDomain>) => Promise<T>`；`ctx?: IOperationContext` | `Promise<T>` | 异步 | 仅结构化后端支持（有真正的事务回滚）；KV-only 后端抛 `UNSUPPORTED_CAPABILITY`。 |

`IListOptions<TDomain>`：

```ts
{
  range?: IKeyRange;         // 作用于 id，不是物理 key
  limit?: number;            // 非负安全整数
  orderBy?: (a, b) => number; // 覆盖 defaultOrderBy
  onInvalid?: 'skip' | 'throw' | ((issue: IInvalidRecordIssue<TDomain>) => 'skip' | 'throw');
}
```

- `orderBy`（含 `defaultOrderBy`）一旦生效，`list()`/`stream()` 会先把匹配的记录**全部**读进内存排序，再应用 `limit`——放弃了流式/游标优势；数据量大时优先考虑不排序，或者用 `range` 缩小扫描范围。
- 结构化后端：按新版物理 key 前缀（`[__storage_web_entity_v2__, name, ...]`）扫描一次，再对尚未迁移的历史 `[name, id]` 形态记录做一次去重后的全库扫描兜底，两者合并保证旧数据在未运行 `migrate()` 前也不会被 `list()`/`stream()` 漏掉。
- KV-only 后端：没有前缀索引能力，`list()`/`stream()` 是对全部 key 的一次线性扫描 + 前缀过滤，数据量大时会明显变慢——第一次触发时会通过 `onDiagnostic` 报一次提醒，不是静默发生。

**无效记录处理**：解码/迁移/校验任一阶段失败会构造 `IInvalidRecordIssue{ key, raw, record?, stage, cause }`（`stage` 为 `'decode'|'migrate'|'validate'`）。默认策略 `'skip'`（跳过并触发一次诊断消息）；`'throw'` 会把这条记录的错误重新抛出（`DESERIALIZE_FAILED`/`MIGRATION_FAILED`/`VALIDATION_FAILED`，取决于 `stage`）中止整个 `list()`/`stream()`；也可以传一个函数逐条决定，函数本身抛错或返回值不是 `'skip'|'throw'` 会被归一化为 `VALIDATION_FAILED`。

### 3.3 迁移：`migrate()`

```ts
type IMigrateOptions<TDomain> = { batchSize?: number; onInvalid?: ... };
type IMigrateResult = {
  scanned: number; eligible: number; migrated: number;
  skipped: number; alreadyCurrent: number; conflicted: number;
};
```

`batchSize` 默认 `100`（正整数）；`onInvalid` 语义同 `list()`。

- **结构化后端上可断点续传**：迁移进度 checkpoint 到 `store.metadata`（key: `` repository:${name}:migration ``），仅当已有 checkpoint 的 `status === 'running'`、`version` 与 `schemaFingerprint`（由 `name`+`version`+`key`+`schema.name`+`codec.name`+排序后的迁移版本号列表拼成）都完全匹配时才会续用，否则视为一次全新迁移。**`memoryStorage` 没有 `metadata` 通道**，所以在它上面每次 `migrate()` 都会从头扫描——进程内重复调用是安全幂等的，只是不会跳过已处理部分。
- 结构化后端分两阶段扫描：先扫已是新版物理 key 但信封版本落后的记录（`'v2'` 阶段），再扫尚未迁移的历史 `[name, id]` 形态记录（`'legacy'` 阶段）。
- 每批在一次 `recordStore.transaction()` 内提交；如果整批因乐观并发冲突（见 [§7](#7-事务与并发冲突检测)）失败，会退化为逐条重试，重试中确认"目标已存在且版本不低于当前 version"的记录计入 `alreadyCurrent`，仍然冲突的计入 `conflicted`（不会抛错中止整个迁移，除非其他非冲突类错误发生）。
- KV-only 后端上没有断点续传，`migrate()` 本质是对每条记录重新 `put()` 一次以升级信封版本。

### 3.4 `batch()`：真正的事务

```ts
await repo.batch(async (tx) => {
  const user = await tx.get('u1');
  await tx.put({ ...user, credits: user.credits + 10 });
}, ctx);
```

只在结构化后端（`isRecordStore(store) === true`）可用，内部就是 `recordStore.transaction()` 的领域层包装；`tx.get/put/remove` 按领域 id 寻址，回调抛错或提交时检测到并发冲突都会让整批操作原子失败，不会留下部分写入。

---

## 4. Schema 扩展点

```ts
import { passthrough, fromStandardSchema, runMigrations } from '@migaia/storage-web';
import type { ISchemaAdapter, IStandardSchemaV1, IMigration, IMigrationContext } from '@migaia/storage-web';
```

```ts
type ISchemaAdapter<TDomain, TStored = TDomain> = {
  readonly name: string;
  validate(value: unknown, ctx?: IOperationContext): Promise<TDomain>;
  encode?(value: TDomain, ctx?: IOperationContext): Promise<TStored>;
  decode?(raw: TStored, ctx?: IOperationContext): Promise<TDomain>;
  normalize?(value: TDomain, ctx?: IOperationContext): Promise<TDomain>;
};
```

Schema 层面向开发者开放，不绑定任何校验库，也不强制使用。`encode`/`decode` 处理的是**领域表示**（例如 `Date` ↔ ISO 字符串、裁剪内部字段），与 [§5](#5-serialize--codec-扩展点) 处理的**存储格式**（对象 ↔ 字符串/字节）是两层不同的职责，不要混用。

- `passthrough<T>()`：默认值，`name: 'passthrough'`，`validate` 恒等返回，零依赖零开销。
- `fromStandardSchema(schema)`：适配任意实现 [Standard Schema](https://standardschema.dev) 规范的校验库（zod ≥3.24、valibot ≥1.0、arktype ≥2.0 均已实现该规范）；本包不 `import` 任何一家，也不把它们列为 peerDependency。`schema['~standard'].validate()` 返回的 `issues` 非空时，拼接所有 `message` 抛 `VALIDATION_FAILED`。
- `runMigrations(value, fromVersion, toVersion, migrations, signal?)`：按序执行声明的迁移函数；某个版本号缺失迁移函数视为该版本无数据形状变化（no-op），不是错误。`IMigration = (previous, ctx: IMigrationContext) => Promise<unknown>`，`ctx` 含 `fromVersion`/`toVersion`/可选 `signal`。单次调用内任何一步迁移函数抛错都归一化为 `MIGRATION_FAILED`（`signal` 触发的取消例外，原样抛 `ABORTED`）。`entity.migrate()`/`repository` 内部会对每条记录分别调用它，单条记录迁移失败不影响其他记录。

---

## 5. Serialize / Codec 扩展点

```ts
import { jsonCodec, structuredCodec, binaryCodec, selectCodec } from '@migaia/storage-web';
import type { ICodec, ICodecOutput, ISelectedCodec } from '@migaia/storage-web';
```

```ts
type ICodec<T = unknown, TRaw = string | Uint8Array | unknown> = {
  readonly name: string;
  readonly output: 'text' | 'binary' | 'structured';
  encode(value: T, ctx?: IOperationContext): Promise<TRaw>;
  decode(raw: TRaw, ctx?: IOperationContext): Promise<T>;
};
```

### 5.1 内置 codec

| Codec | `output` | 说明 |
| --- | --- | --- |
| `jsonCodec` | `'text'` | 默认、零依赖、全后端可用；`JSON.stringify`/`JSON.parse` 失败分别抛 `SERIALIZE_FAILED`/`DESERIALIZE_FAILED`。 |
| `structuredCodec` | `'structured'` | 不做任何序列化，原样交给后端的 structured clone（IndexedDB/`memoryStorage` 的 `structuredClone`）；可直接存 `Blob`/`File`/`ArrayBuffer`/`Map`/`Set`/`Date`，甚至循环引用。仅结构化后端可用。 |
| `binaryCodec` | `'binary'` | 调用方自带 `Uint8Array`，走 `setBytes` 通道；输入/输出不是 `Uint8Array` 分别抛 `SERIALIZE_FAILED`/`DESERIALIZE_FAILED`。 |

任何自定义编解码（压缩、加密、走 Worker 重编码）都通过实现同一个 `ICodec` 接口接入，本包不内置也不依赖它们。

### 5.2 选路规则：`selectCodec()`

```ts
selectCodec(codec, capabilities, onDiagnostic?): ISelectedCodec
```

1. `codec.output === 'structured'` 且后端 `capabilities.records !== true` → 直接抛 `UNSUPPORTED_CAPABILITY`（structured clone 能力如 `Blob`/`Map`/`Set`/循环引用无法用 JSON 表达，静默降级会丢数据，这里不做隐式转换）。
2. `codec.output === 'binary'` 且后端 `capabilities.binary !== true` → 自动包一层 base64 编解码降级（体积 +33%），并通过 `onDiagnostic` 报一次，不是静默发生。
3. 其余情况（`output` 与后端能力匹配）直连，不做包装。

`entity` 层的默认 codec 选择（结构化后端用 `structuredCodec`，KV-only 用 `jsonCodec`）正是为了绝大多数场景下避免触发第 1/2 条降级路径；显式传自定义 `codec` 时仍会经过这套选路规则校验。

---

## 6. 错误码完整参考

`StorageErrorCode` 导出以下 19 个稳定错误码，均可通过 `error.code` 分支处理；原始异常一律保留在 `error.cause`，不改写其 `message`：

```ts
import { StorageError, StorageErrorCode } from '@migaia/storage-web';

try {
  await store.set('key', 123 as unknown as string);
} catch (error) {
  if (error instanceof StorageError && error.code === StorageErrorCode.invalidArgument) {
    // ...
  }
}
```

| code | 触发场景 |
| --- | --- |
| `BACKEND_UNAVAILABLE` | 隐私模式探测失败、`localStorage`/`indexedDB`/`document` 全局不存在、IndexedDB `onblocked`。 |
| `QUOTA_EXCEEDED` | Web Storage/IndexedDB 写入触发浏览器存储配额限制。 |
| `VALUE_TOO_LARGE` | cookie 序列化后超过 4096 字节。 |
| `UNSUPPORTED_CAPABILITY` | `asRecordStore()` 收窄失败；`structuredCodec` 用在 text-only 后端；`repository.batch()` 用在 KV-only 后端。 |
| `SERIALIZE_FAILED` | `JSON.stringify` 抛错；`binaryCodec.encode` 收到非 `Uint8Array`；`memoryStorage` 的 `structuredClone` 写入失败。 |
| `DESERIALIZE_FAILED` | `JSON.parse` 抛错；信封结构不合法；`binaryCodec.decode` 收到非 `Uint8Array`；entity 解码阶段且 `onInvalid: 'throw'`。 |
| `VALIDATION_FAILED` | `schema.validate()` 抛错；Standard Schema 返回非空 `issues`；entity 校验阶段且 `onInvalid: 'throw'`。 |
| `MIGRATION_FAILED` | 某个 `IMigration` 函数抛错；entity 迁移阶段且 `onInvalid: 'throw'`。 |
| `TRANSACTION_FAILED` | IndexedDB 事务创建/提交失败；`transaction()` 回调抛出非 `StorageError` 异常。 |
| `ABORTED` | `signal` 已中止或 `timeoutMs` 到期。 |
| `STORE_DISPOSED` | `dispose()` 之后继续调用任何方法。 |
| `DUPLICATE_KEY` | 结构化后端上跨通道（value/bytes/record）写入冲突且 `conflictPolicy` 非 `'replace'`。 |
| `INVALID_ARGUMENT` | 构造期非法选项；`set()` 传非字符串；`setBytes()` 传非 `Uint8Array`；`list`/`migrate` 选项形状错误等。 |
| `INVALID_KEY` | `IStorageKey` 不满足结构域约束（类型、深度、节点数、二进制长度、循环引用）。 |
| `VERSION_UNSUPPORTED` | 读到的 entity 信封或 IndexedDB schema 版本号比当前代码认识的更新。 |
| `EXTENSION_FAILED` | schema/codec/namespaceCodec 扩展函数抛出未归一化的异常（兜底分类）。 |
| `TRANSACTION_CONFLICT` | `transaction()` 提交时检测到读过的记录版本或全局 epoch 已变化（见 [§7](#7-事务与并发冲突检测)）。 |
| `WRITE_FAILED` | cookie 写入后回读发现完全不可见。 |
| `COOKIE_SCOPE_AMBIGUOUS` | cookie 写入后回读发现该 key 名下有值可见，但来自另一个未知 scope。 |

`IStorageErrorDetails` 携带的上下文字段：`backend`、`key`、`existingChannel`/`attemptedChannel`（`'value'|'bytes'|'record'`，跨通道冲突时填充）、`extensionStage`（`'schema'|'codec'|'migration'|'comparator'|'diagnostic'`）、`operation`、`cause`。`StorageError` 实例构造后会 `Object.freeze`，不能被应用代码事后修改。

---

## 7. 事务与并发冲突检测

`memoryStorage`/`indexedDb` 的 `transaction(run, ctx?)` 采用"隔离草稿 + 提交时校验"模型：

```ts
await store.transaction(async (tx) => {
  const current = await tx.get('counter');
  await tx.put((current ?? 0) + 1, 'counter');
});
```

1. 回调执行期间，`tx.get/put/delete` 只读写一份内存中的隔离草稿（IndexedDB 上还会记录本次读取时的 revision 快照），完全不触碰真实数据——这样回调失败时不需要"回滚"，草稿直接丢弃即可，真实数据从未被动过。
2. 回调返回后，会重新核对：草稿里读取过的每个 key 的 revision 是否仍与快照时一致，以及全局 record epoch（被 `clearRecords()`/`clearAll()` 递增）是否变化。任一项不一致，说明提交前有其他并发写入影响了这次事务读到的数据，直接抛 `TRANSACTION_CONFLICT`，草稿整体丢弃。
3. 校验通过才会把草稿合并进真实存储，一次性完成，不会出现"写了一半"的中间状态。

**只有 `transaction()` 内的读写才参与冲突检测**——单独调用 `store.putRecord()`/`store.setBytes()` 等方法是后写覆盖前写（last-write-wins），不会因为并发写入而报错；需要"读-改-写"原子性时必须用 `transaction()`。

**Scope 生命周期**：`tx` 只在回调 pending 期间有效；回调完成（无论成功失败）之后再调用 `tx.get/put/delete` 会抛 `TRANSACTION_FAILED`——不要把 `tx` 引用逃逸出回调异步保存起来后再用。

---

## 8. 取消与超时

所有公开方法的最后一个可选参数都是 `IOperationContext`：

```ts
type IOperationContext = { signal?: AbortSignal; timeoutMs?: number; pageSize?: number };
```

- `signal`：协作式取消。后端内部实现可以忽略它，但调用方一定会以 `ABORTED` 结束等待。
- `timeoutMs`：便捷超时，内部会合成一个新的 `AbortSignal`；与外部传入的 `signal` 同时存在时取先触发者。`timeoutMs: 0` 会立即中止（常用于测试"这个操作是否会尊重取消"这一行为本身）。
- `pageSize`：仅 `iterateRecords()`/`list()`/`stream()` 相关路径使用，必须是 `1`–`4096` 之间的整数，否则抛 `INVALID_ARGUMENT`；IndexedDB 游标分页默认 128。

写操作额外接受 `conflictPolicy?: 'conflict' | 'replace'`（默认 `'conflict'`），非法值同样抛 `INVALID_ARGUMENT`。

---

## 9. 生命周期与资源释放

每个后端工厂返回的实例都必须在不再使用时调用 `dispose()`：

```ts
await store.dispose();
```

- **不清空数据**：`dispose()` 只是让这个 JS 实例失效（之后任何方法调用抛 `STORE_DISPOSED`），底层的 `localStorage`/cookie/IndexedDB 数据原样保留。要清空数据用 `clearValues()`/`clearAll()`。
- IndexedDB 的 `dispose()` 会尽力关闭底层连接（`IDBDatabase.close()`），关闭失败（连接已废弃或仍在打开中）会被静默吞掉——`dispose()` 是尽力而为语义，不代表"连接一定已物理关闭"。
- `memoryStorage`/`indexedDb` 的 `entity.batch()`/`transaction()` 一旦拿到 `tx`，必须在回调同步返回前用完，见 [§7](#7-事务与并发冲突检测) 的 scope 生命周期约束。
- 不要在模块顶层直接访问 `localStorage`/`document`/`indexedDB` 等全局对象——隐私模式或非浏览器环境下这些全局可能不存在或访问即抛异常；工厂函数内部已做探测并转换成 `BACKEND_UNAVAILABLE`，但只有在调用工厂函数（而不是模块加载）时才会触发。

---

## 10. 与 `@migaia/store-persist` 的关系

`@migaia/store-persist` 直接消费本包的 `IKeyValueStore`（含 `capabilities`/`getBytes`/`setBytes`）与 `ICodec`/`selectCodec`，不再需要一层适配函数——依赖方向是 store-persist 指向本包（编排层依赖存储原语层），本包不 import 也不知道 store-persist 的存在。历史上这里曾有 `toStoreAdapter()`/`toBinaryStoreAdapter()` 两个结构适配函数，随 store-persist 改为直接消费本包契约后已移除。

---

## 11. 完整生产示例

IndexedDB + entity + Standard Schema 校验 + 版本迁移 + 无效记录处理 + 真实事务：

```ts
import { indexedDb, defineEntity, fromStandardSchema } from '@migaia/storage-web';
import { z } from 'zod'; // 任意实现 Standard Schema 的库

const UserSchemaV2 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  credits: z.number().int().nonnegative()
});

type IUser = z.infer<typeof UserSchemaV2>;

const users = defineEntity<IUser>({
  name: 'users',
  key: 'id',
  version: 2,
  schema: fromStandardSchema(UserSchemaV2),
  migrations: {
    // v1 记录没有 credits 字段，迁移时补默认值
    2: async (previous) => ({ ...(previous as object), credits: 0 })
  },
  onDiagnostic: (message) => console.warn(message)
});

const store = indexedDb({ dbName: 'app-db' });
const repo = users.connect(store);

await repo.put({ id: 'u1', name: 'Ada', email: 'ada@example.com', credits: 10 });

// 原子地给一个用户加积分，失败自动重试由调用方决定
try {
  await repo.batch(async (tx) => {
    const user = await tx.get('u1');
    if (!user) throw new Error('user not found');
    await tx.put({ ...user, credits: user.credits + 5 });
  });
} catch (error) {
  console.error('batch update failed', error);
}

// 把旧版本残留数据批量升级到 v2，遇到损坏记录跳过而不是中止整个迁移
const result = await repo.migrate({
  batchSize: 200,
  onInvalid: (issue) => {
    console.warn(`skip invalid user record ${String(issue.key)}: ${issue.stage}`);
    return 'skip';
  }
});
console.log(result); // { scanned, eligible, migrated, skipped, alreadyCurrent, conflicted }

await store.dispose();
```

---

## 12. 常见问题排查

**Q：`set()` 抛 `INVALID_ARGUMENT`，消息里说 "storage value must be a string"。**
L0 `set()` 只接受字符串。要存对象，要么自己 `JSON.stringify()`，要么用 `entity` + `schema`/`codec` 组合让本包替你处理序列化。

**Q：Worker 里 `import` 报 "Cannot find name 'Storage'"。**
检查 `tsconfig.json` 的 `lib` 是否是 `WebWorker`（无 DOM）却引用了需要 DOM `Storage` 类型的路径；`IWebStorageLike`（`src/types/storage.ts`）正是为规避这个真实踩过的坑而存在的结构等价类型，复现场景见 `fixtures/consumers/tsconfig.worker.json`。

**Q：先 `set('k', v)` 又 `setBytes('k', bytes)`，报 `DUPLICATE_KEY`。**
跨通道（value/bytes/record）默认互斥；只有 `memoryStorage`/`indexedDb` 会出现这个问题（因为只有它们有多通道）。需要覆盖时显式传 `{ conflictPolicy: 'replace' }`。

**Q：`cookies({ scope: { sameSite: 'none' } })` 构造就抛错。**
`SameSite=None` 必须搭配 `secure: true`，否则在构造期就会被拒绝，不会等到写入才失败。

**Q：`entity.list()` 在 `localStorage()` 后端上明显变慢。**
KV-only 后端上 `list()`/`stream()`/`migrate()` 是全量键扫描，数据量大时线性变慢；会通过 `onDiagnostic` 报一次提醒，不是静默发生。数据量会持续增长时优先换 `indexedDb()`/`memoryStorage()`。

**Q：`entity.migrate()` 重复调用后 `scanned` 又从 0 开始，没有跳过已处理部分。**
先确认是不是 `memoryStorage()`——它没有 `metadata` 通道，天然不支持断点续传（每次都会全量重扫，幂等但不省时间）。如果是 `indexedDb()`，检查 `name`/`version`/`key`/`schema.name`/`codec.name`/`migrations` 版本号列表有没有变化——任何一项变化都会让 checkpoint 的 `schemaFingerprint` 失配，从而重新开始。

**Q：`putRecord(value)` 没传 `key`，拿到一个看起来随机的 `IStorageKey`。**
不显式传 `key` 时用 `crypto.randomUUID()` 自动生成（不支持该 API 的环境退化为时间戳+随机数拼接）。需要有业务含义的主键（比如用户 id），必须显式传第二个参数。

**Q：`repository.batch()` 抛 `UNSUPPORTED_CAPABILITY`。**
`batch()` 需要真正的事务回滚能力，只在结构化后端（`indexedDb()`/`memoryStorage()`）可用；KV-only 后端（`localStorage`/`sessionStorage`/`cookies`）没有对应能力，改用逐条 `get`/`put` 并自行处理失败补偿。

**Q：`transaction()` 回调里拿到的对象改了之后，再读一次发现没生效。**
`tx.get`/`tx.put` 的输入输出都会做结构化克隆隔离，拿到的是拷贝而不是存储内部引用；修改返回值不会影响已存储的数据，也不会污染其他并发读者看到的快照——需要持久化改动必须显式 `tx.put()`。
