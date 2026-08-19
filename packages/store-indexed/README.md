# `@migaia/store-indexed`

显式方法的细粒度响应式集合：`ObservableObject`/`ObservableArray`/`ObservableMap`/`ObservableSet` 四种容器，读写一律走命名方法（`get`/`set`/`has`/`peek`……），不用 Proxy 拦截整个对象/数组——因此可以做到"只读了哪个 key/索引，就只依赖哪个 key/索引"。每个 key/索引对应的响应式格子（cell）都是惰性创建、自动回收的。

## 适用与不适用场景

**适用**：表格行、消息列表一类大规模集合，但只有少数条目被 UI 订阅；需要"改一个 key/索引，只有读过它的地方重算"的细粒度依赖；需要跟 `@migaia/store-light` 的 `IMutationGuard` 集成，把"只能在 action 内写"这类策略下沉到集合层。

**不适用**：只需要一个普通的响应式对象/数组、不关心细粒度依赖或容量——直接用 `@migaia/reactive` 的 `Signal<T>` 更省事；需要"按值稳定标识、删除/插入不改变其余成员定位"的实体集合——`ObservableArray` 是纯索引语义，`splice`/`pop`/`replace` 会移动后续索引对应的值，这不是本包的设计目标。

## 安装

```bash
pnpm add @migaia/store-indexed
```

依赖 `@migaia/reactive`（响应式运行时，提供 `IRuntime`/`defaultRuntime`/`Signal`）与 `@migaia/store-light`（提供 `IMutationGuard` 类型），二者通常已经在同一个 monorepo 里作为对等依赖存在。

## 目录

