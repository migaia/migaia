# `@migaia/storage-contract`

运行时无关的存储契约：定义键值/记录存储的公共接口形状、能力描述符、存储键域、编解码器接口、操作上下文、事务作用域与契约级错误。零持久化实现——不打开数据库、不写磁盘、不依赖 DOM/IndexedDB/Node。

## 适用与不适用场景

**适用**：某个包需要接受或暴露"存储"这个能力，但不想绑定到具体的浏览器/Node/持久化实现。典型场景：定义一个只依赖 `IKeyValueStore`/`IRecordStore` 的功能模块、在契约边界做能力收窄（`asRecordStore`）、跨后端统一校验存储键与操作上下文。

**不适用**：不要把它当作存储引擎——它不打开任何数据库、不持久化任何值、不提供浏览器/Node 后端实现。需要真正的持久化后端见 `@migaia/storage-web`（或其他实现该契约的包）。

## 安装

```bash
pnpm --filter <consumer-package> add @migaia/storage-contract@workspace:^
```

依赖 `@migaia/lifecycle`（仅用其 `IAbortSignal` 类型，用于协作式取消）。

## 目录

- [`store`：L0/L1 存储接口与运行时收窄](#store-模块)
- [`capabilities`：能力描述符](#capabilities-模块)
- [`context` / `operation-context`：操作上下文与写选项](#context-模块)
- [`key`：存储键域校验](#key-模块)
- [`codec` / `codec-guard`：编解码器接口](#codec-模块)
- [`transaction`：事务作用域](#transaction-模块)
- [`errors`：契约级错误](#errors-模块)
- [`bytes` / `policy-constants`：底层工具](#bytes-模块)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

只有根导出是公开的，没有子路径导出：

```ts
import { asRecordStore, StorageContractError, type IKeyValueStore } from '@migaia/storage-contract';
```

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="store-模块"></a>

## `store` 模块：`IKeyValueStore` / `IRecordStore` / 运行时收窄

```ts
import {
  isKeyValueStore,
  asRecordStore,
  isRecordStore,
  type IKeyValueStore,
  type ISyncKeyValueStore,
  type IRecordStore,
  type ISyncCapableStore
} from '@migaia/storage-contract';
```

**`IKeyValueStore`｜5 秒上手** —— L0 契约类型，接受存储时只依赖它：

```ts
export const loadTheme = async (store: IKeyValueStore): Promise<string> =>
  (await store.get('theme')) ?? 'system';
```

全部字段：

- `backend: IBackendKind`（只读）—— `'local' | 'session' | 'cookie' | 'indexeddb' | 'memory'`
- `capabilities: IStorageCapabilities`（只读）
- `get(key: string, ctx?: IOperationContext): Promise<string | null>`
- `set(key: string, value: string, ctx?: IWriteOptions): Promise<void>`
- `remove(key: string, ctx?: IOperationContext): Promise<void>`
- `has(key: string, ctx?: IOperationContext): Promise<boolean>`
- `keys(ctx?: IOperationContext): Promise<string[]>`
- `clearValues(ctx?: IOperationContext): Promise<void>`
- `clearAll(ctx?: IOperationContext): Promise<void>`
- `dispose(): Promise<void>`
- `sync?: ISyncKeyValueStore`（只读，仅同步后端提供）

**`ISyncKeyValueStore`｜3 秒上手** —— 同步通道，仅同步后端（localStorage 等）通过 `sync` 字段提供：

```ts
store.sync?.set('theme', 'dark');
```

全部方法：`get(key): string | null`、`set(key, value, options?: ISyncWriteOptions)`、`remove(key): void`、`has(key): boolean`、`keys(): string[]`、`clearValues(): void`。`ISyncWriteOptions` 只有 `conflictPolicy?: IConflictPolicy`，不接受 `signal`/`timeoutMs`。

**`ISyncCapableStore<T>`｜3 秒上手** —— 把某个 store 类型的 `sync` 字段从可选收紧为必有（供同步后端工厂函数标注返回类型）：

```ts
declare function createMemoryStore(): ISyncCapableStore<IKeyValueStore>;
createMemoryStore().sync.set('k', 'v'); // 无需 ?.
```

单一类型参数 `TStore extends { readonly sync?: object }`（必填），无其他选项。

**`IRecordStore<T>`｜10 秒上手** —— L1 契约类型，L0 之上追加字节/结构化记录/迭代/事务：

```ts
const record = await asRecordStore<{ name: string }>(store).getRecord('profile');
```

在 `IKeyValueStore` 全部字段之上追加：

- `getBytes(key: string, ctx?: IOperationContext): Promise<Uint8Array | null>`
- `setBytes(key: string, value: Uint8Array, ctx?: IWriteOptions): Promise<void>`
- `clearBytes(ctx?: IOperationContext): Promise<void>`
- `getRecord(key: IStorageKey, ctx?: IOperationContext): Promise<TValue | undefined>`
- `putRecord(value: TValue, key?: IStorageKey, ctx?: IWriteOptions): Promise<IStorageKey>` —— 未传 `key` 时由后端生成
- `deleteRecord(key: IStorageKey, ctx?: IOperationContext): Promise<void>`
- `clearRecords(ctx?: IOperationContext): Promise<void>`
- `clearAll(ctx?: IOperationContext): Promise<void>`（覆盖 L0 版本，同时清 values/bytes/records）
- `metadata?: { get, set, delete }`（只读，可选，后端自有的元数据通道，供可恢复的维护迁移使用）
- `iterateRecords(range?: IKeyRange, ctx?: IOperationContext): AsyncIterableIterator<[IStorageKey, TValue]>`
- `transaction<T>(run: (tx: ITransactionScope<TValue>) => Promise<T>, ctx?: IOperationContext): Promise<T>`

**`isKeyValueStore`｜5 秒上手** —— 运行时校验未知值是否满足完整 L0 形状：

```ts
if (isKeyValueStore(candidate)) await candidate.set('k', 'v');
```

单参数 `store: unknown`（必填），无选项。校验 `backend` 属于已知后端集合、`capabilities` 通过 `isStorageCapabilities`、且全部 L0 方法都是函数；任何属性访问抛错都视为不合法（返回 `false`，不向上抛）。

**`isRecordStore`｜5 秒上手** —— 同上，但额外校验 L1 方法与 `capabilities.records/binary/transactions/iteration` 均为 `true`：

```ts
if (isRecordStore(store)) {
  /* 可以安全用 asRecordStore(store) */
}
```

单参数 `store: IKeyValueStore`（必填），无选项。

**`asRecordStore`｜5 秒上手** —— 运行时收窄到 `IRecordStore`，形状或能力不足直接抛错而不是静默降级：

```ts
const records = asRecordStore<MyRecord>(store); // 不满足 L1 时抛 StorageContractError(unsupported)
```

单参数 `store: IKeyValueStore`（必填），无选项；泛型 `T`（可选，默认 `unknown`）指定记录值类型。失败时抛 `StorageContractError`，`code: 'UNSUPPORTED_CAPABILITY'`，`details.backend` 为探测到的后端（探测失败则为 `undefined`）。

---

<a id="capabilities-模块"></a>

## `capabilities` 模块

```ts
import {
  snapshotStorageCapabilities,
  isStorageCapabilities,
  type IBackendKind,
  type IStorageCapabilities
} from '@migaia/storage-contract';
```

**`IStorageCapabilities`｜5 秒上手** —— 能力描述符类型，用于按能力分支而不是按后端名字分支：

```ts
if (store.capabilities.binary) await store.setBytes('k', bytes);
```

全部字段（均为只读布尔，除 `maxValueBytes`）：

- `syncRead: boolean`
- `binary: boolean`
- `records: boolean`
- `transactions: boolean`
- `iteration: boolean`
- `maxValueBytes: number | undefined` —— 单值近似字节上限；`undefined` 表示受配额而非单值限制（如 IndexedDB）
- `opaqueEntries: boolean` —— 该后端上是否可能存在不可见的键（如 cookies 的 HttpOnly）

**`snapshotStorageCapabilities`｜5 秒上手** —— 读一次并校验未知值是否是合法能力描述符：

```ts
const capabilities = snapshotStorageCapabilities(raw); // 合法则返回新对象快照，否则 undefined
```

单参数 `value: unknown`（必填），无选项。字段访问抛错、类型不符（布尔字段非布尔，或 `maxValueBytes` 不是非负安全整数/`undefined`）都返回 `undefined`，不抛错。

**`isStorageCapabilities`｜3 秒上手** —— 类型守卫，等价于 `snapshotStorageCapabilities(value) !== undefined`：

```ts
isStorageCapabilities(candidate); // boolean
```

单参数 `value: unknown`（必填），无选项。

`IBackendKind` 是字面量联合类型：`'local' | 'session' | 'cookie' | 'indexeddb' | 'memory'`。

---

<a id="context-模块"></a>

## `context` / `operation-context` 模块：操作上下文与写选项

```ts
import {
  ConflictPolicy,
  snapshotOperationContext,
  assertOperationContext,
  snapshotSyncWriteOptions,
  assertSyncWriteOptions,
  type IOperationContext,
  type IWriteOptions,
  type ISyncWriteOptions,
  type IConflictPolicy,
  type IStorageKey,
  type IKeyRange,
  type IOperationContextSnapshot
} from '@migaia/storage-contract';
```

**`IOperationContext`｜5 秒上手** —— 所有异步方法最后一个可选参数：

```ts
await store.get('theme', { timeoutMs: 500 });
```

全部字段：

- `signal?: IAbortSignal` —— 协作式取消，后端可忽略但调用方一定以 `AbortError` 结束等待
- `timeoutMs?: number` —— 便捷超时，内部合成为 `signal`；与外部 `signal` 同时存在取先触发者
- `pageSize?: number` —— IndexedDB 等迭代器的分页大小，`1`~`4096` 之间的整数

**`IWriteOptions`｜3 秒上手** —— `IOperationContext` 之上追加 `conflictPolicy?: IConflictPolicy`（默认 `'conflict'`）：

```ts
await store.set('k', 'v', { conflictPolicy: ConflictPolicy.replace });
```

**`ISyncWriteOptions`｜3 秒上手** —— 同步写只接受 `conflictPolicy?: IConflictPolicy`，不接受 `signal`/`timeoutMs`（同步调用无法协作式取消）：

```ts
store.sync?.set('k', 'v', { conflictPolicy: 'replace' });
```

**`ConflictPolicy`｜3 秒上手** —— 冲突策略常量，`'conflict'`（默认，已存在则失败）或 `'replace'`（覆盖）：

```ts
ConflictPolicy.conflict; // 'conflict'
ConflictPolicy.replace; // 'replace'
```

**`IStorageKey`｜3 秒上手** —— L1 文档主键类型：`string | number | Date | ArrayBuffer` 或以上类型的（可嵌套）只读数组。

**`IKeyRange`｜3 秒上手** —— L1 范围查询边界，语义对齐 `IDBKeyRange` 但不直接依赖它：

```ts
const range: IKeyRange = { lower: 'a', upper: 'z', upperOpen: true };
```

全部字段（均可选）：`lower?: IStorageKey`、`lowerOpen?: boolean`、`upper?: IStorageKey`、`upperOpen?: boolean`。

**`snapshotOperationContext`｜5 秒上手** —— 读一次并校验 `IOperationContext`，返回冻结快照；供实现方在方法入口统一调用：

```ts
const snapshot = snapshotOperationContext(ctx); // undefined | 冻结后的快照
```

单参数 `ctx: IOperationContext | undefined`（必填，可传 `undefined`），无选项。已是本函数产出的快照会被幂等直接返回。非法值（`signal` 不满足 `IAbortSignal` 形状、`timeoutMs` 非非负安全整数、`pageSize` 不在 `1`~`4096`、`conflictPolicy` 不是 `'conflict'/'replace'`）抛 `StorageContractError(invalidArgument)`。

**`assertOperationContext`｜3 秒上手** —— 只校验不返回值（内部即调用 `snapshotOperationContext`）：

```ts
assertOperationContext(ctx); // 非法时抛错，合法时无返回
```

单参数同上。

**`snapshotSyncWriteOptions`｜5 秒上手** —— 校验同步写选项，禁止出现 `signal`/`timeoutMs`：

```ts
snapshotSyncWriteOptions({ conflictPolicy: 'replace' }); // { conflictPolicy: 'replace' }
snapshotSyncWriteOptions({ timeoutMs: 100 }); // 抛错：同步写不支持 timeoutMs
```

单参数 `options: unknown`（必填），无选项。

**`assertSyncWriteOptions`｜3 秒上手** —— 只校验不返回值：

```ts
assertSyncWriteOptions(options);
```

---

<a id="key-模块"></a>

## `key` 模块：存储键域校验

```ts
import {
  KEY_DOMAIN_LIMITS,
  assertStorageKey,
  snapshotStorageKey,
  assertStringStorageKey,
  compareStorageKeys
} from '@migaia/storage-contract';
```

**`KEY_DOMAIN_LIMITS`｜3 秒上手** —— 键域硬限制常量，无调用参数：

```ts
KEY_DOMAIN_LIMITS.maxDepth; // 32
KEY_DOMAIN_LIMITS.maxNodes; // 4096
KEY_DOMAIN_LIMITS.maxBinaryBytes; // 1048576（1 MiB）
```

**`assertStorageKey`｜5 秒上手** —— 校验值是否落在 `IStorageKey` 域内（不合法则抛错）：

```ts
assertStorageKey(candidate, 'indexeddb');
```

参数：`value: unknown`（必填）、`backend: IBackendKind`（必填，用于错误详情）、`label?: string`（默认 `'key'`，出现在错误消息里）。合法值：字符串、有限数字、`Date`（非 `NaN`）、`ArrayBuffer`（`<=1MiB`）、或以上类型的非空嵌套数组（深度 `<=32`、总节点数 `<=4096`，检测循环引用）。不合法抛 `StorageContractError`，`code: 'INVALID_KEY'`。

**`snapshotStorageKey`｜5 秒上手** —— 校验并深拷贝出一份分离的键，避免调用方之后修改原对象影响已发起的异步操作：

```ts
const detachedKey = snapshotStorageKey(key, 'memory');
```

参数同 `assertStorageKey`；返回校验后的深拷贝。拷贝/二次校验失败会包装成 `StorageContractError(invalidKey)` 抛出。

**`assertStringStorageKey`｜3 秒上手** —— 校验 L0/字节/元数据通道要求的纯字符串键：

```ts
assertStringStorageKey(key, 'local');
```

参数：`value: unknown`（必填）、`backend: IBackendKind`（必填）、`label?: string`（默认 `'key'`）。非字符串抛 `StorageContractError(invalidArgument)`。

**`compareStorageKeys`｜5 秒上手** —— 跨类型的稳定排序比较器（数字 < 日期 < 字符串 < 二进制 < 数组，逐类型比较，数组逐段递归比较后按长度决胜）：

```ts
[keyA, keyB].sort(compareStorageKeys);
```

参数：`a: IStorageKey`（必填）、`b: IStorageKey`（必填），无选项，返回 `number`。

---

<a id="codec-模块"></a>

## `codec` / `codec-guard` 模块：编解码器接口

```ts
import {
  snapshotCodec,
  assertCodec,
  type ICodec,
  type ICodecOutput
} from '@migaia/storage-contract';
```

**`ICodec<T, TRaw>`｜5 秒上手** —— 编解码器接口类型。本包只内置一个运行时中立的 Map/Set JSON codec；浏览器通道相关的 structured/binary codec 仍由 `@migaia/storage-web` 提供：

```ts
const myCodec: ICodec<MyValue> = {
  name: 'my-codec',
  output: 'structured',
  encode: async (value) => value,
  decode: async (raw) => raw as MyValue
};
```

全部字段：`name: string`（必填）、`output: ICodecOutput`（必填，`'text' | 'binary' | 'structured'`，用于与后端能力选路）、`encode(value: T, ctx?: IOperationContext): Promise<TRaw>`（必填）、`decode(raw: TRaw, ctx?: IOperationContext): Promise<T>`（必填）。

**`collectionsJsonCodec`｜5 秒上手** —— 版本化保存 JSON 数据中的真实 `Map`/`Set`：

```ts
import {
  COLLECTIONS_JSON_CODEC_NAME,
  collectionsJsonCodec
} from '@migaia/storage-contract';

const raw = await collectionsJsonCodec.encode(new Map([['theme', 'dark']]));
const restored = await collectionsJsonCodec.decode(raw); // Map 实例
```

固定 `name` 为 `COLLECTIONS_JSON_CODEC_NAME`（`'migaia-collections-json-v1'`），`output` 为 `'text'`。只识别自身精确的版本化 tuple，不会把普通相似数组猜成集合；根值无法被 JSON 表示、payload 非字符串或 JSON 解析失败时抛 `StorageContractError(INVALID_ARGUMENT)`，原始失败保留在 `cause`。

**`snapshotCodec`｜5 秒上手** —— 读一次并校验未知值是否满足 `ICodec` 形状：

```ts
const codec = snapshotCodec(candidate); // 校验后原样返回（浅拷贝出的 4 字段对象）
```

单参数 `codec: unknown`（必填），无选项。`name` 非空字符串、`output` 属于三值之一、`encode`/`decode` 均为函数，否则抛 `StorageContractError(invalidArgument)`。

**`assertCodec`｜3 秒上手** —— 只校验不返回值（类型断言签名）：

```ts
assertCodec(candidate); // candidate 类型收窄为 ICodec
```

---

<a id="transaction-模块"></a>

## `transaction` 模块

```ts
import {
  assertTransactionCallback,
  readTransactionConflictPolicy,
  type ITransactionScope,
  type ITransactionWriteOptions
} from '@migaia/storage-contract';
```

**`ITransactionScope<T>`｜5 秒上手** —— 事务内可用的最小作用域类型，隔离级别/提交时机/重试由具体实现定义：

```ts
await store.transaction(async (tx: ITransactionScope<MyRecord>) => {
  const current = await tx.get('k');
  await tx.put({ ...current, count: (current?.count ?? 0) + 1 }, 'k');
});
```

全部方法：`get(key: IStorageKey): Promise<TValue | undefined>`、`put(value: TValue, key?: IStorageKey, options?: ITransactionWriteOptions): Promise<IStorageKey>`、`delete(key: IStorageKey): Promise<void>`。**不要**在回调 resolve 之后继续持有并使用该 scope。

**`ITransactionWriteOptions`｜3 秒上手** —— `{ conflictPolicy?: IConflictPolicy }`，无其他字段。

**`assertTransactionCallback`｜3 秒上手** —— 在实现方分配快照/连接资源之前校验回调是函数：

```ts
assertTransactionCallback(run, 'memory'); // 非函数抛 invalidArgument
```

参数：`run: unknown`（必填）、`backend: IBackendKind`（必填，用于错误详情）。

**`readTransactionConflictPolicy`｜5 秒上手** —— 校验并读出事务写选项里的冲突策略，默认 `'conflict'`：

```ts
const policy = readTransactionConflictPolicy(options, 'indexeddb'); // 'conflict' | 'replace'
```

参数：`options: unknown`（必填，可为 `undefined`）、`backend: IBackendKind`（必填）。非法值（既不是 `undefined` 也不是 `'conflict'`/`'replace'`）抛 `StorageContractError(invalidArgument)`。

---

<a id="errors-模块"></a>

## `errors` 模块

```ts
import {
  StorageContractError,
  StorageContractErrorCode,
  STORAGE_CONTRACT_SOURCE,
  isStorageContractError,
  type IStorageContractErrorCode,
  type IStorageContractErrorDetails
} from '@migaia/storage-contract';
```

**`StorageContractError`｜5 秒上手** —— 本包统一抛出的错误类，构造后 `Object.freeze`：

```ts
throw new StorageContractError(StorageContractErrorCode.invalidKey, {
  backend: 'memory',
  key: badKey
});
```

构造参数：`code: IStorageContractErrorCode`（必填）、`details?: IStorageContractErrorDetails`（默认 `{}`，字段：`backend?: IBackendKind`、`key?: string | IStorageKey`、`cause?: unknown`）、`message?: string`（默认 `` `[storage-contract] ${code}` ``）。实例字段：`source`（恒为 `'@migaia/storage-contract'`）、`code`、`backend?`、`key?`，均只读；`cause` 通过标准 `Error` 机制可达。

**`StorageContractErrorCode`｜3 秒上手** —— 稳定错误码表，常量对象：

```ts
if (error.code === StorageContractErrorCode.aborted) {
  /* ... */
}
```

全部取值：`invalidArgument`(`INVALID_ARGUMENT`，契约级入参/描述符结构校验失败)、`invalidKey`(`INVALID_KEY`，键违反键域)、`unsupported`(`UNSUPPORTED_CAPABILITY`，调用了当前后端不提供的能力)、`disposed`(`STORE_DISPOSED`，store 已 `dispose()` 后继续调用)、`aborted`(`ABORTED`，操作被 `signal`/`timeoutMs` 取消)。

**`STORAGE_CONTRACT_SOURCE`｜3 秒上手** —— 常量字符串 `'@migaia/storage-contract'`，等同任意 `StorageContractError` 实例的 `source` 字段。

**`isStorageContractError`｜3 秒上手** —— 类型守卫：

```ts
if (isStorageContractError(error)) console.log(error.code);
```

单参数 `value: unknown`（必填），无选项。

---

<a id="bytes-模块"></a>

## `bytes` / `policy-constants` 模块：底层工具

```ts
import {
  isArrayBuffer,
  isUint8Array,
  intrinsicConstructorName,
  StorageContractConflictPolicy,
  type IStorageContractConflictPolicy
} from '@migaia/storage-contract';
```

**`isUint8Array` / `isArrayBuffer`｜3 秒上手** —— `@migaia/utils/bytes` 所有的内部槽品牌检测；本包只做函数身份不变的兼容 re-export：

```ts
isUint8Array(new Uint8Array()); // true
isArrayBuffer(new ArrayBuffer(1)); // true
```

单参数 `value: unknown`（必填），无选项。

**`intrinsicConstructorName`｜3 秒上手** —— 兼容保留的尽力诊断 helper：

```ts
intrinsicConstructorName(new Date()); // 'Date'
```

单参数 `value: unknown`（必填），无选项。非对象/`null`/访问失败返回 `undefined`。它会观察可篡改的原型、`constructor` 与 `name`，不得用于安全、类型或协议判定。

**`StorageContractConflictPolicy`｜3 秒上手** —— 与 `ConflictPolicy` 同值的常量对象（供不想引入 `context` 模块类型的场景使用）：

```ts
StorageContractConflictPolicy.replace; // 'replace'
```

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 只依赖 L0，需要 L1 时才在功能边界收窄

```ts
import { asRecordStore, isRecordStore, type IKeyValueStore } from '@migaia/storage-contract';

type IProfile = { readonly name: string };

export const saveProfile = async (store: IKeyValueStore, profile: IProfile): Promise<void> => {
  if (!isRecordStore(store)) throw new Error('profile storage requires an L1-capable backend');
  await asRecordStore<IProfile>(store).putRecord(profile, 'profile');
};
```

### 2. 按能力分支而不是按后端名字分支

```ts
import { type IKeyValueStore, asRecordStore } from '@migaia/storage-contract';

export const persistBlob = async (store: IKeyValueStore, key: string, blob: Uint8Array) => {
  if (store.capabilities.binary) {
    await asRecordStore(store).setBytes(key, blob);
    return;
  }
  // 退回文本通道，调用方自行做 base64 之类的编码
  await store.set(key, btoa(String.fromCharCode(...blob)));
};
```

### 3. 事务内读改写 + 冲突策略

```ts
import {
  ConflictPolicy,
  type IRecordStore,
  type ITransactionScope
} from '@migaia/storage-contract';

type ICounter = { readonly value: number };

export const increment = (store: IRecordStore<ICounter>, key: string) =>
  store.transaction(async (tx: ITransactionScope<ICounter>) => {
    const current = await tx.get(key);
    await tx.put({ value: (current?.value ?? 0) + 1 }, key, {
      conflictPolicy: ConflictPolicy.replace
    });
  });
```

### 4. 校验 + 超时组合的存储读

```ts
import {
  snapshotOperationContext,
  type IKeyValueStore,
  type IOperationContext
} from '@migaia/storage-contract';

export const readWithBudget = async (
  store: IKeyValueStore,
  key: string,
  ctx: IOperationContext
) => {
  const snapshot = snapshotOperationContext(ctx); // 提前校验，坏参数在发起 I/O 前就抛出
  return store.get(key, snapshot);
};
```

### 5. 自定义 codec 接入契约边界

```ts
import { assertCodec, type ICodec } from '@migaia/storage-contract';

const gzipJsonCodec: ICodec<unknown, Uint8Array> = {
  name: 'gzip-json',
  output: 'binary',
  encode: async (value) => gzip(JSON.stringify(value)),
  decode: async (raw) => JSON.parse(await gunzip(raw))
};
assertCodec(gzipJsonCodec); // 在注册前校验形状，坏实现尽早报错
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm --filter @migaia/storage-contract run fmt && pnpm --filter @migaia/storage-contract run lint && pnpm --filter @migaia/storage-contract run typecheck && pnpm --filter @migaia/storage-contract run typecheck:test && pnpm --filter @migaia/storage-contract run test
```
