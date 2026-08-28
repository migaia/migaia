# `@migaia/store-persist`

给 `@migaia/store-light`/`@migaia/store-keyed`/`@migaia/store-indexed` 三种 store 形状统一接一根自动充电线，底层契约是 `@migaia/storage-contract`，存储实现从 `@migaia/storage-web` 的精确 backend 子路径注入：状态变了就（防抖）写进存储，页面/进程重启时自动读回来，hydrate 竞态、版本迁移、写入排队全部托管，不用自己写胶水代码。三条路径共用同一个核心引擎 `persistUnit()`。

## 适用与不适用场景

**适用**：用户设置/草稿/UI 偏好需要跨会话保留（`persist()`）；标签列表/购物车条目/按 id 索引的缓存表需要整体持久化（`persistCollection()`）；按 key 动态生成的状态（每用户/每会话各自的资料）只想持久化其中一部分（`persistKeyed()` + `partialize`/`merge`）；需要批量清空某一类 keyed 持久化记录（`clearFamily()`）；存储里可能是旧版本数据，需要 `version` + `migrate()`。

**不适用**：只是想把一次性数据存进 storage-web、不需要跟内存状态双向同步/不需要迁移，直接用 `@migaia/storage-contract` 的 `IKeyValueStore` 搭配所需 backend 子路径更直接。本包不提供加密——敏感数据不要无加密直接写 `localStorage`，需要的话自己实现一个 `ICodec` 传给 `codec` 选项。

`@migaia/store-persist` 的 production 依赖是 `@migaia/reactive`、`@migaia/storage-contract`、`@migaia/utils`；`@migaia/storage-web` 只在使用其 backend/codec 的 integration 场景作为直接依赖。`@migaia/store-light`/`@migaia/store-keyed`/`@migaia/store-indexed` 是可选 peerDependencies，只用得到哪条路径就只需要装对应的 store 包。

## 安装

```bash
pnpm add @migaia/store-persist @migaia/storage-contract @migaia/storage-web
```

## 目录