- [集合类型与工厂函数模块](#集合类型与工厂函数模块)
- [操作常量模块](#操作常量模块)
- [错误模块](#错误模块)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整方法签名、cell 惰性创建与回收的精确时序、错误信息全表、多 Runtime 场景，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="集合类型与工厂函数模块"></a>

## 集合类型与工厂函数模块

```ts
import {
  ObservableObject,
  ObservableArray,
  ObservableMap,
  ObservableSet,
  observableObject,
  observableArray,
  observableMap,
  observableSet,
  type IObservableCollectionOptions
} from '@migaia/store-indexed';
```

**`ObservableObject`｜10 秒上手** —— 键值对容器，`get`/`peek`/`has`/`set`/`update`/`delete`/`keys`/`snapshot`/`replace`/`prune`/`dispose`：

```ts
const user = new ObservableObject({ name: 'Ada', age: 30 });
user.get('name'); // 追踪读：处在 effect/computed 内时只订阅 'name' 这个 cell
user.set('age', 31); // 值变化：触发修订信号，已建 cell 的 'age' 同步更新
user.snapshot(); // 冻结的、Object.create(null) 起始的浅拷贝快照
user.dispose(); // 用完必须释放，级联 dispose 全部内部 Signal
```

构造函数全部参数（`new ObservableObject<T extends Record<string, unknown>>(initial, runtime?, options?)`）：

- `initial: T`（必填）—— 初始键值对；类型参数 `T` 由它推导，之后 `get`/`set`/`update`/`delete`/`keys` 的 key 被约束为 `keyof T & string`
- `runtime?: IRuntime` —— 默认 `defaultRuntime`（来自 `@migaia/reactive`）
- `options?: IObservableCollectionOptions` —— 默认 `{}`；字段见下方"`IObservableCollectionOptions` 全部字段"

**`ObservableArray`｜10 秒上手** —— 索引数组，`at`/`length`/`peek`/`snapshot`/`set`/`push`/`pop`/`splice`/`replace`/`clear`/`prune`/`dispose`：

```ts
const rows = new ObservableArray([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
rows.at(1); // 只读了索引 1，只订阅索引 1
rows.set(1, { id: 'b2' }); // 触发依赖索引 1 的订阅者
rows.push({ id: 'd' }); // 改变 length，触发依赖 length/结构 的订阅者
rows.dispose();
```

构造函数全部参数（`new ObservableArray<T>(initial?, runtime?, options?)`）：

- `initial?: Iterable<T>` —— 默认 `[]`；接受任意可迭代对象（含字符串，按字符物化）
- `runtime?: IRuntime` —— 默认 `defaultRuntime`
- `options?: IObservableCollectionOptions` —— 默认 `{}`

**`ObservableMap`｜10 秒上手** —— K/V 表，`get`/`peek`/`has`/`set`/`delete`/`clear`/`replace`/`keys`/`valuesArray`/`entries`/`snapshot`/`prune`/`dispose`：

```ts
const users = new ObservableMap<string, { name: string }>();
users.set('u1', { name: 'Ann' }); // 键不存在，触发结构信号 + 迭代信号
users.get('u1'); // 追踪读，惰性建 'u1' 的 cell
users.dispose();
```

构造函数全部参数（`new ObservableMap<K, V>(initial?, runtime?, options?)`）：

- `initial?: ReadonlyMap<K, V> | Iterable<readonly [K, V]>` —— 默认 `[]`（空表）；字符串输入直接拒绝（只接受 `[K, V]` entry 形状）
- `runtime?: IRuntime` —— 默认 `defaultRuntime`
- `options?: IObservableCollectionOptions` —— 默认 `{}`

**`ObservableSet`｜10 秒上手** —— 成员集合，`has`/`add`/`delete`/`clear`/`replace`/`valuesArray`/`snapshot`/`prune`/`dispose`：

```ts
const tags = new ObservableSet(['a', 'b']);
tags.has('a'); // 追踪读，惰性建 'a' 的 membership cell
tags.add('c'); // 触发结构信号
tags.dispose();
```

构造函数全部参数（`new ObservableSet<T>(initial?, runtime?, options?)`）：

- `initial?: Iterable<T>` —— 默认 `[]`；接受任意可迭代对象（含字符串，按字符物化）
- `runtime?: IRuntime` —— 默认 `defaultRuntime`
- `options?: IObservableCollectionOptions` —— 默认 `{}`

`IObservableCollectionOptions` 全部字段（四个类共用）：

- `mutationGuard?: IMutationGuard`（来自 `@migaia/store-light`）—— 默认无；每次写操作前调用其 `assertMutationAllowed(operation)`，不通过则抛错
- `debugName?: string` —— 默认取类名（如 `'ObservableArray'`）；内部各 Signal 的调试名前缀

**`observableObject`/`observableArray`/`observableMap`/`observableSet`｜5 秒上手** —— 类的工厂函数版本，**参数顺序与类构造函数不同**：

```ts
import { observableArray } from '@migaia/store-indexed';

const rows = observableArray([{ id: 'a' }], {}, myRuntime);
```

全部参数（注意顺序是 `(initial, options, runtime)`，类构造函数是 `(initial, runtime, options)`）：

- `initial`（`observableObject` 必填，其余可选，默认 `[]`）—— 同对应类构造函数的 `initial`
- `options?: IObservableCollectionOptions` —— 默认 `{}`
- `runtime?: IRuntime` —— 默认 `defaultRuntime`

混用两套参数顺序会把 `options` 当成 `runtime` 传（或反过来）；`options`/`runtime` 结构不同，TypeScript 通常会在传入具体值时拦住，但都省略或用 `undefined` 传递时编译期不一定能拦住，务必按各自签名顺序传参。

---

<a id="操作常量模块"></a>

## 操作常量模块

```ts
import { IndexedOperation, type IIndexedOperation } from '@migaia/store-indexed';
```

**`IndexedOperation`｜3 秒上手** —— 稳定的操作名常量，供诊断/日志/中间件按操作类型分支，本包自身的方法不直接引用它（它是给消费方分类用的公共词表）：

```ts
if (event.operation === IndexedOperation.write) reportMutation(event);
```

全部取值：`read`(`'read'`)、`write`(`'write'`)、`delete`(`'delete'`)。`IIndexedOperation` 是其取值的联合类型，无调用参数。

---

<a id="错误模块"></a>

## 错误模块

```ts
import {
  StoreIndexedErrorCode,
  type IStoreIndexedErrorCode,
  STORE_INDEXED_SOURCE,
  createStoreIndexedError,
  createStoreIndexedRangeError,
  createStoreIndexedTypeError
} from '@migaia/store-indexed';
```

**`StoreIndexedErrorCode`｜3 秒上手** —— 稳定错误码表，用于 `switch`/比较，调用方应按 `code` 判断语义、不依赖消息文本：

```ts
try {
  collection.at(-1);
} catch (error) {
  if ((error as { code?: string }).code === StoreIndexedErrorCode.collectionDisposed) {
    // ...
  }
}
```

全部取值：`invalidOption`(`INVALID_OPTION`)、`collectionDisposed`(`COLLECTION_DISPOSED`)、`indexOutOfRange`(`INDEX_OUT_OF_RANGE`)、`invalidIndex`(`INVALID_INDEX`)、`crossRuntime`(`CROSS_RUNTIME`)。`IStoreIndexedErrorCode` 是其取值的联合类型。

**`STORE_INDEXED_SOURCE`｜3 秒上手** —— 本包所有边界错误的 `source` 字段固定值，无调用参数：

```ts
STORE_INDEXED_SOURCE; // '@migaia/store-indexed'
```

**`createStoreIndexedError`/`createStoreIndexedRangeError`/`createStoreIndexedTypeError`｜5 秒上手** —— 构造带 `(source, code)` 身份的 `Error`/`RangeError`/`TypeError`，供扩展本包行为（例如自定义 `mutationGuard`）时复用同一套错误身份约定：

```ts
throw createStoreIndexedTypeError(
  StoreIndexedErrorCode.invalidOption,
  'custom guard rejected the mutation'
);
```

三者签名一致，全部参数：

- `code: IStoreIndexedErrorCode`（必填）—— 通常取自 `StoreIndexedErrorCode`
- `message: string`（必填）
- `options?: { readonly cause?: unknown }` —— 可选，仅 `createStoreIndexedError`/`createStoreIndexedTypeError` 支持；提供后转发给原生 `Error`/`TypeError` 构造函数的 `{ cause }`；`createStoreIndexedRangeError` 不接受第三参数

返回值分别是原生 `Error`/`RangeError`/`TypeError` 实例（保留 `instanceof` 身份），额外携带不可写的 `source: '@migaia/store-indexed'` 与 `code` 字段。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 表格行细粒度订阅 + 定期 `prune()`

```ts
import { ObservableArray } from '@migaia/store-indexed';
import { Effect } from '@migaia/reactive';

const rows = new ObservableArray<{ id: string; name: string }>(
  Array.from({ length: 100_000 }, (_, i) => ({ id: String(i), name: `row-${i}` }))
);

// 只有被订阅的 5 行才会实体化 cell，其余 99995 行不占用任何 Signal
const watched = [0, 1, 2, 3, 4].map(
  (index) => new Effect(() => render(index, rows.at(index)), rows.runtime)
);

rows.splice(0, 1); // 索引语义整体后移一位
rows.prune(); // 主动回收 splice 后失去语义意义的僵尸 cell

for (const effect of watched) effect.dispose();
rows.dispose();
```

### 2. `mutationGuard` 集成：仅允许在 action 内写入

```ts
import { ObservableMap } from '@migaia/store-indexed';
import { MutationPolicy } from '@migaia/store-middleware';

const guard = new MutationPolicy('actions-only');
const users = new ObservableMap<string, { name: string }>(
  [],
  undefined, // 使用默认 Runtime
  { mutationGuard: guard, debugName: 'users' }
);

try {
  users.set('u1', { name: 'Ann' }); // 抛错：不在 action 内
} catch {
  guard.runInAction(() => users.set('u1', { name: 'Ann' })); // 成功
}
```

### 3. 多 Runtime 隔离 + 跨 Runtime 保护

```ts
import { createRuntime, Effect } from '@migaia/reactive';
import { ObservableSet, StoreIndexedErrorCode } from '@migaia/store-indexed';

const runtimeA = createRuntime();
const runtimeB = createRuntime();
const tagsInA = new ObservableSet(['a', 'b'], runtimeA);

new Effect(() => {
  try {
    tagsInA.has('a'); // 当前 effect 属于 runtimeB，读了 runtimeA 的集合
  } catch (error) {
    if ((error as { code?: string }).code === StoreIndexedErrorCode.crossRuntime) {
      // 预期内的跨 Runtime 保护
    }
  }
}, runtimeB);
```

### 4. 自定义错误保留同一套 `(source, code)` 约定

```ts
import { createStoreIndexedError, StoreIndexedErrorCode } from '@migaia/store-indexed';

function assertNonEmptyName(name: string): void {
  if (name.length === 0) {
    throw createStoreIndexedError(
      StoreIndexedErrorCode.invalidOption,
      '[store] name must not be empty'
    );
  }
}
```

### 5. 只读快照批量遍历，避免误建十万个 cell

```ts
import { ObservableObject } from '@migaia/store-indexed';

const bigTable = new ObservableObject(
  Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => [`k${i}`, i]))
);

// peek() 不建 cell，适合一次性批量导出
let sum = 0;
for (const key of bigTable.keys()) sum += bigTable.peek(key);
bigTable.dispose();
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test && pnpm run build
```

浏览器集成路径另跑：

```bash
pnpm run typecheck:e2e && pnpm run test:e2e
```
