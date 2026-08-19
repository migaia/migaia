# `@migaia/store-indexed` 使用指南

本指南逐个模块列出全部导出 API 的完整签名、边界行为与错误码。包的定位与安装方式见 [README](./README.md)。

## 目录

- [设计动机与核心机制](#设计动机与核心机制)
- [集合类型与工厂函数模块](#集合类型与工厂函数模块)
- [操作常量模块](#操作常量模块)
- [错误模块](#错误模块)
- [生命周期与资源释放](#生命周期与资源释放)
- [与 `mutationGuard` 集成](#与-mutationguard-集成)
- [多 Runtime 场景](#多-runtime-场景)
- [组合工作流示例](#组合工作流示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="设计动机与核心机制"></a>

## 设计动机与核心机制

### 为什么不用 Proxy

Proxy 拦截读写虽然写起来像原生对象/数组，但拦截粒度是"整个对象/数组"，很难做到"只读了 key A，就只依赖 key A"而不牵连其他 key。`store-indexed` 反其道而行：四个类都是显式方法（`get`/`set`/`has`/`at`……），代价是调用方要多写几个字符，换来的是精确到单个 key/索引的依赖粒度，以及完全可预测的追踪时机（只有调用追踪型方法才会建依赖，不存在"不小心读了一个属性就建了依赖"的意外）。

### Cell：惰性物化的响应式格子

每个集合内部维护两样东西：一份普通的 JS 存储（`Map`/数组/`Set`），和一个内部的键 → `Signal` 池。**只有第一次以"追踪方式"读某个 key/索引时，才会为它创建一个 `Signal`（cell）**：

```ts
const users = new ObservableMap<string, { name: string }>();
users.set('u1', { name: 'Ann' });

// 到这里，'u1' 还没有 cell —— 没人以追踪方式读过它
users.get('u1'); // 现在为 'u1' 创建了 cell
```

cell 的生命周期完全自动：

- **无人订阅就回收**：一个新建的 cell 挂上 `onUnobserved` 钩子——它的最后一个订阅者取消订阅时，立即尝试回收。
- **从未被订阅也会回收**：如果一次 cell 创建之后，直到当前微任务结束都没有任何 effect/computed 订阅这个 cell（比如只是一次性读了一下），会在微任务尾部被当作"从未使用"回收，不会因为一次孤立的读而永久占用内存。
- **值消失后不会立刻消失**：某个 key 被 `delete()` 后，如果它的 cell 仍被订阅（还有依赖它的 effect 存在），cell 不会被摘除——它会把值置为"缺失"标记，继续存在，直到订阅者自己解除订阅。这保证了"正在观察这个 key 的代码，会正确看到它变成 undefined"，而不是让 cell 无声消失导致订阅者拿到陈旧状态。

### 结构信号 / 修订信号 / 迭代信号

除了逐 key 的 cell，每个集合还维护 1～2 个"全局"信号，用来支持不针对单个 key 的读取（比如 `size`、`keys()`、`snapshot()`）：

| 信号                  | 存在于                                | 何时触发                        | 被谁读取                                      |
| --------------------- | ------------------------------------- | ------------------------------- | --------------------------------------------- |
| 结构信号（structure） | 全部四个类                            | 增删 key/成员，或数组长度变化   | `keys()`、`size`、`length`、`has()`（Object） |
| 修订信号（revision）  | `ObservableObject`、`ObservableArray` | 任意值变化（含同 key 换新值）   | `snapshot()`                                  |
| 迭代信号（iteration） | 仅 `ObservableMap`                    | 任意内容变化（含同 key 换新值） | `valuesArray()`、`entries()`、`snapshot()`    |

这套拆分的意义：`keys()` 只关心"有哪些 key"，不该在某个 key 的值变化（key 集合不变）时重新触发；`snapshot()`/`valuesArray()` 这类整体读取则必须在任何一处值变化时都重新触发。`ObservableSet` 没有独立的修订/迭代信号——集合的"值"就是成员本身，结构信号已经完整覆盖了"内容变化"。

### 追踪读 vs 非追踪读

多数方法（`get`/`at`/`has`/`keys`/`snapshot`/`size`/`length`……）在当前 Runtime 处于追踪状态（身处一个 effect/computed 的求值过程中）时会建立依赖；不处于追踪状态时，直接读内部存储，**不会**创建 cell。

`peek()`（`ObservableObject`/`ObservableArray`/`ObservableMap`）是显式的非追踪读——哪怕当前正处于追踪状态，也绝不建立依赖、绝不创建 cell。用于批量遍历一个大集合但不想为每个 key 都物化一个 Signal 的场景。`ObservableSet` 没有 `peek()`，因为它没有"按 key 查值"的读取形态，`has()` 自身已经在非追踪场景下直接查内部 `Set`。

### 跨 Runtime 保护

每个集合在构造时绑定到一个具体的 `IRuntime`。如果某处代码正处于**另一个** Runtime 的追踪状态中，却读了这个集合（属于不同的 Runtime），会立即抛错，而不是把两张依赖图悄悄接到一起——那样产生的 bug 极难定位。同一个 Runtime 内部的多次追踪读取不受影响。

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

### 构造参考

四个类的构造函数签名形态一致：

```ts
new ObservableObject<T extends Record<string, unknown>>(
  initial: T, runtime?: IRuntime, options?: IObservableCollectionOptions
);
new ObservableArray<T>(
  initial?: Iterable<T>, runtime?: IRuntime, options?: IObservableCollectionOptions
);
new ObservableMap<K, V>(
  initial?: ReadonlyMap<K, V> | Iterable<readonly [K, V]>,
  runtime?: IRuntime, options?: IObservableCollectionOptions
);
new ObservableSet<T>(
  initial?: Iterable<T>, runtime?: IRuntime, options?: IObservableCollectionOptions
);
```

```ts
type IObservableCollectionOptions = {
  readonly mutationGuard?: IMutationGuard; // 来自 @migaia/store-light
  readonly debugName?: string;
};
```

| 参数                    | 类型                                           | 必填性                            | 默认值                                      | 说明                                                                     |
| ----------------------- | ---------------------------------------------- | --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `initial`               | 视类型而定                                     | `ObservableObject` 必填，其余可选 | `[]`（Array/Set）、`[]`（Map，等价空表）    | 初始内容；`ObservableObject` 没有默认值，因为泛型 `T` 必须由初始对象推导 |
| `runtime`               | `IRuntime`                                     | 可选                              | `defaultRuntime`（来自 `@migaia/reactive`） | 集合绑定的响应式 Runtime，决定它归属哪张依赖图                           |
| `options.mutationGuard` | `IMutationGuard`（来自 `@migaia/store-light`） | 可选                              | 无                                          | 每次写操作前调用 `assertMutationAllowed(operation)`，不通过则抛错        |
| `options.debugName`     | `string`                                       | 可选                              | 类名（如 `'ObservableArray'`）              | 内部各 Signal 的调试名前缀，用于诊断/追踪工具                            |

**`ObservableObject<T extends Record<string, unknown>>` 的类型参数由 `initial` 推导**，之后 `get`/`set`/`update`/`delete`/`keys` 的 key 都被约束为 `T` 的字面量 key（`keyof T & string`）——不能用它添加初始对象里没有的新 key（`set` 的类型签名不允许，但 `delete` 接受 `keyof T & string` 中的任意合法 key）。

Iterable 输入采用统一的前置物化契约：`Symbol.iterator` getter 与捕获函数各调用一次，函数 receiver 为原 iterable；getter/call/`next()`/Map 条目形状任一失败都会在 ownership 或 replace mutation 前转换为 tagged `INVALID_OPTION`，原错误保留在 `cause`。Array/Set 接受字符串并按字符物化；Map 只接受 `[K, V]` entry iterable，字符串同步拒绝。`options` 非对象（`null`/非 object 类型）会同步抛出 `TypeError`（`INVALID_OPTION`），`options.debugName` 非 `undefined` 且非字符串同样抛出。

### `ObservableObject` 完整参考

```ts
class ObservableObject<T extends Record<string, unknown>> implements IDisposable {
  readonly runtime: IRuntime;
  get disposed(): boolean;
  get<K extends keyof T & string>(key: K): T[K];
  peek<K extends keyof T & string>(key: K): T[K];
  has(key: keyof T & string): boolean;
  set<K extends keyof T & string>(key: K, value: T[K]): void;
  update<K extends keyof T & string>(key: K, updater: (value: T[K]) => T[K]): void;
  delete(key: keyof T & string): boolean;
  keys(): readonly (keyof T & string)[];
  snapshot(): Readonly<T>;
  replace(next: T): void;
  prune(): number;
  dispose(): void;
}
```

| 方法                   | 参数类型                                 | 返回值                                         | 追踪读/写                                    | 副作用                                                                                                                                                      |
| ---------------------- | ---------------------------------------- | ---------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get(key)`             | `key: K`                                 | `T[K]`                                         | 追踪读，惰性建 cell                          | 无                                                                                                                                                          |
| `peek(key)`            | `key: K`                                 | `T[K]`                                         | 非追踪读                                     | 无，不建 cell                                                                                                                                               |
| `has(key)`             | `key: keyof T & string`                  | `boolean`                                      | 追踪读（依赖结构信号）                       | 无                                                                                                                                                          |
| `set(key, value)`      | `key: K, value: T[K]`                    | `void`                                         | 写                                           | 若 key 是新增的，触发结构信号；若值真的变了（`Object.is` 判定），触发修订信号；已建 cell 的 key 会同步更新 cell 值。整个操作在一次 `runtime.batch()` 内完成 |
| `update(key, updater)` | `key: K, updater: (value: T[K]) => T[K]` | `void`                                         | 写                                           | 先通过 mutation guard，再执行 `updater` 并提交结果；`updater` 非函数抛 `TypeError`（`INVALID_OPTION`）；guard 拒绝时 `updater` 不执行                       |
| `delete(key)`          | `key: keyof T & string`                  | `boolean`（key 是否存在过）                    | 写                                           | key 不存在直接返回 `false` 且不触发任何信号；存在则清空值、置 cell 为缺失、触发结构信号与修订信号，并尝试 tombstone 对应 cell                               |
| `keys()`               | 无                                       | 当前全部 key 的数组                            | 追踪读（依赖结构信号）                       | 无                                                                                                                                                          |
| `snapshot()`           | 无                                       | 冻结的、`Object.create(null)` 起始的浅拷贝对象 | 追踪读（依赖修订信号），非追踪上下文不建依赖 | 无。使用空原型对象是为了让来自外部数据的 `__proto__` 之类 key 被当成普通数据 key，不触发 `Object.prototype` 的 setter                                       |
| `replace(next)`        | `next: T`                                | `void`                                         | 写                                           | 计算出多余的 key 先逐个 `delete`，再对 `next` 的每个 key 调 `set`；整体在一次 `batch()` 内完成                                                              |
| `prune()`              | 无                                       | 本次回收的 cell 数                             | —                                            | 对每个已不在当前 key 集合里的 cell，尝试立即 tombstone（仅当它已无订阅者）                                                                                  |
| `dispose()`            | 无                                       | `void`                                         | —                                            | 释放全部拥有的 Signal；重复调用是安全的空操作                                                                                                               |

写操作前都会先调用 `assertMutation(operation)`（含 `assertActive()` 与 `mutationGuard?.assertMutationAllowed()`），已 dispose 的集合或未通过 guard 校验的写操作会在这里抛错。`key` 非字符串会抛出 `TypeError`（`INVALID_OPTION`）。

### `ObservableArray` 完整参考

```ts
class ObservableArray<T> implements IDisposable {
  readonly runtime: IRuntime;
  get disposed(): boolean;
  get length(): number;
  at(index: number): T | undefined;
  snapshot(): readonly T[];
  peek(): readonly T[];
  set(index: number, value: T): void;
  push(...values: readonly T[]): number;
  pop(): T | undefined;
  splice(start: number, deleteCount?: number, ...items: readonly T[]): readonly T[];
  replace(values: Iterable<T>): void;
  clear(): void;
  prune(): number;
  dispose(): void;
}
```

| 方法                                    | 参数类型                                                   | 返回值                                   | 追踪读/写                                             | 副作用                                                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `length`                                | —                                                          | `number`                                 | 追踪读（依赖结构信号）                                | 无                                                                                                                                                                                 |
| `at(index)`                             | `index: number`（支持负数，从末尾数）                      | `T \| undefined`                         | 追踪读，惰性建 cell；越界或负索引都会额外依赖结构信号 | 无。非整数索引抛 `TypeError`（`INVALID_INDEX`）                                                                                                                                    |
| `snapshot()`                            | 无                                                         | 冻结数组                                 | 追踪读（依赖修订信号）                                | 无                                                                                                                                                                                 |
| `peek()`                                | 无                                                         | 冻结数组                                 | 非追踪读                                              | 无，不建 cell                                                                                                                                                                      |
| `set(index, value)`                     | `index: number, value: T`                                  | `void`                                   | 写                                                    | 越界抛 `RangeError`（`INDEX_OUT_OF_RANGE`）；值与旧值 `Object.is` 相等时直接跳过（不触发任何信号）；否则更新已建的 cell 并触发修订信号                                             |
| `push(...values)`                       | `values: readonly T[]`（rest 参数）                        | 追加后的新长度                           | 写                                                    | 空参数直接返回当前长度、不触发信号；否则为已建 cell 的新增位置同步值，触发结构信号与修订信号，整体在一次 `batch()` 内完成                                                          |
| `pop()`                                 | 无                                                         | 被移除的最后一项，或空数组时 `undefined` | 写                                                    | 空数组不触发任何信号；否则把末位 cell 置为缺失，触发结构信号与修订信号                                                                                                             |
| `splice(start, deleteCount?, ...items)` | `start: number, deleteCount?: number, items: readonly T[]` | 被删除项组成的冻结数组                   | 写                                                    | 内部构造出新数组后整体走 `replace` 逻辑                                                                                                                                            |
| `replace(values)`                       | `values: Iterable<T>`                                      | `void`                                   | 写                                                    | 见下方 `#replaceInternal` 说明                                                                                                                                                     |
| `clear()`                               | 无                                                         | `void`                                   | 写                                                    | 等价于 `replace([])`                                                                                                                                                               |
| `prune()`                               | 无                                                         | 本次回收的 cell 数                       | —                                                     | **对全部已物化 cell 无条件尝试 tombstone**，不只是越界的 cell——`splice`/`pop` 之后"索引"这个身份本身就不再稳定，任何一个既存 cell 都可能对应错的位置，因此凡是无订阅者的都值得回收 |
| `dispose()`                             | 无                                                         | `void`                                   | —                                                     | 释放全部拥有的 Signal                                                                                                                                                              |

`#replaceInternal`（`replace`/`splice`/`clear` 共用）的精确行为：只遍历**已经物化的 cell**（而不是全部索引）逐个更新值——未物化的索引没有任何订阅者需要通知，等真的被读到时会直接从新数组里取值；只有当新旧长度不同，或存在任意一处值变化（`Object.is` 逐项比较）时才触发修订信号；只有长度变化才触发结构信号。这个设计避免了"replace 一个十万项数组，只有 5 个索引被订阅"时做十万次无意义的 diff。

### `ObservableMap` 完整参考

```ts
class ObservableMap<K, V> implements IDisposable {
  readonly runtime: IRuntime;
  get disposed(): boolean;
  get size(): number;
  get(key: K): V | undefined;
  peek(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): this;
  delete(key: K): boolean;
  clear(): void;
  replace(next: ReadonlyMap<K, V> | Iterable<readonly [K, V]>): void;
  keys(): readonly K[];
  valuesArray(): readonly V[];
  entries(): readonly (readonly [K, V])[];
  snapshot(): ReadonlyMap<K, V>;
  prune(): number;
  dispose(): void;
}
```

| 方法              | 参数类型                                         | 返回值                                     | 追踪读/写                                                         | 副作用                                                                                                                                                    |
| ----------------- | ------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `size`            | —                                                | `number`                                   | 追踪读（依赖结构信号）                                            | 无                                                                                                                                                        |
| `get(key)`        | `key: K`                                         | `V \| undefined`                           | 追踪读，惰性建 cell                                               | 无                                                                                                                                                        |
| `peek(key)`       | `key: K`                                         | `V \| undefined`                           | 非追踪读                                                          | 无，不建 cell                                                                                                                                             |
| `has(key)`        | `key: K`                                         | `boolean`                                  | 追踪读，惰性建 cell（membership 本身按 key 追踪，不是靠结构信号） | 无                                                                                                                                                        |
| `set(key, value)` | `key: K, value: V`                               | `this`                                     | 写                                                                | 已存在且 `Object.is` 判定值未变时直接跳过；否则更新 cell、按需触发结构信号，始终触发迭代信号                                                              |
| `delete(key)`     | `key: K`                                         | `boolean`（key 是否存在过）                | 写                                                                | 不存在直接返回 `false`；存在则置 cell 缺失、触发结构信号与迭代信号，并尝试 tombstone                                                                      |
| `clear()`         | 无                                               | `void`                                     | 写                                                                | 空表直接跳过；否则遍历**已物化**的 cell 逐个置缺失并 tombstone，一次性触发结构信号与迭代信号（不是逐 key 调用 `delete()`，避免为每个 key 各触发一轮信号） |
| `replace(next)`   | `ReadonlyMap<K, V> \| Iterable<readonly [K, V]>` | `void`                                     | 写                                                                | 完整物化并验证后原子替换；失败保持旧 Map；整次替换最多各触发一次结构/迭代通知，内容相同则不通知                                                           |
| `keys()`          | 无                                               | 当前 key 数组                              | 追踪读（依赖结构信号）                                            | 无                                                                                                                                                        |
| `valuesArray()`   | 无                                               | 冻结的值数组                               | 追踪读（依赖迭代信号）                                            | 无                                                                                                                                                        |
| `entries()`       | 无                                               | 冻结的 `[K, V]` 元组数组，元组本身也被冻结 | 追踪读（依赖迭代信号）                                            | 无                                                                                                                                                        |
| `snapshot()`      | 无                                               | 新建的普通 `Map` 副本                      | 追踪读（依赖迭代信号）                                            | 无                                                                                                                                                        |
| `prune()`         | 无                                               | 本次回收的 cell 数                         | —                                                                 | 对每个已不在当前 key 集合里的 cell 尝试 tombstone                                                                                                         |
| `dispose()`       | 无                                               | `void`                                     | —                                                                 | 释放全部拥有的 Signal                                                                                                                                     |

**`has()` 的依赖粒度**：`ObservableMap.has(key)` 依赖的是这个 key 自己的 cell，不是结构信号——改动一个不相关的 key 不会让"只关心某个 key 是否存在"的订阅者重算。这与 `ObservableObject.has()`（依赖结构信号，因为 Object 的 key 集合天然更小、更适合整体追踪）刻意不同。

### `ObservableSet` 完整参考

```ts
class ObservableSet<T> implements IDisposable {
  readonly runtime: IRuntime;
  get disposed(): boolean;
  get size(): number;
  has(value: T): boolean;
  add(value: T): this;
  delete(value: T): boolean;
  clear(): void;
  replace(next: Iterable<T>): void;
  valuesArray(): readonly T[];
  snapshot(): ReadonlySet<T>;
  prune(): number;
  dispose(): void;
}
```

| 方法            | 参数类型      | 返回值                  | 追踪读/写                                  | 副作用                                                                                 |
| --------------- | ------------- | ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `size`          | —             | `number`                | 追踪读（依赖结构信号）                     | 无                                                                                     |
| `has(value)`    | `value: T`    | `boolean`               | 追踪读，惰性建 cell（membership 按值追踪） | 无                                                                                     |
| `add(value)`    | `value: T`    | `this`                  | 写                                         | 已存在直接跳过；否则更新 cell 为 `true`，触发结构信号                                  |
| `delete(value)` | `value: T`    | `boolean`（是否存在过） | 写                                         | 不存在返回 `false`；存在则更新 cell 为 `false`，触发结构信号，并尝试 tombstone         |
| `clear()`       | 无            | `void`                  | 写                                         | 空集合直接跳过；否则对当前每个成员调用一次 `delete()`（走同一个 `batch()`）            |
| `replace(next)` | `Iterable<T>` | `void`                  | 写                                         | 完整物化后原子替换；失败保持旧 Set；整次替换最多触发一次结构通知，成员集合相同则不通知 |
| `valuesArray()` | 无            | 冻结的成员数组          | 追踪读（依赖结构信号）                     | 无                                                                                     |
| `snapshot()`    | 无            | 新建的原生 `Set` 副本   | 追踪读（依赖结构信号）                     | 无                                                                                     |
| `prune()`       | 无            | 本次回收的 cell 数      | —                                          | 对每个已不在当前成员集合里的 cell 尝试 tombstone                                       |
| `dispose()`     | 无            | `void`                  | —                                          | 释放全部拥有的 Signal                                                                  |

`ObservableSet` 没有单独的修订/迭代信号——它只有一个结构信号，因为"成员是谁"和"内容是否变化"对 Set 而言是同一件事。`ObservableSet` 也没有 `peek()`：它没有"按 key 查值"的读取形态。

### 工厂函数参考

```ts
function observableObject<T extends Record<string, unknown>>(
  initial: T,
  options?: IObservableCollectionOptions,
  runtime?: IRuntime
): ObservableObject<T>;

function observableArray<T>(
  initial?: Iterable<T>,
  options?: IObservableCollectionOptions,
  runtime?: IRuntime
): ObservableArray<T>;

function observableMap<K, V>(
  initial?: ReadonlyMap<K, V> | Iterable<readonly [K, V]>,
  options?: IObservableCollectionOptions,
  runtime?: IRuntime
): ObservableMap<K, V>;

function observableSet<T>(
  initial?: Iterable<T>,
  options?: IObservableCollectionOptions,
  runtime?: IRuntime
): ObservableSet<T>;
```

**参数顺序是 `(initial, options, runtime)`**，而对应的类构造函数是 `(initial, runtime, options)`——两者故意不一致，混着用最容易踩坑：

```ts
// 错误示范：把 runtime 当成第二个参数传给工厂函数
observableArray([1, 2, 3], myRuntime); // myRuntime 被当成了 options！

// 正确写法
observableArray([1, 2, 3], {}, myRuntime);
// 或者直接用类构造函数，参数顺序是 (initial, runtime, options)
new ObservableArray([1, 2, 3], myRuntime);
```

`options`/`runtime` 结构不同（一个是 `{ mutationGuard?, debugName? }`，一个是 Runtime 实例），TypeScript 通常会在传入具体值时报类型错误；但如果两者都省略、或用 `undefined`/宽泛类型变量传递，编译期不一定能拦住，务必按签名顺序传参。

---

<a id="操作常量模块"></a>

## 操作常量模块

```ts
import { IndexedOperation, type IIndexedOperation } from '@migaia/store-indexed';
```

```ts
const IndexedOperation = {
  read: 'read',
  write: 'write',
  delete: 'delete'
} as const;
type IIndexedOperation = (typeof IndexedOperation)[keyof typeof IndexedOperation];
```

一个稳定的操作名词表，供诊断/日志/中间件按"这次是读、写还是删"分类使用。本包自身的方法实现不引用这个常量——集合内部用的是各方法名字符串（如 `` `${debugName}.set(key)` `` 传给 `mutationGuard`），`IndexedOperation` 是暴露给消费方（例如构建在 `store-indexed` 之上的调试面板、中间件）统一分类操作类型的公共词表，无调用参数、无边界行为需要注意。

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

```ts
const StoreIndexedErrorCode = {
  invalidOption: 'INVALID_OPTION',
  collectionDisposed: 'COLLECTION_DISPOSED',
  indexOutOfRange: 'INDEX_OUT_OF_RANGE',
  invalidIndex: 'INVALID_INDEX',
  crossRuntime: 'CROSS_RUNTIME'
} as const;
type IStoreIndexedErrorCode = (typeof StoreIndexedErrorCode)[keyof typeof StoreIndexedErrorCode];

const STORE_INDEXED_SOURCE: '@migaia/store-indexed';
```

码值是公开 API 的一部分，改名等同破坏性变更。`STORE_INDEXED_SOURCE` 是每个本包边界错误 `source` 字段的固定值。

```ts
function createStoreIndexedError(
  code: IStoreIndexedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error;

function createStoreIndexedRangeError(code: IStoreIndexedErrorCode, message: string): RangeError;

function createStoreIndexedTypeError(
  code: IStoreIndexedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError;
```

三个工厂函数分别构造原生 `Error`/`RangeError`/`TypeError` 实例（保留 `instanceof` 身份，不做子类化），并在其上附加不可写的 `source: '@migaia/store-indexed'` 与 `code` 字段。`createStoreIndexedRangeError` 不接受 `cause` 选项（第三参数）；`createStoreIndexedError`/`createStoreIndexedTypeError` 若提供 `options.cause`，会转发给原生构造函数的 `{ cause }` 选项，因而反映在错误的 `.cause` 与 `.stack` 里。本包内部用它们构造全部抛出的错误；调用方也可以在扩展本包行为时（例如自定义 `mutationGuard` 的 `assertMutationAllowed` 实现）复用同一套 `(source, code)` 身份约定，让上层错误处理代码可以用统一的方式识别"这是一个 store-indexed 语义错误"。

### 错误信息全表

每个包边界错误保留原生 `Error`、`TypeError` 或 `RangeError`，并带 `source: '@migaia/store-indexed'` 与稳定 `code`。调用方应按 `code` 判断语义，不应依赖消息文本。

| 错误信息                                                                                      | 抛出位置                                                                                                           | 触发条件                                                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `[store] observable collection options must be an object`                                     | 全部构造函数                                                                                                       | `options` 不是对象（`null` 或非 `object` 类型）                                                              |
| `[store] observable collection debugName must be a string`                                    | 全部构造函数                                                                                                       | `options.debugName` 非 `undefined` 且不是字符串                                                              |
| `[store] observable collection input must be a non-null object or iterable`                   | 全部构造函数、`ObservableObject.replace`/`ObservableMap.replace`/`ObservableArray.replace`/`ObservableSet.replace` | 初始值/替换值不是非空对象、或不是合法可迭代对象（`Symbol.iterator` 缺失/调用失败/迭代失败）                  |
| `[store] ObservableObject key must be a string`                                               | `ObservableObject` 的 `get`/`peek`/`has`/`set`/`update`/`delete`                                                   | key 不是字符串                                                                                               |
| `[store] cross-runtime dependency is not allowed: collection read belongs to another Runtime` | 任意追踪型读方法                                                                                                   | 当前处于**另一个** Runtime 的追踪状态中，却读了本集合（本集合绑定的是不同的 Runtime）                        |
| `[store] {debugName} is disposed`                                                             | 任意方法内部的 `assertActive()`                                                                                    | 集合已 `dispose()` 之后，仍调用了它的读或写方法（`debugName` 是构造时的 `options.debugName` 或类名默认值）   |
| `[store] ObservableArray index out of range`                                                  | `ObservableArray.set(index, value)`                                                                                | `index` 不在 `[0, length)` 范围内                                                                            |
| `[store] ObservableArray index must be an integer`                                            | `ObservableArray.at(index)` / `set(index, value)`                                                                  | `index` 不是整数（`Number.isInteger` 判定为 `false`）                                                        |
| 由 `mutationGuard.assertMutationAllowed(operation)` 抛出的任意错误                            | 全部写方法（`set`/`push`/`delete`/`add`/`clear`/`replace`……）内部的 `assertMutation()`                             | 由传入的 `IMutationGuard` 实现自行决定何时抛、抛什么——本包不规定具体错误信息，只保证在写操作真正生效前调用它 |

对照码值：`invalidOption` 对应前四行与 `ObservableObject.update` 的 `updater` 非函数校验；`collectionDisposed` 对应 disposed 检查；`indexOutOfRange`/`invalidIndex` 对应数组下标两行；`crossRuntime` 对应跨 Runtime 保护。

---

<a id="生命周期与资源释放"></a>

## 生命周期与资源释放

### 构造 → 使用 → 释放

一个集合从构造开始就绑定到指定（或默认）的 Runtime；使用期间每次追踪读都可能新建 cell（Signal），这些 cell 全部登记进集合自己的所有权集合；`dispose()` 时逐一调用它们的 `.dispose()` 断开下游依赖边，再清空登记表。**重复调用 `dispose()` 是安全的空操作**（内部有 `#disposed` 标志短路）。

集合本身不会自动 dispose——它不感知自己何时"不再被使用"，调用方必须在生命周期结束时（组件卸载、请求处理完毕、测试用例结束）显式调用。

### 为什么需要 `prune()`

cell 的自动回收是"事件驱动"的：一个 cell 的最后一个订阅者取消订阅时立即触发回收；一个从未被订阅过的 cell 在创建后的当前微任务尾部被回收。但存在一种中间状态：一个 key 被 `delete()` 时，如果它的 cell **当时仍有订阅者**，这个 cell 不会被摘除（要保证订阅者能看到它变成"缺失"），而是留在原地，直到订阅者自己解除订阅才会经由 `onUnobserved` 钩子回收。

多数场景下这个自动路径已经够用。但高频增删的场景（比如一个数组频繁 `splice`），如果想在某个明确的时间点（例如一轮渲染结束后）主动确保"已经不在集合里、也没有订阅者"的 cell 被清空，而不是继续依赖不确定何时触发的 `onUnobserved`，就调用 `prune()`。它返回本次实际回收的 cell 数，可用于监控/调试内存占用。

`ObservableArray.prune()` 是个特例：它对**全部**已物化 cell 无条件尝试回收，而不只是"索引越界"的那些——`splice`/`pop` 之后，一个 cell 挂着的索引位置和它最初对应的语义实体之间的关系已经不再可靠，继续保留一个恰好落在新长度以内、但语义已经对不上的 cell 没有意义。

---

<a id="与-mutationguard-集成"></a>

## 与 `mutationGuard` 集成

`IObservableCollectionOptions.mutationGuard` 接受任何实现 `@migaia/store-light` 的 `IMutationGuard` 接口（`{ assertMutationAllowed(operation?: string): void }`）的对象。例如接入 `@migaia/store-middleware` 提供的 `MutationPolicy`，实现"只能在 action 内变更集合"的策略：

```ts
import { MutationPolicy } from '@migaia/store-middleware';
import { ObservableMap } from '@migaia/store-indexed';

const guard = new MutationPolicy('actions-only');
const users = new ObservableMap<string, { name: string }>(
  [],
  undefined, // 使用默认 Runtime
  { mutationGuard: guard, debugName: 'users' }
);

users.set('u1', { name: 'Ann' }); // 抛错：不在 action 内
guard.runInAction(() => users.set('u1', { name: 'Ann' })); // 成功
```

具体如何进入"action 作用域"（`MutationPolicy.runInAction` 的计数如何递增）属于 `@migaia/store-middleware` 自己的机制，参见该包文档；`store-indexed` 这边只负责在每次写操作前调用一次 `assertMutationAllowed(operation)`，`operation` 参数形如 `` `${debugName}.set(key)` ``，便于错误信息定位到具体是哪个集合的哪次调用。

---

<a id="多-runtime-场景"></a>

## 多 Runtime 场景

默认情况下所有集合共用 `@migaia/reactive` 的 `defaultRuntime`。需要隔离依赖图的场景（比如测试之间互不干扰、SSR 请求级别隔离）可以显式传入独立的 Runtime：

```ts
import { createRuntime } from '@migaia/reactive';
import { ObservableArray } from '@migaia/store-indexed';

const runtime = createRuntime();
const rows = new ObservableArray([1, 2, 3], runtime);
```

**同一个集合实例只能属于它构造时绑定的那一个 Runtime**。如果在另一个 Runtime 的 effect/computed 求值过程中读了这个集合，会抛出跨 Runtime 错误（见[错误模块](#错误模块)）——这不是可配置行为，是刻意的保护，防止两张本应独立的依赖图被意外接在一起。

---

<a id="组合工作流示例"></a>

## 组合工作流示例：细粒度订阅 + `prune()` + `mutationGuard`

```ts
import { Effect } from '@migaia/reactive';
import { ObservableArray } from '@migaia/store-indexed';
import { MutationPolicy } from '@migaia/store-middleware';

const guard = new MutationPolicy('actions-only');
const rows = new ObservableArray<{ id: string }>(
  [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  undefined,
  { mutationGuard: guard, debugName: 'rows' }
);

// 只订阅索引 0：改其余索引不会让这个 effect 重算
const effect = new Effect(() => console.log('row0', rows.at(0)), rows.runtime);

guard.runInAction(() => {
  rows.splice(0, 1); // 删除首行，触发结构信号与修订信号
});
rows.prune(); // 主动回收 splice 后失去语义意义的僵尸 cell

effect.dispose();
rows.dispose();
```

`mutationGuard` 把"只能在 `runInAction` 内写"这条策略下沉到集合层，写方法在真正生效前统一调用一次 `assertMutationAllowed`；`prune()` 在高频结构变更（如 `splice`）后主动回收"索引身份已经对不上"的僵尸 cell，避免依赖不确定何时触发的 `onUnobserved`。

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

**Q：`new ObservableArray(x, y)` 和 `observableArray(x, y)` 里的 `y` 含义一样吗？**
不一样。类构造函数第二个参数是 `runtime`，工厂函数第二个参数是 `options`。混用会把值传错位置，参见[工厂函数参考](#集合类型与工厂函数模块)。

**Q：我 `delete()` 了一个 key，但内存分析工具里还能看到对应的 Signal。**
如果那个 key 当时还有活跃订阅者，这是预期行为——cell 会留到订阅者自己退订才回收，保证订阅者能读到"缺失"这个变化。批量清理后可以调用 `prune()` 主动回收剩余的僵尸 cell。

**Q：为什么改了数组第 3 项，只读第 3 项的 effect 没重算？**
检查是不是在追踪范围外（不在 effect/computed 内）调用的 `at(3)`，或者用的是 `peek()`——两者都不建立依赖。另外确认改值前后是否真的不同：`set()` 内部用 `Object.is` 比较，值没变不会触发任何信号。

**Q：`keys()` 为什么在某个 key 的值变化后没有重新触发，而 `snapshot()` 触发了？**
`keys()`（以及 `ObservableMap.size`）只依赖结构信号，只关心 key 集合本身是否变化；`snapshot()` 依赖修订/迭代信号，任意值变化都会触发。这是刻意的追踪粒度拆分，见[设计动机与核心机制](#设计动机与核心机制)。

**Q：跨 Runtime 的错误具体是什么时候抛的？**
只在**追踪型读**发生时检查（当前处于某个 Runtime 的追踪状态，且不是本集合绑定的那个）。非追踪读（`peek()`，或压根不在任何 effect 内的普通调用）不受影响，随时可以跨 Runtime 调用。

**Q：`mutationGuard` 抛出的错误会不会被本包吞掉？**
不会。`assertMutation()` 直接调用 `mutationGuard.assertMutationAllowed(operation)`，抛出的错误原样从 `set`/`push`/`delete` 等调用里冒出来，调用方按普通异常处理即可。

**Q：`IndexedOperation` 要在哪里用？**
它不是本包内部使用的枚举，而是给消费方（诊断面板、中间件）统一分类"这是读/写/删"操作用的公共词表；本包自己的写操作传给 `mutationGuard` 的 `operation` 是形如 `` `${debugName}.set(key)` `` 的字符串，不是 `IndexedOperation` 的取值。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test && pnpm run build
```

浏览器集成路径另跑：

```bash
pnpm run typecheck:e2e && pnpm run test:e2e
```