- [`persist`：`@migaia/store-light` 适配（默认子路径 `/light`）](#persist)
- [`persistCollection`：`@migaia/store-indexed` 适配（子路径 `/indexed`）](#persistcollection)
- [`persistKeyed` / `clearFamily`：`@migaia/store-keyed` 适配（子路径 `/keyed`）](#persistkeyed)
- [`IPersistHandle`：三条路径共用的返回值](#ipersisthandle)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整 `persistUnit()` 核心引擎签名、`envelope` 格式、codec 集成、错误码与函数级 100% 覆盖，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="persist"></a>

## `persist`：`@migaia/store-light` 适配

```ts
import { persist } from '@migaia/store-persist/light';
// 或：import { persist } from '@migaia/store-persist';（包根统一转出全部子路径）
```

**`persist`｜10 秒上手** —— 给 `createStore()` 产出的扁平 Store 接上自动持久化：

```ts
import { createStore } from '@migaia/store-light';
import { memoryStorage } from '@migaia/storage-web/memory';

const store = createStore({ theme: 'light', fontSize: 14 });
const handle = persist(store, {
  key: 'settings',
  storage: memoryStorage(), // 生产环境换成 localStorage()/indexedDb()
  version: 1,
  debounceMs: 250
});

await handle.ready; // 首次 hydrate 完成（失败会 reject）
store.theme = 'dark'; // 250ms 后自动防抖写回
await handle.flush(); // 需要立即落盘时手动调用
handle.dispose(); // 停止订阅、清计时器、abort 在途 I/O
```

签名：`(store: IPersistableStore, options: IPersistOptions) => IPersistHandle`。`store` 是结构类型（`$runtime`/`$plain`/`$subscribe`/`$hydrate` 四个成员），`createStore()` 返回值天然满足，无需改动。

`IPersistOptions` 全部字段：

- `key: string`（必填）—— 存档在 storage 里的键
- `storage: IPersistStorage`（必填）—— `@migaia/storage-contract` 的 `IKeyValueStore` 契约（`capabilities`/`get`/`set`/`remove`/`keys`）；`@migaia/storage-web` 的 exact backend 子路径提供实现，binary codec 另需 `getBytes`/`setBytes`
- `codec?: ICodec` —— 默认 `defaultJsonCodec`（原生支持 Map/Set 往返）
- `version?: number` —— 默认 `0`，必须是安全非负整数
- `migrate?: (persisted: Record<string, unknown>, fromVersion: number) => Record<string, unknown>` —— `version` 与存档不一致时的转换函数，不提供则版本不一致直接 hydrate 失败
- `partialize?: (state: Record<string, unknown>) => Record<string, unknown>` —— 默认恒等函数，写入前裁剪
- `debounceMs?: number` —— 默认 `0`（不防抖），必须是 `[0, 2147483647]` 内的有限数

注意：`restore()` 内部走 `store.$hydrate()`（宽松写回、未知字段跳过），因此 `persist()` 不需要单独的 `merge` 选项——即使只 `partialize` 出一部分字段，hydrate 也只覆盖这些字段，不影响其余字段。

---

<a id="persistcollection"></a>

## `persistCollection`：`@migaia/store-indexed` 适配

```ts
import { persistCollection } from '@migaia/store-persist/indexed';
```

**`persistCollection`｜10 秒上手** —— 给 `ObservableMap`/`ObservableSet`/`ObservableObject`/`ObservableArray` 接上自动持久化：

```ts
import { observableMap } from '@migaia/store-indexed';
import { localStorage } from '@migaia/storage-web/local-storage';

const cart = observableMap<string, number>(); // sku -> 数量
const handle = persistCollection(cart, { key: 'cart:v1', storage: localStorage() });
cart.set('sku-123', 2); // 默认 debounceMs: 0，下一次写队列排空即写
```

签名：`(collection: IPersistableCollection<TState>, options: IPersistCollectionOptions<TState>) => IPersistHandle`。`collection` 需具备 `runtime`/`snapshot()`/`replace(state)`，四种 `store-indexed` 集合均满足；`replace()` 是原子整体替换，hydrate 失败不会留下"部分写入"的中间态。

`IPersistCollectionOptions<TState>` 全部字段（与 `IPersistOptions` 同名字段语义一致，额外多一个 `merge`）：

- `key: string`（必填）、`storage: IPersistStorage`（必填）、`codec?: ICodec`（默认 `defaultJsonCodec`）、`version?: number`（默认 `0`）、`debounceMs?: number`（默认 `0`）
- `migrate?: (persisted: TState, fromVersion: number) => TState`
- `partialize?: (state: TState) => Partial<TState>` —— 默认恒等函数
- `merge?: (persisted: Partial<TState>, current: TState) => TState` —— 默认对 plain object 做启动快照三向合并，数组/Map/Set 等非 plain 形状整体替换；一旦自定义 `partialize` 只存部分字段，且状态本身是数组/Map/Set，**必须**提供匹配的 `merge`，否则默认合并会丢数据

---

<a id="persistkeyed"></a>

## `persistKeyed` / `clearFamily`：`@migaia/store-keyed` 适配

```ts
import { persistKeyed, clearFamily } from '@migaia/store-persist/keyed';
```

**`persistKeyed`｜10 秒上手** —— 给 `AtomStore` 按 key 动态生成的状态各自接一份独立持久化（只存部分字段的典型场景：session 只存 `refreshToken`）：

```ts
import { createAtomStore, familyDef } from '@migaia/store-keyed';
import { indexedDb } from '@migaia/storage-web/indexed-db';

const session = familyDef(() => ({ accessToken: '', refreshToken: '' }));
const atomStore = createAtomStore(runtime);
const storage = indexedDb({ dbName: 'app' });

const { value, dispose } = persistKeyed(atomStore, session('u1'), 'u1', {
  namespace: 'sessions',
  storage,
  partialize: (v) => ({ refreshToken: v.refreshToken }),
  merge: (persisted, current) => ({ ...current, ...persisted })
});
```

签名：`<T>(atomStore: IAtomStore, def: IWritableAtomDefinition<T>, id: string, options: IPersistKeyedOptions<T>) => IPersistKeyedHandle<T>`。每次调用各自创建一个独立的持久化单位，storage key 为 `${namespace}:${id}`；`dispose()` 只影响这一个 key。

`IPersistKeyedOptions<T>` 全部字段：

- `namespace: string`（必填）—— storage key 前缀，`clearFamily()` 靠它过滤
- `storage: IPersistStorage`（必填）
- `codec?: ICodec`（默认 `defaultJsonCodec`）、`version?: number`（默认 `0`）、`debounceMs?: number`（默认 `0`）
- `partialize?: (value: T) => Partial<T>` —— 默认恒等函数
- `merge?: (persisted: Partial<T>, current: T) => T` —— 语义同 `persistCollection` 的 `merge`

**`clearFamily`｜5 秒上手** —— 批量清空某个 namespace 下的全部持久化记录（不清理内存中已实例化的 `AtomStore` 状态）：

```ts
const deletedCount = await clearFamily(storage, 'sessions');
```

签名：`(storage: IPersistStorage, namespace: string) => Promise<number>`；两个参数均必填，无可选项，返回实际删除的条目数。

---

<a id="ipersisthandle"></a>

## `IPersistHandle`：三条路径共用的返回值

`persist()`/`persistCollection()` 返回完整 `IPersistHandle`；`persistKeyed()` 只返回 `{ value, dispose() }`。

**`handle.ready` / `handle.settled`｜3 秒上手**：

```ts
await handle.ready; // hydrate 成功 resolve，失败 reject
await handle.settled; // 不管成功失败都 resolve
```

**`handle.flush()` / `handle.clear()`｜5 秒上手**：

```ts
await handle.flush(); // 立即写并等待完成；dispose 期间以 AbortError 结束
await handle.clear(); // 排队删除存档，不重置内存状态
```

均无参数；`dispose()` 之后调用两者都会立即以 `name: 'AbortError'` 的错误 reject。

`handle.status`/`handle.error`/`handle.hydrated`/`handle.hydrationStatus`/`handle.writeStatus` 等只读信号的完整状态取值表，见 [USEGUIDE §6](./USEGUIDE.md#6-ipersisthandle-完整-api-参考)。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 三种 store 形状统一接入 + 登出时统一收尾

```ts
import { createStore } from '@migaia/store-light';
import { createAtomStore, familyDef } from '@migaia/store-keyed';
import { observableSet } from '@migaia/store-indexed';
import { indexedDb } from '@migaia/storage-web/indexed-db';
import { persist } from '@migaia/store-persist/light';
import { persistCollection } from '@migaia/store-persist/indexed';
import { persistKeyed, clearFamily } from '@migaia/store-persist/keyed';
import { createRuntime } from '@migaia/reactive';

const runtime = createRuntime();
const storage = indexedDb({ dbName: 'app' });

const settings = createStore({ theme: 'light' });
const settingsHandle = persist(settings, { key: 'settings', storage, version: 1 });

const recentlyViewed = observableSet<string>(undefined, {}, runtime);
const recentHandle = persistCollection(recentlyViewed, { key: 'recent', storage });

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

async function logout(activeSession: { dispose(): void }) {
  await Promise.all([settingsHandle.flush(), recentHandle.flush()]);
  await clearFamily(storage, 'sessions');
  activeSession.dispose();
}
```

### 2. 版本迁移：schema 从 v1 升级到 v2

```ts
const handle = persist(store, {
  key: 'settings',
  storage,
  version: 2,
  migrate: (persisted, fromVersion) => {
    if (fromVersion === 1)
      return { ...persisted, fontSize: (persisted as { size?: number }).size ?? 14 };
    return persisted;
  }
});
```

### 3. `flush()` 在页面卸载前确保落盘

```ts
window.addEventListener('beforeunload', () => {
  void settingsHandle.flush(); // 浏览器可能不等待，但尽力落盘（配合较小 debounceMs 更稳妥）
});
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test && pnpm run build
```
