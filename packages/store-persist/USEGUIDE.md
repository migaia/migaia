# 使用手册

本文是 `@migaia/store-persist` 的完整参考手册。先看 [README.md](./README.md#5-最小可跑示例) 的最小示例，跑起来之后再回来查这里的细节——README 讲"是什么、适合什么场景、怎么跑起来"，本文讲每一层的精确语义。

## 目录

1. [核心引擎：`IPersistUnit` / `persistUnit()`](#1-核心引擎ipersistunit--persistunit)
2. [`persist()` 完整参考（store-light）](#2-persist-完整参考store-light)
3. [`persistCollection()` 完整参考（store-indexed）](#3-persistcollection-完整参考store-indexed)
4. [`persistKeyed()` + `clearFamily()` 完整参考（store-keyed）](#4-persistkeyed--clearfamily-完整参考store-keyed)
5. [存档格式与版本迁移](#5-存档格式与版本迁移)
6. [`IPersistHandle` 完整 API 参考](#6-ipersisthandle-完整-api-参考)
7. [与 storage-web 的 codec 集成](#7-与-storage-web-的-codec-集成)
8. [错误参考](#8-错误参考)
9. [生产环境完整示例](#9-生产环境完整示例)
10. [底层导出：envelope 工具、状态常量与错误构造函数](#10-底层导出envelope-工具状态常量与错误构造函数)
11. [常见问题排查](#11-常见问题排查)

---

## 1. 核心引擎：`IPersistUnit` / `persistUnit()`

```ts
type IPersistUnit<TState> = {
  snapshot(): TState; // 同步读当前可持久化状态
  restore(state: TState): void; // 同步写回一份状态（hydrate 用）
  subscribe(onChange: () => void): IDisposer; // 注册变化通知
};

function persistUnit<TState>(
  unit: IPersistUnit<TState>,
  options: IPersistUnitOptions<TState>
): IPersistHandle;
```

`persist()`/`persistCollection()`/`persistKeyed()` 内部各自把自己的原生 API 适配成 `IPersistUnit<TState>`，然后统一调 `persistUnit()`——hydrate 竞态、防抖写回、dispose 清理只在这一个函数里实现一遍，三条路径不重复代码，行为也因此完全一致。一般不需要直接调用 `persistUnit()`，除非你要接入一种全新的 store 形状（第四种，本包目前没有内置适配）。

`IPersistUnitOptions<TState>` 完整字段：

| 选项         | 类型                                                      | 必填性 | 默认值                                                               | 说明                                                                                                                        |
| ------------ | --------------------------------------------------------- | ------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `key`        | `string`                                                  | 必填   | 无                                                                   | 存档在 storage 里的键                                                                                                       |
| `runtime`    | `IRuntime`                                                | 必填   | 无                                                                   | `status`/`error`/`hydrated` 等信号挂在哪个 Runtime 上；三条适配路径都会自动传底层 store/collection/AtomStore 自己的 runtime |
| `storage`    | `{ capabilities, get, set, remove, keys }`                | 必填   | 无                                                                   | 遵循 `@migaia/storage-contract` 的 `IKeyValueStore`；`@migaia/storage-web` exact backend 子路径提供实现，可选 `getBytes`/`setBytes` 启用 binary codec |
| `codec`      | `ICodec`                                                  | 可选   | `defaultJsonCodec`                                                   | 见 [§7](#7-与-storage-web-的-codec-集成)                                                                                    |
| `version`    | `number`                                                  | 可选   | `0`                                                                  | schema 版本，必须是安全非负整数                                                                                             |
| `migrate`    | `(persisted: TState, fromVersion: number) => TState`      | 可选   | 无                                                                   | 见 [§5](#5-存档格式与版本迁移)                                                                                              |
| `partialize` | `(state: TState) => Partial<TState>`                      | 可选   | 恒等函数                                                             | 写入前裁剪                                                                                                                  |
| `merge`      | `(persisted: Partial<TState>, current: TState) => TState` | 可选   | 普通对象按启动快照做三向合并；数组/Map/Set 等非 plain shape 整体替换 | 读取后合并回内存，见下方"默认 merge 的语义"                                                                                 |
| `debounceMs` | `number`                                                  | 可选   | `0`（不防抖）                                                        | 变化后延迟多久发起写入                                                                                                      |

### 默认 `merge` 的语义（容易踩的坑）

默认 `merge` 对 plain object 使用**三向字段合并**：记录异步读取开始时的内存快照；读取期间本地改过的字段优先，本地未改过的字段接受持久化值。这样同字段启动竞态不会覆盖本地新写。数组、Map、Set 等非 plain shape 仍整体替换，避免对象展开破坏容器语义。

- `partialize` 保持默认（恒等函数）时，"替换"和"合并"是同一件事，行为符合直觉。
- 一旦你自定义 `partialize` 只持久化状态的一部分（比如 `persistKeyed()` 里"只存 refreshToken"这种场景），默认 plain-object 三向合并会保留未持久化字段；如果状态含数组、Map/Set 或需要深层语义，**必须**提供匹配的 `merge`。

`persist()`（store-light）是个例外：它的 `restore()` 最终调用 `store.$hydrate()`，那本身就是"宽松写回、未知字段跳过"的部分合并语义，跟这里的 `merge` 默认值互不影响——即使只 `partialize` 出一部分字段，`$hydrate()` 也只会覆盖这些字段，不会动其余字段。

---

## 2. `persist()` 完整参考（store-light）

```ts
function persist(store: IPersistableStore, options: IPersistOptions): IPersistHandle;

type IPersistableStore = {
  readonly $runtime: IRuntime;
  $plain(): Record<string, unknown>;
  $subscribe(fn: () => void, options?: { readonly fireImmediately?: boolean }): IDisposer;
  $hydrate(
    partial: Record<string, unknown>,
    options?: { unknown?: 'ignore' | 'report' | 'strict'; onUnknown?: (key: string) => void }
  ): void;
};

type IPersistOptions = {
  key: string;
  storage: IKeyValueStore;
  codec?: ICodec;
  version?: number;
  migrate?: (persisted: Record<string, unknown>, fromVersion: number) => Record<string, unknown>;
  partialize?: (state: Record<string, unknown>) => Record<string, unknown>;
  debounceMs?: number;
};
```

`IPersistableStore` 是结构类型，不 import `@migaia/store-light` 的具体类型——`createStore()` 的返回值天然满足这个接口，传进来不需要任何改动。适配表：

| `IPersistUnit` 成员 | 对应 store-light API                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `snapshot()`        | `store.$plain()`（只含 signal 支撑的标量字段，排除 computed/wasm/方法） |
| `restore(state)`    | `store.$hydrate(state)`（宽松写回，未知字段跳过）                       |
| `subscribe(fn)`     | `store.$subscribe(fn, { fireImmediately: false })`                      |

```ts
import { createStore } from '@migaia/store-light';
import { indexedDb } from '@migaia/storage-web/indexed-db';
import { persist } from '@migaia/store-persist';

const store = createStore({ theme: 'light', fontSize: 14 });
const handle = persist(store, {
  key: 'settings:v1',
  storage: indexedDb({ dbName: 'app' }),
  version: 1,
  partialize: (state) => ({ theme: state.theme }) // 只存 theme，fontSize 只留内存
});
```

---

## 3. `persistCollection()` 完整参考（store-indexed）

```ts
function persistCollection<TState>(
  collection: IPersistableCollection<TState>,
  options: IPersistCollectionOptions<TState>
): IPersistHandle;

type IPersistableCollection<TState> = {
  readonly runtime: IRuntime;
  snapshot(): TState;
  replace(state: TState): void;
};

type IPersistCollectionOptions<TState> = {
  key: string;
  storage: IKeyValueStore;
  codec?: ICodec;
  version?: number;
  migrate?: (persisted: TState, fromVersion: number) => TState;
  partialize?: (state: TState) => Partial<TState>;
  merge?: (persisted: Partial<TState>, current: TState) => TState;
  debounceMs?: number;
};
```

支持 `@migaia/store-indexed` 的四种集合：`ObservableObject`、`ObservableArray`、`ObservableMap`、`ObservableSet`——全部有 `snapshot()`（tracked 读）和 `replace(state)`（原子整体替换，`ObservableMap`/`ObservableSet` 的 `replace()` 是跟本包这一版一起补的，之前只有 Object/Array 有）。不用泛型重载区分四种集合——直接把 collection 传进去，TypeScript 从参数结构推导 `TState`。

变化订阅的实现方式（跟 `persist()`/`persistKeyed()` 不同）：四种集合都**没有**现成的 `subscribe()` 方法，`toPersistUnit()` 内部用 `collection.runtime.effect(() => { collection.snapshot(); ... })` 包一层——`snapshot()` 内部读了一个 tracked 的内部结构 Signal，包进 Effect 就能感知任何结构变化；Effect 构造自带的首次同步执行会被跳过，不当成一次真正的变化。

```ts
import { observableMap } from '@migaia/store-indexed';
import { localStorage } from '@migaia/storage-web/local-storage';
import { persistCollection } from '@migaia/store-persist';

const cart = observableMap<string, number>(); // sku -> 数量
const handle = persistCollection(cart, {
  key: 'cart:v1',
  storage: localStorage()
});

cart.set('sku-123', 2); // 防抖写回（默认 debounceMs: 0，下一次写队列排空即写）
```

### 原子 hydrate 的保证

四种集合的 `replace()` 都是"一次性整体替换，只触发一次结构变化通知"——hydrate 失败（存档损坏、版本不匹配无 migrate）不会让 collection 停在"部分写入"的中间态：要么整份替换成功，要么 `restore()` 根本不被调用、collection 保持 hydrate 前的状态。

---

## 4. `persistKeyed()` + `clearFamily()` 完整参考（store-keyed）

```ts
function persistKeyed<T>(
  atomStore: IAtomStore,
  def: IWritableAtomDefinition<T>,
  id: string,
  options: IPersistKeyedOptions<T>
): IPersistKeyedHandle<T>;
function clearFamily(storage: IKeyValueStore, namespace: string): Promise<number>;

type IPersistKeyedOptions<T> = {
  namespace: string; // 必填——storage key 格式 `${namespace}:${id}`
  storage: IKeyValueStore;
  codec?: ICodec;
  version?: number;
  debounceMs?: number;
  partialize?: (value: T) => Partial<T>;
  merge?: (persisted: Partial<T>, current: T) => T;
};

type IPersistKeyedHandle<T> = { readonly value: T; dispose(): void };
```

### 为什么持久化单位是"一个 key"，不是"整个 family"

`AtomStore`/`familyDef` 都不能回答"当前存在哪些 key"——这是 `@migaia/store-keyed` 刻意的设计（缓存策略是私事，不该被外部依赖）。所以 `persistKeyed()` 不是"给整个 family 接一份持久化"，是**每次调用各自创建一个独立的持久化单位**，`dispose()` 只影响这一个 key：

```ts
import { createAtomStore, familyDef } from '@migaia/store-keyed';
import { indexedDb } from '@migaia/storage-web/indexed-db';
import { persistKeyed, clearFamily } from '@migaia/store-persist';

type Session = { accessToken: string; refreshToken: string };
const session = familyDef((): Session => ({ accessToken: '', refreshToken: '' }));
const storage = indexedDb({ dbName: 'app' });
const atomStore = createAtomStore(runtime);

// 每个 session id 首次使用时调用一次
function getSession(id: string) {
  return persistKeyed(atomStore, session(id), id, {
    namespace: 'sessions',
    storage,
    partialize: (v) => ({ refreshToken: v.refreshToken }), // 只存 refreshToken
    merge: (persisted, current) => ({ ...current, ...persisted }) // 其余字段保留内存值
  });
}

const { value, dispose } = getSession('u1');
// ... 使用完毕
dispose();
```

### `clearFamily()`：批量清空

`clearFamily(storage, namespace)` **绕开** `AtomStore`——直接从传入的 `@migaia/storage-contract` `IKeyValueStore` 读取该 storage 下全部 key（`await storage.keys()`），过滤出 `${namespace}:` 前缀的，逐个删除，返回删掉的条数。storage-web 的 exact backend 子路径只是该契约的一个实现来源。它**不会**、也不能顺带清理内存里已经实例化的 `AtomStore` 状态：调用方如果还持有对应的 `persistKeyed()` handle，那些 handle 的内存值不受影响，只是失去了持久化落地；下次这些 key 的值再变化，会重新写回一条新记录（因为它们各自的 `subscribe` 还挂着，跟 `clearFamily()` 无关）。需要连内存也清空，需要调用方自己对每个还持有的 handle 调用 `dispose()`。

```ts
async function logout(userId: string) {
  await clearFamily(storage, 'sessions'); // 清空全部用户的持久化 session
  currentSessionHandle?.dispose(); // 清理当前用户还留在内存里的 handle
}
```

---

## 5. 存档格式与版本迁移

```text
{ "version": <number>, "state": <任意 JSON 兼容值> }
```

- `version`：调用方传入的 schema 版本，`migrate(persisted, fromVersion)` 处理跨版本转换。
- `state`：`partialize(unit.snapshot())` 的结果——对 `persist()` 是（裁剪后的）`Record<string,unknown>`；对 `persistCollection()` 是（裁剪后的）collection 快照；对 `persistKeyed()` 是（裁剪后的）单个 key 的 value。

`version` 与配置的当前版本不一致、且没有提供 `migrate`：hydrate 直接失败（`ready` reject，`status` 变 `error`），不会把未迁移的旧数据当成已迁移的新数据用。

---

## 6. `IPersistHandle` 完整 API 参考

`persist()`/`persistCollection()` 返回完整的 `IPersistHandle`；`persistKeyed()` 只返回 `{ value, dispose() }`（单 key 场景不需要 `status`/`flush()` 这么重的门面）。

| 成员                                 | 类型                                                            | 同步/异步 | 说明                                                              |
| ------------------------------------ | --------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `status`                             | `IComputedValue<'loading' \| 'ready' \| 'error' \| 'disposed'>` | —         | 整体状态机                                                        |
| `error`                              | `IComputedValue<unknown>`                                       | —         | hydration/write 任一失败时的错误；两者都失败返回 `AggregateError` |
| `hydrated`                           | `IComputedValue<boolean>`                                       | —         | 等价于 `hydrationStatus.value === 'success'`                      |
| `hydrationStatus` / `hydrationError` | `IReadonlyPersistValue<...>`                                    | —         | 首次读取的结果，只变化一次                                        |
| `writeStatus` / `writeError`         | `IReadonlyPersistValue<...>`                                    | —         | 最近一次写操作的结果，会反复变化                                  |
| `ready`                              | `Promise<void>`                                                 | 异步      | hydrate 成功 resolve，失败 reject                                 |
| `settled`                            | `Promise<void>`                                                 | 异步      | 不管成功失败都 resolve                                            |
| `retryHydrate()`                     | `() => Promise<void>`                                           | 异步      | 首次 hydrate 失败后重新读取；成功后恢复有序写入                    |
| `flush()`                            | `() => Promise<void>`                                           | 异步      | 立即写并等待完成；这次写入失败会 reject 给调用方                  |
| `clear()`                            | `() => Promise<void>`                                           | 异步      | 删除存档，不重置内存状态                                          |
| `disposed`                           | `boolean`                                                       | 同步      | 是否已 `dispose()`                                                |
| `dispose()`                          | `() => void`                                                    | 同步      | 退订、清防抖 timer、abort 在途 I/O                                |

`dispose()` 之后再调用 `flush()`/`clear()` 会立即 reject，错误是 `name === 'AbortError'` 的 `Error`。

---

## 7. 与 storage-web 的 codec 集成

`storage` 需要满足 `@migaia/storage-contract` `IKeyValueStore` 的 `capabilities`、`get`、`set`、`remove`、`keys`；直接传 `@migaia/storage-web` 的 exact backend 子路径实例即可：
`memoryStorage()`、`localStorage()` 或 `indexedDb()` 的返回值即可。binary codec 另需
`getBytes`/`setBytes`。

`codec` 默认是本包自带的 `defaultJsonCodec`（`name: 'migaia-collections-json-v1'`、`output: 'text'`，遵循 `@migaia/storage-contract` 的 `ICodec` 契约；本包不运行时依赖 storage-web 的具体 codec 值）。这个默认 codec 额外处理了 `JSON.stringify` 原生不支持的两种形状：

- `Map`/`Set` → 使用 storage-contract 所有的 `migaia-collections-json-v1` 版本化标记编码，解码时还原成真正的 `Map`/`Set` 实例。
- 旧存档中的 `__migaia_persist_map__`/`__migaia_persist_set__` 仅按精确标签显式迁移；其他相似字段不会被猜测为集合。

这不是可选的锦上添花——`JSON.stringify(new Map(...))` 产出 `"{}"`，**静默丢光内容而不报错**，`persistCollection()` 接的 `ObservableMap`/`ObservableSet` 的 `snapshot()` 就是真实的 `Map`/`Set` 实例，不处理这个坑会导致 keyed/indexed 场景下的 Map/Set 数据悄悄消失。

传 binary codec 时，后端必须具备字节通道：

```ts
import { binaryCodec } from '@migaia/storage-web/serialize';

const handle = persistCollection(bigDataset, {
  key: 'big',
  storage: indexedDb({ dbName: 'app' }),
  codec: binaryCodec
});
```

本包的最小 storage 协议不含 record 通道，`structured` codec 会以 `CODEC_OUTPUT_MISMATCH` 失败；`binary` 在缺 `getBytes`/`setBytes` 时以 `BACKEND_CAPABILITY` 失败。不会自动 base64 降级。

---

## 8. 错误参考

所有包边界错误都带 `source: '@migaia/store-persist'` 与稳定 `code`。重点检查
`ENVELOPE_INVALID`、`ENCODE_FAILED`、`BACKEND_CAPABILITY`、`CODEC_OUTPUT_MISMATCH` 和
`ABORTED_BY_DISPOSE`；后者保留原生 `AbortError`。hydrate 失败会保留原始错误并阻塞
`flush()`/`clear()`，直到一次成功的 `retryHydrate()` 重新打开有序写入。

| 触发条件                                                     | 错误类型                                   | 说明                                                      |
| ------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------- |
| `version` 不是安全非负整数                                   | `TypeError`                                | 构造时同步抛出                                            |
| 存档不是合法信封（不是对象/缺 `version`/缺 `state`）         | `PersistEnvelopeError`（继承 `TypeError`） | hydrate 阶段，反映在 `hydrationError`/`ready` reject      |
| hydrate 失败后调用 `flush()`/`clear()`                        | 原始 hydrate 错误                          | 写入保持阻塞并保留 dirty 状态；成功的 `retryHydrate()` 才恢复写入 |
| `version` 与存档不一致且未提供 `migrate`                     | `Error`                                    | 消息含 `provide migrate()`                                |
| codec 编码失败（比如值包含循环引用）                         | `TypeError`                                | `defaultJsonCodec` 保留原始错误为 `cause` 并附加 `ENCODE_FAILED` |
| `codec.output === 'structured'` 但存储不支持                 | `TypeError`                                | 见 [§7](#7-与-storage-web-的-codec-集成)                  |
| `codec.output === 'binary'` 但存储没有 `getBytes`/`setBytes` | `TypeError`                                | 同上                                                      |
| `persistKeyed()` 未传 `namespace`                            | TypeScript 编译期错误                      | `namespace` 是必填字段，不是运行时校验                    |
| `dispose()` 后调用 `flush()`/`clear()`                       | `Error`（`name: 'AbortError'`）            | 消息为 `[store] persist operation was aborted by dispose` |

---

## 9. 生产环境完整示例

```ts
import { createStore } from '@migaia/store-light';
import { createAtomStore, familyDef } from '@migaia/store-keyed';
import { observableSet } from '@migaia/store-indexed';
import { indexedDb } from '@migaia/storage-web/indexed-db';
import { persist, persistCollection, persistKeyed, clearFamily } from '@migaia/store-persist';
import { createRuntime } from '@migaia/reactive';

const runtime = createRuntime();
const storage = indexedDb({ dbName: 'app' });

// 1. 扁平设置
const settings = createStore({ theme: 'light' });
const settingsHandle = persist(settings, { key: 'settings', storage, version: 1 });

// 2. 最近浏览过的商品（indexed）
const recentlyViewed = observableSet<string>(undefined, {}, runtime);
const recentHandle = persistCollection(recentlyViewed, { key: 'recent', storage });

// 3. 按用户的 session（keyed，只存 refreshToken）
const atomStore = createAtomStore(runtime);
const session = familyDef(() => ({ accessToken: '', refreshToken: '' }));
function getSession(userId: string) {
  return persistKeyed(atomStore, session(userId), userId, {
    namespace: 'sessions',
    storage,
    partialize: (v) => ({ refreshToken: v.refreshToken }),
    merge: (persisted, current) => ({ ...current, ...persisted })
  });
}

async function logout(userId: string, activeHandle: { dispose(): void }) {
  await Promise.all([settingsHandle.flush(), recentHandle.flush()]);
  await clearFamily(storage, 'sessions');
  activeHandle.dispose();
}
```

---

## 10. 底层导出：envelope 工具、状态常量与错误构造函数

以下是 `persistUnit()`/`persist()`/`persistCollection()`/`persistKeyed()` 内部用来读写/编解码存档的底层函数与常量。它们都从包根（`.` 导出）导出，一般不需要在业务代码里直接调用——除非要接入一种全新的 store 形状（`persistUnit()` 之外的第四种适配），或需要绕开三个高层函数手动读写某个 key 的存档。

```ts
import {
  assertEnvelope,
  PersistEnvelopeError,
  type IEnvelope,
  defaultJsonCodec,
  writeEnvelope,
  readEnvelope,
  removeEnvelope,
  PersistState,
  PersistCodecOutput,
  STORE_PERSIST_SOURCE,
  createStorePersistError,
  createStorePersistAbortError,
  createStorePersistTypeError,
  createStorePersistAggregateError
} from '@migaia/store-persist';
```

```ts
function assertEnvelope<TState>(value: unknown, key: string): IEnvelope<TState>;
class PersistEnvelopeError extends TypeError {}
```

`assertEnvelope(value, key)` 校验 `value` 是 `{ version: number; state: unknown }` 形状的信封：`value` 非对象/是数组、`version` 不是安全非负整数、或缺失/`null`/`undefined` 的 `state`，都会抛出 `PersistEnvelopeError`（继承 `TypeError`，携带 `code: 'ENVELOPE_INVALID'`）。校验通过时返回收窄类型后的 `{ version, state: TState }`。`key` 只用于错误消息里标注是哪个存档。

```ts
const defaultJsonCodec: ICodec; // { name: 'json', output: 'text', encode(value): Promise<string>, decode(raw): Promise<unknown> }
```

本包自带的默认 codec 遵循 `@migaia/storage-contract` 的 `ICodec` 形状，额外原生支持 `Map`/`Set` 往返（编码成带 `__migaia_persist_map__`/`__migaia_persist_set__` 标签的普通对象，解码时还原成真正的 `Map`/`Set` 实例），避免 `JSON.stringify(new Map(...))` 静默丢空的问题。需要 storage-web 的 binary codec 时，从 `@migaia/storage-web/serialize` exact 子路径导入。`encode` 遇到不可序列化的值（如循环引用）抛 `TypeError`（`code: 'ENCODE_FAILED'`）；`decode` 收到非字符串输入抛 `TypeError`（`code: 'ENVELOPE_INVALID'`）。

```ts
function writeEnvelope(
  storage: IPersistStorage,
  key: string,
  codec: ICodec,
  value: unknown,
  ctx: { signal?: AbortSignal }
): Promise<void>;
function readEnvelope(
  storage: IPersistStorage,
  key: string,
  codec: ICodec,
  ctx: { signal?: AbortSignal }
): Promise<unknown | undefined>;
function removeEnvelope(
  storage: IPersistStorage,
  key: string,
  ctx: { signal?: AbortSignal }
): Promise<void>;
```

- `writeEnvelope`：按 `codec.output` 选路——`'structured'` 直接抛 `TypeError`（本包最小 storage 投影不支持 record 通道）；`'binary'` 且后端具备 `getBytes`/`setBytes` 时写字节通道（编码结果必须是 `Uint8Array`，否则抛错）；其余情况写文本通道（编码结果必须是 `string`）。
- `readEnvelope`：镜像 `writeEnvelope` 的选路逻辑读取；对应键在 storage 里不存在时返回 `undefined`（不是抛错）。
- `removeEnvelope`：委托 `storage.remove(key, ctx)`。

```ts
const PersistState: { idle; active; loading; writing; ready; success; error; disposed }; // 见下
const PersistCodecOutput: { text: 'text'; structured: 'structured'; binary: 'binary' };
```

`PersistState` 是本包内部状态机全部状态取值的唯一声明处，`IPersistHandle.status`/`hydrationStatus`/`writeStatus` 的类型都是它的子集（分别是 `IPersistStatus`/`IHydrationStatus`/`IWriteStatus`，见 [§6](#6-ipersisthandle-完整-api-参考)）；诊断代码可以直接比较 `handle.status.value === PersistState.error` 而不必写字符串字面量。`PersistCodecOutput` 是 `ICodec.output` 的合法取值表，与 `@migaia/storage-web` 的编码通道一一对应。

```ts
const STORE_PERSIST_SOURCE: '@migaia/store-persist';
function createStorePersistError(code, message, options?: { cause?: unknown }): Error;
function createStorePersistAbortError(code, message, cause?: unknown): DOMException;
function createStorePersistTypeError(code, message, options?: { cause?: unknown }): TypeError;
function createStorePersistAggregateError(
  code,
  errors: readonly unknown[],
  message: string
): AggregateError;
```

本包构造全部错误时使用的同一套工厂函数，统一打上 `source: STORE_PERSIST_SOURCE` 与 `IStorePersistErrorCode` 身份（经 `@migaia/utils/error` 的 `attachErrorIdentity`）。`createStorePersistAbortError` 构造原生 `DOMException('...', 'AbortError')`，用于 `dispose()` 之后取消在途操作（保持 `name === 'AbortError'` 这一约定，见 [§8](#8-错误参考)）。日常业务代码通常不需要直接调用它们；导出给需要"以 `@migaia/store-persist` 身份抛出自定义诊断错误"的高级集成方，例如自定义 `IPersistUnit` 适配实现。

---

## 11. 常见问题排查

**Q: hydrate 完成之后，我改的字段没有被存进去？**
检查 `debounceMs`——如果设置了防抖，需要等待或调用 `handle.flush()`；也检查 `partialize` 是不是把这个字段裁掉了。

**Q: 用了 `partialize` 之后，其他字段刷新页面变成 `undefined` 了？**
`persistKeyed()`/`persistCollection()` 的默认 `merge` 是整份替换，只 `partialize` 不配 `merge` 会丢字段——见 [§1](#1-核心引擎ipersistunit--persistunit)。`persist()`（store-light）不受影响。

**Q: `persistCollection()` 存的 Map 读回来变成普通对象了？**
确认没有传自定义 `codec` 覆盖掉默认的 `defaultJsonCodec`——自定义 codec 需要自己处理 Map/Set 往返，或者继续用默认 codec。

**Q: `clearFamily()` 之后，页面上还显示着旧数据？**
`clearFamily()` 只删 storage，不清内存——见 [§4](#4-persistkeyed--clearfamily-完整参考store-keyed)，需要调用方自己 `dispose()` 还持有的 handle。

## 构建、测试与排查

仓库根目录：`pnpm --filter @migaia/store-persist fmt` → `lint` → `typecheck` → `typecheck:test` → `test` → `build`。hydrate 失败检查 `handle.ready`/`hydrationError`；写入失败检查 `writeError`，并确认 codec output 与后端能力匹配。
