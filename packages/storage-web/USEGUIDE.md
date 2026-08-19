# `@migaia/storage-web` 使用指南

本指南逐个模块列出全部导出 API 的完整签名、参数语义、默认值、边界行为与错误码。包的定位、适用场景与 5 分钟上手见 [README](./README.md)。

## 目录

- [`localStorage` / `sessionStorage` 模块](#web-storage-模块)
- [`cookies` 模块](#cookies-模块)
- [`indexedDb` 模块](#indexeddb-模块)
- [`memoryStorage` 模块](#memorystorage-模块)
- [契约与能力模块](#契约与能力模块)
- [序列化（codec）模块](#序列化-codec-模块)
- [Schema 模块](#schema-模块)
- [Entity 模块](#entity-模块)
- [错误模块](#错误模块)
- [组合工作流示例](#组合工作流示例)
- [排查与构建门禁](#排查与构建门禁)

包导出面分两个入口：

```ts
// 主入口：含 DOM 后端（localStorage/sessionStorage/cookies/indexedDb）+ memoryStorage + 全部扩展点
import {
  localStorage,
  indexedDb,
  memoryStorage,
  defineEntity /* ... */
} from '@migaia/storage-web';

// DOM-free 子路径：只有 memoryStorage，SSR/Node/Worker 环境用，不引入 DOM/IDB 类型
import { memoryStorage } from '@migaia/storage-web/memory';
```

`package.json` 的 `exports` 只声明 `.` 与 `./memory` 两个子路径，其余源码目录（`backends/`、`core/`、`entity/` 等）不是公开导入点。

---

<a id="web-storage-模块"></a>

## `localStorage` / `sessionStorage` 模块

源码：`src/backends/local-storage.ts`、`src/backends/session-storage.ts`、`src/backends/web-storage.ts`。两者共享同一个 `createWebStorageBackend` 实现，仅注入不同的宿主 `Storage` 对象。

### `localStorage`

```ts
function localStorage(options?: ILocalStorageOptions): ISyncCapableStore<IKeyValueStore>;

type ILocalStorageOptions = IWebStorageOptions & {
  readonly storage?: IWebStorageLike;
};
type IWebStorageOptions = {
  readonly namespace?: string;
  readonly namespaceCodec?: INamespaceCodec;
};
```

- `namespace?: string` —— 默认 `'default'`。构造期校验：必须是非空字符串，否则抛 `StorageError(INVALID_CONFIG)`。同命名空间内的 `keys()`/`clearValues()`/`clearAll()` 互相隔离，不同命名空间的同名 key 互不影响。
- `namespaceCodec?: INamespaceCodec` —— 默认 `lengthPrefixedNamespaceCodec`（见[契约与能力模块](#契约与能力模块)）。构造期用 `snapshotNamespaceCodec` 校验 `encode`/`decode` 均为函数，否则抛 `INVALID_CONFIG`。
- `storage?: IWebStorageLike` —— 注入点，默认 `globalThis.localStorage`。传入的对象必须实现 `getItem`/`setItem`/`removeItem`/`key`/`clear` 方法与 `length: number`（非负安全整数），否则抛 `INVALID_CONFIG`；读取 `options.storage` 本身抛错（例如 getter 抛异常）也会被捕获并归一化为 `INVALID_CONFIG`。

`IWebStorageLike`：

```ts
type IWebStorageLike = {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
};
```

**构造期探测**：`createWebStorageBackend` 在返回 store 前，会用 `probeWebStorage` 真实写一次探测 key（`namespacedKey(namespace, '__probe__', ...)`）再删除/还原。Safari 隐私模式下 `localStorage` 对象存在但 `setItem` 抛异常（旧版本 `SecurityError`，新版本 quota=0 的 `QuotaExceededError`），只有真实写入才能可靠探测到这种情况；探测失败立即抛 `StorageError(BACKEND_UNAVAILABLE)`，而不是等到第一次业务写入才发现。若探测 key 原本已存在非空值，探测会退避到一个带时间戳/随机数后缀的临时 key，避免覆盖调用方数据。

**能力**（`store.capabilities`，`Object.freeze` 恒定值）：

```ts
{
  syncRead: true,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  maxValueBytes: 5 * 1024 * 1024, // 近似上限，不是精确配额
  opaqueEntries: false
}
```

**返回类型**：`ISyncCapableStore<IKeyValueStore>`，即 `IKeyValueStore` 且 `sync` 字段恒非 `undefined`。所有异步方法（`get`/`set`/`remove`/`has`/`keys`/`clearValues`/`clearAll`/`dispose`）都是对应 `sync.*` 方法的 `withAbort` 包装——先检查 `ctx?.signal`/`ctx?.timeoutMs` 是否已经触发取消，未取消再同步调用底层实现，因此本质上不是"真异步"，只是返回 `Promise`。

`sync` 通道方法：

```ts
type ISyncKeyValueStore = {
  get(key: string): string | null;
  set(key: string, value: string, options?: ISyncWriteOptions): void; // { conflictPolicy? }
  remove(key: string): void;
  has(key: string): boolean;
  keys(): string[];
  clearValues(): void;
};
```

- `get(key)`：物理 key 不存在返回 `null`。宿主 `getItem` 抛错（例如配额/隐私模式变化）经 `normalizeStorageException` 归一化：quota 类异常 → `QUOTA_EXCEEDED`，其余 → `BACKEND_UNAVAILABLE`。
- `set(key, value, options?)`：`value` 必须是 `string`，否则抛 `INVALID_CONFIG`（不做隐式 `String()` 转换）。写入失败按上文规则归一化异常。
- `remove(key)`：物理 key 不存在时静默成功（幂等）。
- `has(key)`：等价于 `getItem(...) !== null`。
- `keys()`：枚举该命名空间下全部逻辑键。内部会校验宿主 `length` 是否为非负安全整数、`key(index)` 是否恒返回 `string`、以及是否出现重复物理 key（宿主枚举违反契约或并发不一致时抛 `TypeError`，非归一化 `StorageError`——这是防御性断言，属于宿主契约违规而非正常错误路径）。
- `clearValues()`：只删除该命名空间下的键；先拍一份稳定的物理键快照再逐个删除，若中途某个 `removeItem` 抛错，会带上该键的 `logicalKey` 抛出，暴露精确的部分失败边界。

异步专有方法：

- `clearAll(ctx?)`：与 `clearValues` 等价（本后端没有独立于命名空间之外的额外数据）。
- `dispose()`：仅置位内部 `disposed` 标志；此后任何方法调用抛 `StorageContractError(STORE_DISPOSED)`。不清空宿主存储数据。

**5 秒可运行示例**：

```ts
import { localStorage } from '@migaia/storage-web';

const store = localStorage({ namespace: 'settings' });
await store.set('theme', 'dark');
console.log(await store.get('theme')); // 'dark'
store.sync.set('theme', 'light'); // 同步 API，Web Storage 天然同步
console.log(store.sync.get('theme')); // 'light'
await store.remove('theme');
console.log(await store.has('theme')); // false
await store.dispose();
```

### `sessionStorage`

```ts
function sessionStorage(options?: ISessionStorageOptions): ISyncCapableStore<IKeyValueStore>;

type ISessionStorageOptions = IWebStorageOptions & {
  readonly storage?: IWebStorageLike;
};
```

选项与行为与 `localStorage` **完全一致**，唯一区别是默认注入 `globalThis.sessionStorage` 而非 `globalThis.localStorage`；`backend` 字段为 `'session'`。

```ts
import { sessionStorage } from '@migaia/storage-web';

const store = sessionStorage({ storage: myFakeStorage }); // 测试环境注入
await store.set('draft', JSON.stringify({ step: 1 }));
```

---

<a id="cookies-模块"></a>

## `cookies` 模块

源码：`src/backends/cookie.ts`。基于 `document.cookie` 的读写封装，不处理服务端 cookie（SSR 场景由调用方在服务端自行解析 `req.headers.cookie` 后注入 `memoryStorage`）。

```ts
function cookies(options?: ICookiesOptions): ISyncCapableStore<ICookieStore>;

type ICookiesOptions = {
  readonly namespace?: string;
  readonly namespaceCodec?: INamespaceCodec;
  readonly scope?: ICookieScope;
  readonly document?: ICookieDocument; // { cookie: string }
};

type ICookieScope = {
  readonly path?: string;
  readonly domain?: string;
  readonly sameSite?: 'strict' | 'lax' | 'none';
  readonly secure?: boolean;
  readonly partitioned?: boolean;
};
```

### 构造期校验

- `options` 本身必须是对象（非 `null`/数组），否则抛 `INVALID_CONFIG`。
- `namespace` 默认 `'default'`，必须是非空字符串。
- `namespaceCodec` 默认 `lengthPrefixedNamespaceCodec`。
- `scope`（**构造期固定，写入与删除全程复用同一 scope，运行期不可更改**）：
  - `path?: string` —— 默认 `'/'`；必须以 `/` 开头且不含 `;`，否则抛 `INVALID_CONFIG`。
  - `domain?: string` —— 非空且不含空白/`;`，否则抛 `INVALID_CONFIG`。
  - `sameSite?: 'strict' | 'lax' | 'none'` —— `'none'` 必须同时 `secure: true`，否则抛 `INVALID_CONFIG`（“SameSite=None requires Secure”）。
  - `secure?: boolean`。
  - `partitioned?: boolean` —— 为 `true` 必须同时 `secure: true`，否则抛 `INVALID_CONFIG`（“Partitioned requires Secure”）。
  - 未传 `scope` 时默认 `{ path: '/' }`。
- `document?: ICookieDocument`（结构 `{ cookie: string }`）—— 默认 `globalThis.document`；缺失（如非浏览器环境且未注入）抛 `BACKEND_UNAVAILABLE`；存在但不是对象、或 `.cookie` 不是字符串，抛 `INVALID_CONFIG`。构造期会立即读取一次 `document.cookie` 完成这项校验。

### 读写方法

```ts
type ICookieStore = Omit<IKeyValueStore, 'set' | 'remove' | 'sync'> & {
  set(key: string, value: string, ctx?: ICookieWriteContext): Promise<void>;
  remove(key: string, ctx?: ICookieRemoveContext): Promise<void>;
  readonly sync?: ISyncCookieStore;
};

type ICookieWriteContext = {
  readonly signal?: IAbortSignal;
  readonly timeoutMs?: number;
  readonly expires?: Date;
  readonly maxAge?: number;
};
type ICookieRemoveContext = {
  readonly signal?: IAbortSignal;
  readonly timeoutMs?: number;
};

type ISyncCookieStore = {
  get(key: string): string | null;
  set(
    key: string,
    value: string,
    ctx?: { readonly expires?: Date; readonly maxAge?: number } & ISyncWriteOptions
  ): void;
  remove(key: string): void;
  has(key: string): boolean;
  keys(): string[];
  clearValues(): void;
};
```

- `get(key, ctx?)` / `sync.get(key)`：返回该命名空间下唯一可见的值，找不到返回 `null`。若同一物理 cookie 名同时被多个 scope 写入、导致 `document.cookie` 中出现重复同名条目，抛 `StorageError(COOKIE_SCOPE_AMBIGUOUS)`——**不会**随意返回其中一个，因为无法确定归属。
- `set(key, value, ctx?)`：
  - `value` 必须是 `string`，否则抛 `INVALID_CONFIG`。
  - `ctx.maxAge` 必须是安全整数（若提供），否则抛 `INVALID_CONFIG`；`maxAge <= 0` 立即写入删除态（等价于 `remove`）。
  - `ctx.expires` 必须是合法 `Date`（若提供），否则抛 `INVALID_CONFIG`；`expires` 早于或等于当前时间同样立即写入删除态。
  - 写入后会**回读校验**：写入后立刻用 `readVisibleCookie` 检查该值是否真的可见。
    - 删除态且回读不可见 → 视为成功（正常删除路径）。
    - 非删除态且回读值等于写入值 → 成功返回。
    - 回读到某个值但不等于写入值 → 说明同名 cookie 在另一个不可控 scope 下仍可见，抛 `COOKIE_SCOPE_AMBIGUOUS`。
    - 回读不到任何值（非删除态）→ 说明浏览器静默拒绝了这次写入（容量、隐私策略等），抛 `StorageError(WRITE_FAILED)`。
  - 单条 cookie 序列化后（含全部属性字符串）超过 4096 字节，`serializeCookieAssignment` 会抛 `StorageError(VALUE_TOO_LARGE)`；库不做静默截断。
  - `sync.set` 接受 `expires`/`maxAge`/`conflictPolicy`，**不接受** `signal`/`timeoutMs`（同步调用无法取消）。
- `remove(key, ctx?)` / `sync.remove(key)`：写入删除态 cookie（空值 + 过去的 `expires`）。删除前会先做一次 `readVisibleCookie` 探测（用于后续诊断路径），但**不保证真的生效**——见下方 `opaqueEntries` 说明。
- `has(key, ctx?)` / `sync.has(key)`：等价于 `get(key) !== null`；同名多 scope 同样会抛 `COOKIE_SCOPE_AMBIGUOUS`。
- `keys(ctx?)` / `sync.keys()`：枚举该命名空间下全部逻辑键；解析 `document.cookie` 时若同一物理名重复出现，抛 `COOKIE_SCOPE_AMBIGUOUS`。
- `clearValues(ctx?)` / `clearAll(ctx?)`：先拍摄稳定的物理键快照，再逐个写删除态；`clearValues`/`clearAll` 在本后端语义等价（无跨命名空间数据）。
- `dispose()`：仅置位 `disposed`，不清空 cookie。

### 能力

```ts
{
  syncRead: true,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  maxValueBytes: 4096,
  opaqueEntries: true
}
```

`opaqueEntries: true` 是**硬承诺**：HttpOnly cookie 对 JS 完全不可见——`has()` 返回 `false` 不代表该 cookie 不存在，`remove()` 也不保证使其失效（HttpOnly cookie 只能由服务端 `Set-Cookie` 清除）。

**5 秒可运行示例**：

```ts
import { cookies } from '@migaia/storage-web';

const jar = cookies({ namespace: 'app', scope: { path: '/', secure: true, sameSite: 'lax' } });
await jar.set('session', 'abc123', { maxAge: 3600 });
console.log(await jar.get('session')); // 'abc123'
await jar.remove('session');
console.log(await jar.get('session')); // null
```

---

<a id="indexeddb-模块"></a>

## `indexedDb` 模块

源码：`src/backends/indexed-db.ts`。是本包中唯一原生支持字节（bytes）、记录（record，structured clone）、事务（transaction）与游标迭代（iteration）的浏览器后端。实现体量最大，下面按选项、生命周期、能力、L0/L1 方法、事务、迭代分别展开。

```ts
function indexedDb<TValue = unknown>(options?: IIndexedDbOptions): IRecordStore<TValue>;

type IIndexedDbOptions = {
  readonly dbName?: string;
  readonly kvStoreName?: string;
  readonly bytesStoreName?: string;
  readonly recordsStoreName?: string;
  readonly cleanupLegacyRecords?: boolean;
  readonly factory?: IDBFactory;
  readonly keyRange?: typeof IDBKeyRange;
};
```

### 构造期选项校验

- `dbName?: string` —— 默认 `'storage-web'`。
- `kvStoreName?: string` —— 默认 `'kv'`。
- `bytesStoreName?: string` —— 默认 `'bytes'`。
- `recordsStoreName?: string` —— 默认 `'records'`。
- 以上四个名称必须非空字符串；三个 object store 名（`kvStoreName`/`bytesStoreName`/`recordsStoreName`）必须**互不相同**，且不能撞上内部保留名 `__storage_web_revisions__`（revisions store）与 `storage-web:meta`（meta store），否则抛 `INVALID_CONFIG`。
- `cleanupLegacyRecords?: boolean` —— 默认 `false`；必须是 `boolean`，否则抛 `INVALID_CONFIG`。为 `true` 时，会在确认历史 `documents` object store 已完整迁移到 `recordsStoreName`（即元数据记录 `status: 'complete'` 且 `to === recordsStoreName`）后，在下一次数据库版本升级中真正删除旧 store。只应在确认没有客户端仍需要回滚到旧版本代码时开启。
- `factory?: IDBFactory` —— 测试/非浏览器环境注入点，默认 `globalThis.indexedDB`。缺失抛 `BACKEND_UNAVAILABLE`；存在但不提供 `open()` 方法抛 `INVALID_CONFIG`。
- `keyRange?: typeof IDBKeyRange` —— 默认 `globalThis.IDBKeyRange`。jsdom 完全不提供原生 IndexedDB，测试环境**必须**和 `factory` 一起从 `fake-indexeddb` 显式传入；提供了但缺 `bound`/`lowerBound`/`upperBound` 静态方法会抛 `INVALID_CONFIG`。仅在真正需要按 range 查询（`iterateRecords`/`list`/`stream` 带 `range`，或恢复历史迁移游标）时才会被解引用；未提供 `keyRange` 时无 range 的调用仍可正常工作，一旦调用方传了 range 才会因缺失 `IDBKeyRange` 抛 `BACKEND_UNAVAILABLE`。

### 连接管理与 schema

- **只开一次库，之后所有操作复用同一个连接**（`connection` 是一个惰性初始化并缓存的 Promise）。开库失败会清空缓存以便下次重连，避免一次瞬时故障（例如另一个标签页正卡在旧版本升级上）永久拖死这个实例。
- 不写死固定版本号打开：同一个 `dbName` 可能已被其他实例用不同的 store 名建过库，硬编码 `version 1` 不会触发 `upgradeneeded`，之后对缺失 store 的 `transaction()` 会直接抛 `NotFoundError`。实际策略是先按当前版本打开，发现缺少任一必需 store（`kvStoreName`/`recordsStoreName`/`bytesStoreName`/revisions/meta）再升一版补建。
- `onversionchange`：当另一个标签页请求升级时，当前连接会主动 `close()` 让路，并清空内部缓存，避免对方一直被 `blocked`。
- `onblocked`（升级请求被现有连接阻塞）会让 `open()` 的 Promise 以 `BACKEND_UNAVAILABLE` reject。
- 内部维护 schema 版本（源码常量 `CURRENT_SCHEMA_VERSION = 2`），存储在 `meta` store 的 `'schema'` key 下。若读到的持久化 schema 版本号**高于**当前代码所知版本，抛 `StorageError(VERSION_UNSUPPORTED)`（防止旧代码误读/覆盖新版本数据）。
- **历史迁移**：v1 曾用名为 `documents` 的 object store 存记录；`open()` 会检测该 store 是否存在，若存在且尚未完整迁移，以 `128` 条为一批、可断点续跑地把数据搬到 `recordsStoreName`（迁移进度写入 meta store 的 `'migration:records-v1-to-v2'` key，包含 `status`/`lastKey`）。`cleanupLegacyRecords: true` 时，确认迁移完成后触发一次额外的版本升级来 `deleteObjectStore('documents')`。

### 能力

```ts
{
  syncRead: false,   // IndexedDB 无同步 API
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  maxValueBytes: undefined, // 受磁盘配额约束，无单值硬上限
  opaqueEntries: false
}
```

返回值没有 `sync` 字段（`undefined`）。

### L0（值）方法

`get`/`set`/`remove`/`has`/`keys`/`clearValues`/`clearAll`/`dispose` 语义与 `IKeyValueStore` 基本契约一致，均异步、经由 IndexedDB 的 `kvStoreName` object store：

- `get(key, ctx?)`：`key` 必须是 `string`（`assertStringStorageKey`），否则契约级 `INVALID_ARGUMENT`。读操作等一次 `readonly` 事务的请求结果与事务 `oncomplete` 同时满足才返回。
- `set(key, value, ctx?)`：`value` 必须是 `string`。写入通过 `writeWithConflict('value', ...)`：会先在同一 `readwrite` 事务内查询 `kvStoreName`/`bytesStoreName`/`recordsStoreName` 是否已存在同一逻辑 key，据此应用跨通道冲突策略（见[契约与能力模块](#契约与能力模块)的 `ConflictPolicy`），再写入并**等事务真正 `oncomplete`** 才 resolve——`request.onsuccess` 只代表请求被接受，事务仍可能因配额超限或被 abort 而整体回滚，因此源码专门等 commit 而非单条请求成功。
- `remove(key, ctx?)`：删除 `kvStoreName` 中该 key；等事务 commit。
- `has(key, ctx?)`：等价于 `get(key) !== null`（内部读同一份数据）。
- `keys(ctx?)`：全表读取 `kvStoreName.getAllKeys()`，逐个用 `assertStringStorageKey` 校验类型（IndexedDB 理论上允许非字符串键，但本包的 L0 契约要求字符串）。
- `clearValues(ctx?)`：清空 `kvStoreName`。
- `clearAll(ctx?)`：**同一事务**内清空 `kvStoreName`/`bytesStoreName`/`recordsStoreName`，并把内部 `RECORD_EPOCH_KEY`（记录 epoch 计数器）自增——这一步让所有正在进行中、已经读取过任意记录的事务在提交时因 epoch 不匹配而失败，防止“清库”与“并发事务”交错产生幽灵写入。
- `dispose()`：置位 `disposed`；尽力关闭当前连接（无论其处于 pending 还是已建立状态），失败静默吞掉（dispose 是 best-effort）。

### L1（字节）方法

- `getBytes(key, ctx?)`：从 `bytesStoreName` 读取。IndexedDB 的 structured clone 可能把写入的 `Uint8Array` 还原为 `ArrayBuffer`（取决于实现），源码同时处理两种还原形态（`isByteView`/`isRawArrayBuffer`，用跨 realm 安全的 `ArrayBuffer.isView`/`intrinsicConstructorName` 而非 `instanceof`，因为 fake-indexeddb 与 jsdom 在测试环境下是不同 realm）。不存在返回 `null`。
- `setBytes(key, value, ctx?)`：`value` 必须是 `Uint8Array`（`isUint8Array`），否则抛 `INVALID_CONFIG`。写入前会 `.slice()` 出一份独立副本再走 `writeWithConflict('bytes', ...)`，避免调用方在异步边界之外继续修改同一份底层缓冲区。
- `clearBytes(ctx?)`：清空 `bytesStoreName`。

### L1（记录）方法

- `getRecord(key, ctx?)`：`key: IStorageKey`（`snapshotStorageKey` 校验并克隆），从 `recordsStoreName` 读取，不存在返回 `undefined`。
- `putRecord(value, key?, ctx?)`：`key` 省略时自动生成（`crypto.randomUUID()` 或时间戳兜底 + 单调递增后缀，防止熵源重复导致覆盖）。写入前 `structuredClone(value)` 拍快照（在异步边界之前脱离调用方引用），失败抛 `SERIALIZE_FAILED`。走 `writeWithConflict('record', ...)`，成功后返回实际写入的 `IStorageKey`。
- `deleteRecord(key, ctx?)`：在同一事务内删除该记录并递增其修订号（`REVISIONS_STORE_NAME` 中的 revision，供事务乐观并发检测使用）。
- `clearRecords(ctx?)`：清空 `recordsStoreName` 并递增全局 `RECORD_EPOCH_KEY`（与 `clearAll` 同样的“作废所有已开始事务”机制，但只影响 record 通道）。

### 迭代：`iterateRecords`

```ts
iterateRecords(range?: IKeyRange, ctx?: IOperationContext): AsyncIterableIterator<[IStorageKey, TValue]>;
```

- `range`：经 `snapshotKeyRange` 校验（`lower`/`upper` 必须是合法 `IStorageKey`，`lowerOpen`/`upperOpen` 必须是 `boolean`，且 `lower > upper` 或 `lower === upper` 时开区间会抛契约级 `INVALID_ARGUMENT`）。省略时全表扫描。
- 按 `ctx?.pageSize`（默认 `128`）分页拉取游标，每页在独立的 `readonly` 事务内完成；一页结束后以“最后一个 key，开区间”为下界继续下一页，避免单个长事务长期占用 IndexedDB 连接。
- 每次 `yield` 前后都检查合并信号（外部 `signal` + `timeoutMs` 合成），中止立即以契约级 `ABORTED` 结束迭代。
- 游标/事务失败统一归一化为 `StorageError(TRANSACTION_FAILED)`（`operation: 'indexeddb.cursor'`），契约错误原样穿透。

**可运行示例**：

```ts
import { indexedDb } from '@migaia/storage-web';

const db = indexedDb<{ id: string; name: string }>({ dbName: 'app-data' });
await db.putRecord({ id: 'ada', name: 'Ada' }, 'ada');
console.log(await db.getRecord('ada')); // { id: 'ada', name: 'Ada' }
for await (const [key, value] of db.iterateRecords()) console.log(key, value);
await db.dispose();
```

### 事务：`transaction`

```ts
transaction<T>(
  run: (tx: ITransactionScope<TValue>) => Promise<T>,
  ctx?: IOperationContext
): Promise<T>;

type ITransactionScope<TValue> = {
  get(key: IStorageKey): Promise<TValue | undefined>;
  put(value: TValue, key?: IStorageKey, options?: ITransactionWriteOptions): Promise<IStorageKey>;
  delete(key: IStorageKey): Promise<void>;
};
```

- `run` 必须是函数，否则契约级 `INVALID_ARGUMENT`。
- **乐观并发模型**：`tx.get`/`tx.put`/`tx.delete` 在回调执行期间只操作一份内存草稿（`draft` Map），首次访问某个 key 时记录其当时的 revision（惰性建立快照，`snapshotEpoch` 只在第一次真正读写时捕获）；回调返回后才真正开启一个 `readwrite` IndexedDB 事务提交：
  1. 先比对全局 `RECORD_EPOCH_KEY` 是否与快照时一致——不一致（期间发生过 `clearAll`/`clearRecords`）立即抛 `StorageError(TRANSACTION_CONFLICT)`。
  2. 再逐一比对回调中读取过的每个 key 的 revision 是否仍与快照时一致——任何一个不一致同样抛 `TRANSACTION_CONFLICT`。
  3. 两项检查都通过后才真正把草稿中的写入/删除应用到 `recordsStoreName`，并递增受影响 key 的 revision。
- 回调抛出的非 `StorageError`/`StorageContractError` 异常会被包装为 `StorageError(TRANSACTION_FAILED)`；回调抛出的 storage 家族错误原样透传。
- `tx.put` 在写通道冲突（该 key 已作为 value/bytes 存在）且 `conflictPolicy` 非 `'replace'` 时，在**提交阶段**（不是 `tx.put` 调用时）抛 `DUPLICATE_KEY`。
- 事务作用域只在回调 pending 期间有效：回调返回后再调用 `tx.get`/`tx.put`/`tx.delete` 会抛 `StorageError(TRANSACTION_FAILED, { operation: 'transaction.scope' })`。

**冲突重试示例**（详见[高阶组合示例](#组合工作流示例)）：

```ts
try {
  await db.transaction(async (tx) => {
    const current = await tx.get('counter');
    await tx.put((Number(current ?? 0) + 1).toString(), 'counter');
  });
} catch (error) {
  if (error instanceof StorageError && error.code === StorageErrorCode.transactionConflict) {
    // 并发写冲突：重读后重试整个回调
  }
}
```

### `metadata` 附加通道

```ts
readonly metadata: {
  get(key: string, ctx?: IOperationContext): Promise<unknown | undefined>;
  set(key: string, value: unknown, ctx?: IWriteOptions): Promise<void>;
  delete(key: string, ctx?: IOperationContext): Promise<void>;
};
```

只有 `indexedDb` 后端提供（`IRecordStore.metadata` 是可选字段）。读写 `meta` object store，供 `repository.migrate()` 持久化可恢复的迁移检查点使用（见[Entity 模块](#entity-模块)）。`memoryStorage`/KV-only 后端没有这个通道，因此其 `migrate()` 无法跨调用恢复，只能在单次调用内完整扫描。

---

<a id="memorystorage-模块"></a>

## `memoryStorage` 模块

源码：`src/backends/memory.ts`。

```ts
function memoryStorage<TValue = unknown>(): ISyncCapableStore<IRecordStore<TValue>>;
```

无入参，无选项。每次调用创建一个独立、进程内、易失的存储，天然隔离，不需要命名空间参数。实现全部 L0（值）+ L1（字节/记录/迭代/事务）接口，`record` 通道使用 `structuredClone` 做深拷贝隔离（因此不能存函数、不可克隆的宿主对象等）。

### 能力

```ts
{
  syncRead: true,
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  maxValueBytes: undefined,
  opaqueEntries: false
}
```

### 行为要点

- `sync` 通道只暴露 L0（`get`/`set`/`remove`/`has`/`keys`/`clearValues`）；异步 L0/L1/事务方法是完整实现，不是对 `sync` 的包装。
- 跨通道冲突检测（value/bytes/record 共享同一逻辑 key）与 `indexedDb` 遵循相同的 `planChannelWrite` 规则（见[契约与能力模块](#契约与能力模块)）。
- `transaction(run, ctx?)`：与 IndexedDB 相同的乐观并发模型——草稿隔离、提交前比对 `recordEpoch`（对应 `clearAll`）与每个访问过的 key 的 revision；不一致抛 `TRANSACTION_CONFLICT`。**与旧实现的关键差异**：草稿在提交前完全不触碰真实的 `documents` Map；早期实现直接在真实 Map 上写入、失败时用开头拍的快照整体覆盖回去——如果事务执行期间（`run(scope)` 内任意一次 `await` 之间）有其他并发的 `putRecord` 或另一个事务成功提交，那次快照恢复会把那次无关的成功写入一起抹掉。当前实现下失败只需丢弃草稿，真实数据从未被动过；成功时的合并循环是纯同步的（没有 `await`），不会被其他调用交错。
- `iterateRecords(range?, ctx?)`：对当前全部记录按 `compareStorageKeys` 排序后再按 range 过滤 yield；不分页（内存数据集通常不需要）。
- `dispose()`：置位 `disposed` 并清空全部内部 Map（`kv`/`bytes`/`documents`）。
- 没有 `metadata` 通道。

**可运行示例**：

```ts
import { memoryStorage } from '@migaia/storage-web'; // 或 '@migaia/storage-web/memory'

const store = memoryStorage<{ id: string }>();
await store.putRecord({ id: '1' }, '1');
console.log(await store.getRecord('1')); // { id: '1' }
await store.transaction(async (tx) => {
  await tx.put({ id: '2' }, '2');
});
```

---

<a id="契约与能力模块"></a>

## 契约与能力模块

### `isRecordStore` / `asRecordStore`

```ts
function isRecordStore(store: IKeyValueStore): store is IRecordStore;
function asRecordStore<T = unknown>(store: IKeyValueStore): IRecordStore<T>;
```

单参数，均无选项。判定逻辑（`inspectStoreShape`，源自 `@migaia/storage-contract`）：

1. `store.backend` 是已知种类之一（`'local' | 'session' | 'cookie' | 'indexeddb' | 'memory'`）；
2. `store.capabilities` 是完整、合法的 `IStorageCapabilities` 描述符，且 `records`/`binary`/`transactions`/`iteration` **全部**为 `true`；
3. L0 全部方法（`get`/`set`/`remove`/`has`/`keys`/`clearValues`/`clearAll`/`dispose`）与 L1 全部方法（`getBytes`/`setBytes`/`clearBytes`/`getRecord`/`putRecord`/`deleteRecord`/`clearRecords`/`iterateRecords`/`transaction`）均为函数。

`isRecordStore` 是类型守卫，返回 `boolean`，读取任何字段抛错时视为 `false`（不上抛）。`asRecordStore` 收窄失败时抛 `StorageContractError(UNSUPPORTED_CAPABILITY)`（`backend` 字段取判定过程中读到的种类，若种类本身不合法则为 `undefined`）。

```ts
import { asRecordStore, indexedDb, isRecordStore } from '@migaia/storage-web';

const store = indexedDb();
if (isRecordStore(store)) await store.putRecord({ a: 1 }, 'k');
const records = asRecordStore(store); // 能力不足时抛 StorageContractError(UNSUPPORTED_CAPABILITY)
```

### `ConflictPolicy`

```ts
const ConflictPolicy: { readonly conflict: 'conflict'; readonly replace: 'replace' };
type IConflictPolicy = 'conflict' | 'replace';
```

常量对象，无调用参数。作用于所有写方法的 `IWriteOptions.conflictPolicy`（默认 `'conflict'`）：一个逻辑 key 同时占用 value / bytes / record 三个通道之一时，若另一通道尝试写入同名 key 且策略为默认的 `'conflict'`，抛 `StorageError(DUPLICATE_KEY, { existingChannel, attemptedChannel })`；显式传 `'replace'` 才会在同一原子写入内先删除其他通道的同名值再写入目标通道。跨通道冲突解析统一由内部 `planChannelWrite`（`src/core/channel-write.ts`）计算：

```ts
// 内部签名（非导出，仅用于理解行为）
function planChannelWrite(
  key: IStorageKey,
  attempted: 'value' | 'bytes' | 'record',
  existing: ReadonlySet<'value' | 'bytes' | 'record'>,
  policy?: IConflictPolicy, // 默认 'conflict'
  backend?: IBackendKind
): { readonly remove: readonly IStorageChannel[] };
```

```ts
await store.set('k', 'v', { conflictPolicy: ConflictPolicy.replace });
```

### `lengthPrefixedNamespaceCodec` 与 `INamespaceCodec`

```ts
type INamespaceCodec = {
  encode(namespace: string, key: string): string;
  decode(namespace: string, physicalKey: string): string | undefined;
};
const lengthPrefixedNamespaceCodec: INamespaceCodec;
```

默认物理 key 编码器（`localStorage`/`sessionStorage`/`cookies` 的 `namespaceCodec` 默认值）。编码格式：`sw1:<命名空间 UTF-8 字节长度>:<encodeURIComponent(命名空间)>:<key>`——长度前缀 + 编码后的命名空间共同防止“命名空间 A 的 key 恰好是命名空间 B 前缀”这种碰撞。`decode` 只在物理 key 精确匹配该命名空间时返回原始逻辑 key，否则返回 `undefined`（不属于该命名空间，调用方应跳过而非报错）。

```ts
lengthPrefixedNamespaceCodec.encode('app', 'theme'); // 'sw1:3:app:theme'
lengthPrefixedNamespaceCodec.decode('app', 'sw1:3:app:theme'); // 'theme'
lengthPrefixedNamespaceCodec.decode('other', 'sw1:3:app:theme'); // undefined
```

自定义 `INamespaceCodec`（传给 `namespaceCodec` 选项）需要保证 `encode`/`decode` 互为逆运算且不同命名空间不产生物理 key 碰撞；自定义 codec 自行承担迁移与防碰撞责任，库不做二次校验（仅校验 `encode`/`decode` 是否为函数、返回值类型是否正确——`encode` 必须返回 `string`，`decode` 必须返回 `string | undefined`，否则经 `normalizeError` 归一化为 `StorageError(EXTENSION_FAILED, { extensionStage: 'codec' })`）。

### 关键契约类型（跨包共享，源自 `@migaia/storage-contract`，从根导出）

以下类型无需单独导入函数，直接标注调用点即可：

```ts
type IKeyValueStore = {
  readonly backend: IBackendKind; // 'local' | 'session' | 'cookie' | 'indexeddb' | 'memory'
  readonly capabilities: IStorageCapabilities;
  get(key: string, ctx?: IOperationContext): Promise<string | null>;
  set(key: string, value: string, ctx?: IWriteOptions): Promise<void>;
  remove(key: string, ctx?: IOperationContext): Promise<void>;
  has(key: string, ctx?: IOperationContext): Promise<boolean>;
  keys(ctx?: IOperationContext): Promise<string[]>;
  clearValues(ctx?: IOperationContext): Promise<void>;
  clearAll(ctx?: IOperationContext): Promise<void>;
  dispose(): Promise<void>;
  readonly sync?: ISyncKeyValueStore; // 仅同步后端提供
};

type IRecordStore<TValue = unknown> = IKeyValueStore & {
  getBytes(key: string, ctx?: IOperationContext): Promise<Uint8Array | null>;
  setBytes(key: string, value: Uint8Array, ctx?: IWriteOptions): Promise<void>;
  clearBytes(ctx?: IOperationContext): Promise<void>;
  getRecord(key: IStorageKey, ctx?: IOperationContext): Promise<TValue | undefined>;
  putRecord(value: TValue, key?: IStorageKey, ctx?: IWriteOptions): Promise<IStorageKey>;
  deleteRecord(key: IStorageKey, ctx?: IOperationContext): Promise<void>;
  clearRecords(ctx?: IOperationContext): Promise<void>;
  readonly metadata?: {
    get(key: string, ctx?: IOperationContext): Promise<unknown | undefined>;
    set(key: string, value: unknown, ctx?: IWriteOptions): Promise<void>;
    delete(key: string, ctx?: IOperationContext): Promise<void>;
  };
  iterateRecords(
    range?: IKeyRange,
    ctx?: IOperationContext
  ): AsyncIterableIterator<[IStorageKey, TValue]>;
  transaction<T>(
    run: (tx: ITransactionScope<TValue>) => Promise<T>,
    ctx?: IOperationContext
  ): Promise<T>;
};

type IStorageCapabilities = {
  readonly syncRead: boolean;
  readonly binary: boolean;
  readonly records: boolean;
  readonly transactions: boolean;
  readonly iteration: boolean;
  readonly maxValueBytes: number | undefined;
  readonly opaqueEntries: boolean;
};

type IOperationContext = {
  readonly signal?: IAbortSignal; // 协作式取消
  readonly timeoutMs?: number; // 内部合成为 signal；与外部 signal 同时存在时取先触发者
  readonly pageSize?: number; // IndexedDB 游标分页大小，默认 128
};
type IWriteOptions = IOperationContext & { readonly conflictPolicy?: IConflictPolicy };
type ISyncWriteOptions = { readonly conflictPolicy?: IConflictPolicy };

type IStorageKey = string | number | Date | ArrayBuffer | readonly IStorageKey[];
type IKeyRange = {
  readonly lower?: IStorageKey;
  readonly lowerOpen?: boolean;
  readonly upper?: IStorageKey;
  readonly upperOpen?: boolean;
};
```

**Key 域限制**（`KEY_DOMAIN_LIMITS`，来自 `@migaia/storage-contract`）：`maxDepth: 32`（嵌套数组最大深度）、`maxNodes: 4096`（校验期间遍历的节点总数上限）、`maxBinaryBytes: 1024 * 1024`（`ArrayBuffer` 作为 key 时的最大字节数）。超出任一限制，或 key 是空数组、包含循环引用、类型不在 `IStorageKey` 联合内，`assertStorageKey`/`snapshotStorageKey` 抛 `StorageContractError(INVALID_KEY)`。

`ITransactionScope<TValue>`（`indexedDb`/`memoryStorage` 的 `transaction()` 回调参数类型，详见各自章节）：

```ts
type ITransactionScope<TValue = unknown> = {
  get(key: IStorageKey): Promise<TValue | undefined>;
  put(value: TValue, key?: IStorageKey, options?: ITransactionWriteOptions): Promise<IStorageKey>;
  delete(key: IStorageKey): Promise<void>;
};
type ITransactionWriteOptions = { readonly conflictPolicy?: IConflictPolicy };
```

---

<a id="序列化-codec-模块"></a>

## 序列化（codec）模块

```ts
type ICodec<TValue = unknown, TRaw = unknown> = {
  readonly name: string;
  readonly output: 'text' | 'structured' | 'binary';
  encode(value: TValue, ctx?: IOperationContext): Promise<TRaw>;
  decode(raw: TRaw, ctx?: IOperationContext): Promise<TValue>;
};
```

### `jsonCodec`

```ts
const jsonCodec: ICodec<unknown, string>;
```

默认 codec，零依赖，全后端可用。`output: 'text'`。

- `encode(value)`：`JSON.stringify(value)`；若结果为 `undefined`（例如 `value` 本身就是 `undefined`，或含无法序列化的顶层值），落盘为字符串字面量 `'null'`（`?? 'null'`）。`JSON.stringify` 抛错（例如循环引用）归一化为 `StorageError(SERIALIZE_FAILED)`。
- `decode(raw)`：`JSON.parse(raw)`；抛错归一化为 `StorageError(DESERIALIZE_FAILED)`。

```ts
await jsonCodec.encode({ a: 1 }); // '{"a":1}'
await jsonCodec.decode('{"a":1}'); // { a: 1 }
await jsonCodec.encode(undefined); // 'null'
```

### `structuredCodec`

```ts
const structuredCodec: ICodec<unknown, unknown>;
```

`output: 'structured'`。`encode`/`decode` 都是恒等函数（`async (value) => value`），完全交给后端自身的 structured clone（IndexedDB）。只能用于 `capabilities.records === true` 的后端；可直接存 `Blob`/`File`/`ArrayBuffer`/`Map`/`Set`/`Date`，甚至循环引用——这些结构无法用 JSON 表达。

```ts
await structuredCodec.encode({ date: new Date(), blob: myBlob }); // 原样返回
```

### `binaryCodec`

```ts
const binaryCodec: ICodec<Uint8Array, Uint8Array>;
```

`output: 'binary'`。`encode`/`decode` 均校验入参是 `Uint8Array`（`isUint8Array`），不是则分别抛 `SERIALIZE_FAILED`/`DESERIALIZE_FAILED`；类型正确时原样返回（不拷贝）。

```ts
await binaryCodec.encode(new Uint8Array([1, 2, 3])); // 原样返回（仅校验类型）
```

### `selectCodec`

```ts
function selectCodec(
  codec: ICodec,
  capabilities: IStorageCapabilities,
  onDiagnostic?: (message: string) => void
): ISelectedCodec;

type ISelectedCodec = {
  encode(value: unknown, ctx?: { signal?: IAbortSignal }): Promise<string | Uint8Array | unknown>;
  decode(raw: string | Uint8Array | unknown, ctx?: { signal?: IAbortSignal }): Promise<unknown>;
};
```

- `codec`（必填）：经 `snapshotCodec` 校验为合法的 `ICodec` 描述符（`name`/`output`/`encode`/`decode` 齐备），否则抛契约级 `INVALID_ARGUMENT`。
- `capabilities`（必填）：经 `snapshotStorageCapabilities` 校验为完整的能力描述符，否则抛契约级 `INVALID_ARGUMENT`。
- `onDiagnostic?`：必须是函数（若提供），否则抛 `StorageError(INVALID_CONFIG)`；调用失败（诊断 sink 自身抛错）被静默吞掉，不影响选路结果。

**选路规则**：

1. `codec.output === 'structured'`：`capabilities.records === false` 时抛 `StorageContractError(UNSUPPORTED_CAPABILITY)`（structured clone 能力无法用 JSON 表达，不做隐式转换以避免丢数据）；否则直连原样返回该 codec。
2. `codec.output === 'binary'`：`capabilities.binary === true` 时直连；`false` 时自动降级为 base64 文本（体积 +33%），调用一次 `onDiagnostic(message)` 报告降级，返回一个包装过的 `ISelectedCodec`（`encode` 内部转 `bytesToBase64`，`decode` 内部转 `base64ToBytes` 再交给原 codec）。
3. 其余情况（`output === 'text'`，或已经匹配能力的 `binary`/`structured`）原样直连返回。

```ts
import { binaryCodec, selectCodec, sessionStorage, memoryStorage } from '@migaia/storage-web';

const textOnly = sessionStorage();
const selected = selectCodec(binaryCodec, textOnly.capabilities, (msg) => console.warn(msg));
await selected.encode(new Uint8Array([1, 2, 3])); // base64 字符串，触发一次诊断

const recordBackend = memoryStorage();
const direct = selectCodec(binaryCodec, recordBackend.capabilities);
await direct.encode(new Uint8Array([1, 2, 3])); // 原样透传，无降级
```

---

<a id="schema-模块"></a>

## Schema 模块

```ts
type ISchemaAdapter<TDomain, TStored = TDomain> = {
  readonly name: string;
  validate(value: unknown, ctx?: IOperationContext): Promise<TDomain>;
  encode?(value: TDomain, ctx?: IOperationContext): Promise<TStored>;
  decode?(raw: TStored, ctx?: IOperationContext): Promise<TDomain>;
  normalize?(value: TDomain, ctx?: IOperationContext): Promise<TDomain>;
};
```

Schema 层是面向开发者的开放契约，不绑定任何校验库，也不强制使用。`encode`/`decode` 处理**领域表示**（例如 `Date` ↔ ISO 字符串、内部字段裁剪），与 codec 处理的**存储格式**（对象 ↔ 字符串/字节）分工不同。执行顺序：写入 `validate → normalize → encode → codec.encode`，读取 `codec.decode → decode → validate`（`validateOnRead` 为 `true` 时）。

### `passthrough`

```ts
function passthrough<T = unknown>(): ISchemaAdapter<T, T>;
```

无参数（泛型指定类型）。零校验直接透传，返回 `{ name: 'passthrough', validate: async (value) => value as T }`；不提供 `encode`/`decode`/`normalize`（均视为恒等）。这是 `defineEntity` 未传 `schema` 选项时的默认值。

```ts
const schema = passthrough<{ id: string }>();
await schema.validate({ id: 'x' }); // { id: 'x' }（不做任何检查）
```

### `fromStandardSchema`

```ts
function fromStandardSchema<T>(schema: IStandardSchemaV1<unknown, T>): ISchemaAdapter<T, T>;
```

单参数 `schema`（必填），无选项。适配任意实现 [Standard Schema](https://standardschema.dev) v1 规范的库（zod ≥3.24、valibot ≥1.0、arktype ≥2.0）——本包不 import 任何一家，也不把它们列为 peerDependency，只依赖 `schema['~standard']` 上的 `version`/`vendor`/`validate` 三个字段。

- 构造期校验：`schema` 必须是对象；`schema['~standard']` 必须是对象且 `version === 1`、`vendor` 是非空字符串、`validate` 是函数，否则抛 `StorageError(INVALID_CONFIG)`。
- `validate(value)` 内部调用 `schema['~standard'].validate(value)`（同步或异步均可）：
  - 返回值本身非对象/`null`/数组，抛 `VALIDATION_FAILED`。
  - 返回带 `issues` 数组：逐条读取 `.message`（必须是 `string`），拼接所有 `; ` 分隔的消息，作为 `cause.message` 抛 `StorageError(VALIDATION_FAILED)`。
  - 返回带 `value` 字段且无 `issues`：作为校验结果返回。
  - 既无 `issues` 也无 `value`：抛 `VALIDATION_FAILED`（“Standard Schema result must contain value or issues”）。
- `name` 为 `` `standard-schema:${vendor}` ``（例如 `'standard-schema:zod'`）。

```ts
import { z } from 'zod';
import { fromStandardSchema } from '@migaia/storage-web';

const schema = fromStandardSchema(z.object({ id: z.string() }));
try {
  await schema.validate({ id: 42 });
} catch (error) {
  // StorageError(VALIDATION_FAILED)，cause.message 是各条 issue 用 '; ' 拼接的结果
}
```

### `runMigrations`

```ts
function runMigrations(
  value: unknown,
  fromVersion: number,
  toVersion: number,
  migrations: Record<number, IMigration> | undefined,
  signal?: IAbortSignal
): Promise<unknown>;

type IMigration = (previous: unknown, ctx: IMigrationContext) => Promise<unknown>;
type IMigrationContext = {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly signal?: IAbortSignal;
};
```

按版本升序执行迁移函数链，独立于 entity 层可单独调用。

- `value`（必填）：待迁移的原始值。
- `fromVersion`/`toVersion`（必填）：均为非负安全整数，否则抛 `StorageError(INVALID_CONFIG)`。
- `migrations?`：`Record<number, IMigration>`；若提供必须是普通对象（非数组），否则抛 `INVALID_CONFIG`。
- `signal?`：可选取消信号，逐个迁移步骤之间检查取消状态。
- `fromVersion >= toVersion` 时直接原样返回 `value`，不调用任何迁移函数。
- 每个版本号（`fromVersion + 1` 到 `toVersion`）依次检查 `migrations[version]`：**缺失该版本对应的迁移函数视为该版本没有数据形状变化（no-op），不是错误**——这一点与 `defineEntity` 的迁移图构造期校验（要求每一步都存在）不同，`runMigrations` 单独调用时更宽容。存在但非函数类型抛 `INVALID_CONFIG`。
- 迁移函数执行抛错（非取消类）归一化为 `StorageError(MIGRATION_FAILED)`；取消（`UtilsAbortError` 或已中止信号）归一化为契约级 `ABORTED`。

```ts
import { runMigrations } from '@migaia/storage-web';

await runMigrations(oldValue, 1, 3, {
  2: async (value) => ({ ...(value as object), addedInV2: true }),
  3: async (value) => ({ ...(value as object), addedInV3: true })
  // 缺失版本号对应的迁移不会报错，只是原样透传
});
```

---

<a id="entity-模块"></a>

## Entity 模块

### `defineEntity`

```ts
function defineEntity<TDomain, TStored = TDomain>(
  options: IEntityOptions<TDomain, TStored>
): IEntityDefinition<TDomain>;

type IEntityDefinition<TDomain> = {
  readonly name: string;
  readonly version: number;
  connect(store: IKeyValueStore): IRepository<TDomain>;
};

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

声明式定义一类记录（record）。`connect(store)` 把定义绑定到具体后端，产出可反复调用 `get`/`put`/`remove`/`list`/`stream`/`migrate`/`batch` 的仓储（repository）对象。同一个 definition 可以 `connect` 到多个后端，行为在两者上保持一致；同一个 `store` 实例也可以被多个 entity definition 共用（内部会把 entity 名编入实际存储 key，避免不同 entity 的同 `id` 记录互相覆盖）。

**构造期校验**（`validateDefinition`，任一失败均抛 `StorageError(INVALID_CONFIG)`）：

- `name: string`（必填）—— 非空字符串，且**不能以 `__` 开头**（保留前缀，用于内部机制如 `__storage_web_entity_v2__`）。
- `key: Extract<keyof TDomain, string>`（必填）—— 领域对象上作为主键的属性名，必须是非空字符串。
- `version?: number` —— 默认 `1`；必须是正安全整数。
- `schema?` —— 未提供时默认 `passthrough<TDomain>()`；提供时会用 `snapshotSchema` 校验 `name`（非空字符串）、`validate`（必须是函数）、`encode`/`decode`/`normalize`（若提供必须是函数）。
- `migrations?` —— `version > 1` 时**必须完整**提供第 `2` 到 `version` 的每一步（每个 key 都存在且是函数），条目数必须恰好等于 `version - 1`，且每个 key 必须是 `2 <= key <= version` 的整数——缺一步、多一步、版本号越界都会抛 `INVALID_CONFIG`。**这与 `runMigrations` 的“缺失即 no-op”不同：`defineEntity` 在构造期做硬校验，因为实体的迁移图一旦声明就必须完整、可预测。**
- `validateOnRead?: boolean` —— 默认 `true`。
- `onDiagnostic?: (message: string) => void` —— 必须是函数（若提供），否则 `INVALID_CONFIG`；默认 `console.warn`。诊断回调自身抛错会被吞掉，不影响存储语义。
- `defaultOrderBy?: (left, right) => number` —— 必须是函数（若提供）。

**`codec` 选项的延迟决策**：未显式提供时，`defineEntity` 本身不会默认成任何具体 codec（不能默认成 `jsonCodec`，因为结构化后端与 KV 后端的合理默认不同，且只有 `connect(store)` 时才知道实际连接的是哪种后端）。真正的默认值由 `createRepository` 在 `connect` 阶段决定：结构化后端（IndexedDB/memory，`isRecordStore(store) === true`）默认 `structuredCodec`；KV-only 后端（local/session/cookie）默认 `jsonCodec`。显式提供的 `codec` 会在 `connect` 阶段经 `selectCodec` 按后端能力选路，不会被结构化后端“绕过”默认值逻辑。

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
console.log(await preferences.get('appearance')); // { id: 'appearance', theme: 'dark' }
```

### `IRepository<TDomain>`（`connect(store)` 的返回值）

```ts
type IRepository<TDomain> = {
  get(id: IStorageKey, ctx?: IOperationContext): Promise<TDomain | undefined>;
  put(value: TDomain, ctx?: IOperationContext): Promise<IStorageKey>;
  remove(id: IStorageKey, ctx?: IOperationContext): Promise<void>;
  list(options?: IListOptions<TDomain>, ctx?: IOperationContext): Promise<TDomain[]>;
  stream(options?: IListOptions<TDomain>, ctx?: IOperationContext): AsyncIterableIterator<TDomain>;
  migrate(options?: IMigrateOptions<TDomain>, ctx?: IOperationContext): Promise<IMigrateResult>;
  batch<T>(
    run: (tx: IEntityTransactionScope<TDomain>) => Promise<T>,
    ctx?: IOperationContext
  ): Promise<T>;
};
```

`connect(store)` 本身会校验 `store` 是否实现最小 `IKeyValueStore` 契约（`backend` 是已知种类、`capabilities` 各布尔字段齐全、L0 全部方法存在），不满足抛 `StorageError(INVALID_CONFIG)`。

物理 key 编排：结构化后端优先写入 `[REPOSITORY_KEY_PREFIX, entityName, encodeFlatStorageKey(id)]`（`REPOSITORY_KEY_PREFIX = '__storage_web_entity_v2__'`，可作为 range 前缀高效扫描）；读取时若在 v2 前缀下找不到，会回退尝试历史形态 `[entityName, id]`（`composeStructuredKey`）以兼容旧数据，直到显式调用 `migrate()` 才会把历史记录搬迁为 v2 形态。KV-only 后端使用扁平字符串 key `` `${entityName}:${encodeFlatStorageKey(id)}` ``。

#### `get(id, ctx?)`

按主键读取并经过完整的 `codec.decode → schema.decode → 版本迁移（如需要）→ schema.validate（如 validateOnRead）` 链路物化；找不到返回 `undefined`。`id` 必须通过 `IStorageKey` 校验，否则抛契约级 `INVALID_KEY`。envelope 的 `__v`（存储版本号）高于当前 entity 的 `version` 时抛 `StorageError(VERSION_UNSUPPORTED)`（防止旧代码误读新版本数据）；低于当前版本则先经 `runMigrations` 升级。

#### `put(value, ctx?)`

全链路 `schema.validate → schema.normalize（如提供）→ schema.encode（如提供）→ codec.encode` 后写入，返回写入的 `IStorageKey`（即从 `value[key]` 提取出的主键，若为 `undefined`/`null` 抛 `INVALID_CONFIG`）。结构化后端上，写入通过一次 `transaction`（写入 v2 位置 + 删除可能存在的历史位置）保证不会同时残留两份数据。

#### `remove(id, ctx?)`

删除主键对应记录；结构化后端会在同一事务内同时清理 v2 位置与历史存储形态可能遗留的键。

#### `list(options?, ctx?)` / `stream(options?, ctx?)`

```ts
type IListOptions<TRecord = unknown> = {
  readonly range?: IKeyRange;
  readonly limit?: number;
  readonly orderBy?: (left: TRecord, right: TRecord) => number;
  readonly onInvalid?:
    'skip' | 'throw' | ((issue: IInvalidRecordIssue<TRecord>) => 'skip' | 'throw');
};
type IInvalidRecordIssue<TRecord = unknown> = {
  readonly key: IStorageKey;
  readonly raw: unknown;
  readonly record?: TRecord;
  readonly stage: 'decode' | 'migrate' | 'validate';
  readonly cause: unknown;
};
```

- `range`：作用于原始 `id` 空间（不是编排后的物理 key），经 `snapshotKeyRange` 校验。
- `limit`：非负安全整数，否则抛 `INVALID_CONFIG`。
- `orderBy`：未提供时使用 `defineEntity` 的 `defaultOrderBy`（若也未提供，按扫描顺序输出）。提供 `orderBy` 时内部会先缓冲全部符合 `range` 的记录、排序后再应用 `limit`——这意味着带排序的 `list`/`stream` 不是流式内存友好的，会一次性把结果集载入内存。比较函数返回非 `number` 或 `NaN` 会抛 `StorageError(EXTENSION_FAILED, { extensionStage: 'comparator', operation: 'entity.orderBy' })`。
- `onInvalid`：取 `'skip'`（默认）、`'throw'`，或 `(issue) => 'skip' | 'throw'` 处理器函数；`issue.stage` 标识失败发生在解码（`decode`）、迁移（`migrate`）还是校验（`validate`）阶段。处理器返回非 `'skip'`/`'throw'`，或处理器自身抛错，都会归一化为对应的存储错误码（`decode` → `DESERIALIZE_FAILED`，`migrate` → `MIGRATION_FAILED`，其余 → `VALIDATION_FAILED`）。
- **扫描策略**：KV-only 后端（local/session/cookie）会对**全部键**做一次 `keys()` 扫描后按 `entityName:` 前缀过滤，并调用一次 `onDiagnostic`（`"...list/stream on a value-only backend performs a full key scan"`）——这不是 bug，是这类后端固有的能力限制。结构化后端（IndexedDB/memory）按 entity 的 v2 前缀 range 高效扫描一遍，**再额外扫描一遍全表**以兼容尚未迁移的历史形态记录（`[entityName, id]`），用 `seenIds` 去重避免同一记录在两次扫描中都被 yield。
- `list` 是 `stream` 的缓冲版本（`for await` 收集进数组后返回）；两者共享同一套过滤/排序/`onInvalid` 逻辑。

#### `migrate(options?, ctx?)`

```ts
type IMigrateOptions<TRecord = unknown> = {
  readonly batchSize?: number; // 默认 100，正安全整数
  readonly onInvalid?:
    'skip' | 'throw' | ((issue: IInvalidRecordIssue<TRecord>) => 'skip' | 'throw');
};
type IMigrateResult = {
  readonly scanned: number;
  readonly eligible: number;
  readonly migrated: number;
  readonly skipped: number;
  readonly alreadyCurrent: number;
  readonly conflicted: number;
};
```

批量把库中全部记录升级到当前 entity `version`（同时把历史存储形态的记录搬迁为 v2 key 形态）。返回值各字段：`scanned`（扫描到的记录总数）、`eligible`（版本低于当前、需要迁移的记录数）、`migrated`（成功迁移的记录数）、`skipped`（因 `onInvalid` 策略被跳过的坏记录数）、`alreadyCurrent`（扫描时已经是当前版本，无需迁移）、`conflicted`（结构化后端事务提交冲突后，逐条重试仍失败/让位给并发写入的记录数）。

- **断点续跑**：仅 IndexedDB 提供 `metadata` 通道，可在 `` `repository:${name}:migration` `` key 下持久化检查点（`status`/`phase`/`scanned`/`migrated`/... 等全部计数器 + `lastPhysicalKey`），跨调用恢复——上次迁移中途失败或被取消，下次调用 `migrate()` 会从检查点继续，而不是从头重新扫描。检查点是否可复用取决于一个“迁移指纹”（entity 名、版本、主键属性名、schema 名、codec 名、迁移函数版本号集合的拼接）是否与本次调用一致，指纹不匹配视为过期检查点，从头开始。`memoryStorage`/KV-only 后端没有 `metadata` 通道，无法跨调用恢复，每次调用都从头扫描。
- **批量提交与冲突重试**（结构化后端）：以 `batchSize` 条记录为一批，在一个 `transaction` 内批量迁移；若该批次因 `TRANSACTION_CONFLICT` 整体失败，会退化为**逐条**在独立事务中重试——重试时会重新检查目标位置是否已被并发写入覆盖为更高版本（此时计入 `alreadyCurrent` 而非重复迁移），仍然冲突的记录计入 `conflicted`（不抛错，允许调用方后续再次调用 `migrate()` 补齐）。
- 记录解码/迁移/校验失败时按 `onInvalid` 策略处理，逻辑与 `list`/`stream` 一致（`skip` 计入 `skipped`，`throw` 直接抛出对应错误码并中断整个 `migrate()` 调用）。

```ts
const result = await preferences.migrate({ batchSize: 200, onInvalid: 'skip' });
console.log(result.migrated, result.conflicted, result.alreadyCurrent);
```

#### `batch(run, ctx?)`

```ts
type IEntityTransactionScope<TDomain> = {
  get(id: IStorageKey): Promise<TDomain | undefined>;
  put(value: TDomain): Promise<IStorageKey>;
  remove(id: IStorageKey): Promise<void>;
};
```

仅结构化后端（有真正事务）支持；`run` 收到的 `scope` 是对底层 `ITransactionScope` 的封装，内部替调用方完成 envelope 编解码与物理 key 编排。**KV-only 后端（local/session/cookie）调用 `batch` 会抛 `StorageContractError(UNSUPPORTED_CAPABILITY)`**——这些后端没有原生事务，不做“伪事务”模拟以免给出错误的原子性假象。`scope` 内的读写共享同一份乐观并发检测（见 IndexedDB/memoryStorage 章节的事务语义），整个回调作为一个原子单元提交，冲突时抛 `TRANSACTION_CONFLICT`。

```ts
const orders = defineEntity<{ id: string; total: number }>({ name: 'orders', key: 'id' }).connect(
  indexedDb()
);

const applyBatch = async (items: Array<{ id: string; total: number }>): Promise<void> => {
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

### `StorageError`

```ts
class StorageError extends Error {
  readonly source: '@migaia/storage-web';
  readonly code: IStorageErrorCode;
  readonly backend?: IBackendKind;
  readonly key?: string | IStorageKey;
  readonly existingChannel?: 'value' | 'bytes' | 'record';
  readonly attemptedChannel?: 'value' | 'bytes' | 'record';
  readonly extensionStage?: 'schema' | 'codec' | 'migration' | 'comparator' | 'diagnostic';
  readonly operation?: string;
  constructor(
    code: IStorageErrorCode,
    details?: {
      readonly backend?: IBackendKind;
      readonly key?: string | IStorageKey;
      readonly existingChannel?: 'value' | 'bytes' | 'record';
      readonly attemptedChannel?: 'value' | 'bytes' | 'record';
      readonly extensionStage?: 'schema' | 'codec' | 'migration' | 'comparator' | 'diagnostic';
      readonly operation?: string;
      readonly cause?: unknown;
    },
    message?: string
  );
}
```

`source` 恒为 `'@migaia/storage-web'`；`cause` 恒保留原始异常，永不改写 `message`；实例在构造后立即 `Object.freeze`。

**全部错误码**（`StorageErrorCode`）：

| 常量                   | 值                       | 触发场景                                                                               |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `unavailable`          | `BACKEND_UNAVAILABLE`    | 存储后端不可用：隐私模式探测失败、`localStorage`/IndexedDB/`document` 被禁用或缺失     |
| `quotaExceeded`        | `QUOTA_EXCEEDED`         | 写入命中浏览器配额上限                                                                 |
| `valueTooLarge`        | `VALUE_TOO_LARGE`        | 序列化后的 cookie 值超过单值 4KB 上限                                                  |
| `serializeFailed`      | `SERIALIZE_FAILED`       | 序列化失败（`JSON.stringify` 抛错、codec encode 非预期输出、`structuredClone` 写失败） |
| `deserializeFailed`    | `DESERIALIZE_FAILED`     | 反序列化失败（`JSON.parse` 抛错、envelope 结构非法、codec decode 非预期输出）          |
| `validationFailed`     | `VALIDATION_FAILED`      | Schema 校验失败                                                                        |
| `migrationFailed`      | `MIGRATION_FAILED`       | 迁移函数执行失败                                                                       |
| `transactionFailed`    | `TRANSACTION_FAILED`     | IndexedDB 事务创建/提交失败，或事务回调抛出非 `StorageError` 异常                      |
| `duplicateKey`         | `DUPLICATE_KEY`          | value/bytes/record 三通道逻辑 key 冲突且未指定 `conflictPolicy: 'replace'`             |
| `versionUnsupported`   | `VERSION_UNSUPPORTED`    | entity envelope `__v` 或 IndexedDB schema 版本高于当前代码所知的版本                   |
| `extensionFailed`      | `EXTENSION_FAILED`       | 扩展点（schema/codec/namespaceCodec/comparator/diagnostic）抛出了未归类的异常          |
| `transactionConflict`  | `TRANSACTION_CONFLICT`   | 事务提交时 read revision 或 global epoch 已变（并发写冲突，可重试）                    |
| `writeFailed`          | `WRITE_FAILED`           | Cookie 写入后读回不可见                                                                |
| `cookieScopeAmbiguous` | `COOKIE_SCOPE_AMBIGUOUS` | Cookie 同名多 scope 可见，无法确定目标值归属                                           |
| `invalidConfig`        | `INVALID_CONFIG`         | Web adapter 专有输入/配置校验失败（选项形状、cookie scope、IndexedDB store 名等）      |

```ts
try {
  await store.set('k', 'v', { conflictPolicy: ConflictPolicy.conflict });
} catch (error) {
  if (error instanceof StorageError && error.code === StorageErrorCode.duplicateKey) {
    // error.backend / error.key / error.existingChannel / error.attemptedChannel 均可读
  }
}
```

### 契约级错误（跨包共享，源自 `@migaia/storage-contract`，经根路径透传）

```ts
class StorageContractError extends Error {
  readonly source: '@migaia/storage-contract';
  readonly code: IStorageContractErrorCode;
  // 结构与 StorageError 相似（backend/key/cause 等），但错误码集合不同
}
const StorageContractErrorCode: {
  readonly invalidArgument: 'INVALID_ARGUMENT';
  readonly invalidKey: 'INVALID_KEY';
  readonly unsupported: 'UNSUPPORTED_CAPABILITY';
  readonly disposed: 'STORE_DISPOSED';
  readonly aborted: 'ABORTED';
};
function isStorageContractError(value: unknown): value is StorageContractError;
```

| 常量              | 值                       | 触发场景                                                                                                               |
| ----------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `invalidArgument` | `INVALID_ARGUMENT`       | 契约级入参/描述符结构校验失败（codec 描述符、capabilities 描述符、operation context 等）                               |
| `invalidKey`      | `INVALID_KEY`            | `IStorageKey` 违反 key 域（类型非法、深度/节点/二进制字节超限、循环、空数组）                                          |
| `unsupported`     | `UNSUPPORTED_CAPABILITY` | 调用了当前后端不提供的能力（`asRecordStore` 收窄失败、structured codec 落到 text-only 后端、KV-only 后端调用 `batch`） |
| `disposed`        | `STORE_DISPOSED`         | Store 已 `dispose()` 后继续调用其任何方法                                                                              |
| `aborted`         | `ABORTED`                | 操作被 `signal` 取消或 `timeoutMs` 到期                                                                                |

两类错误都保留 `cause` 链，`isStorageErrorFamily`（内部使用）会同时识别 `StorageError` 与 `StorageContractError`，跨扩展边界（schema/codec/namespaceCodec）传播时原样穿透，不会被二次包装。

---

<a id="组合工作流示例"></a>

## 组合工作流示例

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

### 2. 取消与超时

`IOperationContext.signal`/`timeoutMs` 在所有异步方法上一致生效；同时提供两者时取先触发者。取消/超时统一以契约级 `StorageContractError(ABORTED)` 结束等待，已进入原子提交阶段的写不会被伪报回滚。

```ts
import { indexedDb, isStorageContractError, StorageContractErrorCode } from '@migaia/storage-web';

const db = indexedDb();
try {
  await db.putRecord({ id: '1' }, '1', { timeoutMs: 50 });
} catch (error) {
  if (isStorageContractError(error) && error.code === StorageContractErrorCode.aborted) {
    // 50ms 内未完成
  }
}
```

### 3. KV-only 后端上做能力检查后再决定用记录还是值

```ts
import { asRecordStore, cookies, isRecordStore, memoryStorage } from '@migaia/storage-web';

const primary = cookies({ scope: { path: '/', secure: true, sameSite: 'lax' } });
const fallback = memoryStorage();
const store = isRecordStore(primary) ? asRecordStore(primary) : fallback;
// cookies 是 L0-only，isRecordStore(primary) 为 false，实际会走 memoryStorage 分支
```

### 4. 命名空间隔离 + 显式 replace 冲突策略

```ts
import { ConflictPolicy, localStorage } from '@migaia/storage-web';

const teamA = localStorage({ namespace: 'team-a' });
const teamB = localStorage({ namespace: 'team-b' });
await teamA.set('config', '{}');
await teamB.set('config', '{}'); // 不同命名空间，互不冲突

await teamA.clearValues(); // 只清 team-a 命名空间下的键，team-b 不受影响
```

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **`localStorage()`/`sessionStorage()`/`cookies()` 抛 `BACKEND_UNAVAILABLE`**：符合预期——构造期做过真实写入探测（或读取 `document.cookie`）。Safari 隐私模式、Cookie 被完全禁用、非浏览器环境未注入 `storage`/`document` 都会命中；显式降级到 `memoryStorage()`，或提示用户开启存储权限。
- **`cookies` 的 `get`/`set`/`keys` 抛 `COOKIE_SCOPE_AMBIGUOUS`**：说明同一物理 cookie 名同时对多个 scope 可见（例如同名 cookie 分别用 `domain: 'a.example.com'` 和不设 `domain` 写过）。让每个 scope 下的 cookie 名唯一，或在构造期固定单一 scope 后不再产生歧义；库不会随意猜测该返回哪一个值。
- **`cookies().set()` 抛 `WRITE_FAILED`**：写入后回读发现值不可见——检查 `path`/`domain`/`sameSite`/`secure` 是否与当前页面 origin 匹配，以及浏览器隐私策略（第三方 cookie 拦截、ITP）是否拦截了这次写入。
- **`set(key, value)` 抛 `DUPLICATE_KEY`**：同一逻辑 key 已经在 value/bytes/record 另一通道存在。要么换 key，要么显式传 `{ conflictPolicy: ConflictPolicy.replace }` 原子替换。
- **`asRecordStore(store)` 抛 `UNSUPPORTED_CAPABILITY`**：该 store 的 `capabilities.records`（或 `binary`/`transactions`/`iteration` 之一）为 `false`——先用 `isRecordStore(store)` 判断，或改用 `indexedDb()`/`memoryStorage()`。
- **`repository.batch()` 抛 `UNSUPPORTED_CAPABILITY`**：底层 store 是 KV-only 后端（local/session/cookie），没有原生事务；改用 `indexedDb()`/`memoryStorage()`，或改用逐条 `get`/`put`（自行处理并发）。
- **事务/`batch()`/`migrate()` 抛 `TRANSACTION_CONFLICT`**：这是可重试的并发写冲突，不是数据损坏——重新读取最新状态后重试整个事务回调（`migrate()` 会自动逐条重试一次，仍冲突的记录计入 `conflicted`，可再次调用 `migrate()` 补齐）。
- **`defineEntity` 抛 `INVALID_CONFIG`（migration graph 相关）**：`version > 1` 时 `migrations` 必须完整覆盖第 2 到 `version` 的每一步，不能有缺口——这与 `runMigrations()` 独立调用时“缺失即 no-op”的宽容策略不同。
- **`selectCodec`/`entity` 遇到 structured codec 抛 `UNSUPPORTED_CAPABILITY`**：目标后端 `capabilities.records === false`（KV-only），structured clone 能力（Blob/Map/Set/循环引用）无法用 JSON 无损表达，库不做静默降级；改用 `jsonCodec` 并自行处理不可 JSON 化的字段，或换成结构化后端。
- **二进制值在 KV-only 后端体积膨胀 33%**：`selectCodec` 对 `binaryCodec` 在 text-only 后端上的必然行为（base64 编码），会经 `onDiagnostic` 报告一次；只有换成 IndexedDB/memoryStorage 才能避免。
- **需要跨标签页订阅存储变化**：本包不暴露 `storage` 事件；订阅属于上层状态管理职责，不在本包范围内。

```bash
pnpm --filter @migaia/storage-web run fmt
pnpm --filter @migaia/storage-web run lint
pnpm --filter @migaia/storage-web run typecheck
pnpm --filter @migaia/storage-web run typecheck:test
pnpm --filter @migaia/storage-web run test
pnpm --filter @migaia/storage-web run test:e2e
```

`test` 会先执行 `build`（Vite 打包 + `tsc --emitDeclarationOnly`）再跑 `vitest run --coverage`；`test:e2e` 使用 `e2e/playwright.config.ts`，需要本机已安装 Playwright 浏览器依赖。
