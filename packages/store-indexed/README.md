# @migaia/store-indexed

**显式方法的细粒度响应式集合**——对象、数组、Map、Set 四种容器，每个 key/索引/成员各自独立追踪依赖，不做 Proxy 拦截。

## 1. 这是什么

如果把 `@migaia/reactive` 的 `Signal` 比作一个响应式的"格子"，`store-indexed` 就是把整箱格子按数字索引或对象 key 组织起来、按需现造格子的容器：`ObservableObject`（键值对）、`ObservableArray`（索引数组）、`ObservableMap`（K/V 表）、`ObservableSet`（成员集合）。它们长得像 JS 原生的 `Object`/`Array`/`Map`/`Set`，但读写一律走命名方法（`get`/`set`/`has`/`peek`……），不用 Proxy 包一层——这样才能把追踪粒度做到"只读了哪个 key，就只依赖哪个 key"：改数组第 5 项，只有读过第 5 项的 effect 会重算，其余 999 个索引的订阅者不受影响。

每个 key/索引对应的响应式"格子"（内部叫 cell）是**惰性造的**：没人读过就不存在，读过又没人订阅就在下一个微任务自动回收。这意味着一个十万条目的集合，哪怕你只追踪其中五条，也不会为剩下的十万条建立任何 Signal。

## 2. 适合/不适合场景

| 场景 | 适合吗 |
| --- | --- |
| 表格行、消息列表、大规模数组，只有少数行被 UI 订阅 | 适合——未订阅的索引不占用任何响应式资源 |
| 需要"改一个 key/索引，只有读过它的地方重算"的细粒度依赖 | 适合，这是本包的核心卖点 |
| 需要跟 `@migaia/store-light` 的写入策略（比如仅允许在 action 内变更）集成 | 适合，构造选项直接接受 `IMutationGuard` |
| 只需要一个普通的响应式对象/数组，不关心细粒度依赖或容量 | 不必要——一个 `Signal<T[]>` 可能更直接 |
| 需要按值稳定标识、删除/插入不改变其余成员定位的实体集合 | 不适合——这里数组是纯索引语义，插入/删除会移动后续索引对应的值 |

## 3. 核心卖点

- **细粒度依赖**：读一个 key/索引只订阅那个 key/索引本身；结构变化（增删 key、数组变长变短）和值变化分别用独立的 Signal 追踪，互不牵连。
- **惰性 cell + 自动回收**：cell 只在被追踪读时才创建，失去全部订阅者后自动释放（外加逃生舱 `prune()` 手动批量回收）。
- **`peek()` 不建 cell**：非追踪读走内部 Map 直接返回，遍历十万个 key 做快照不会意外创建十万个 Signal。
- **跨 Runtime 误用会立刻报错**：一个集合的读操作发生在别的 Runtime 正在追踪的 effect 里时，直接抛错而不是静默产生跨图依赖。
- **可选的变更守卫**：构造时传入 `IMutationGuard`（比如 `@migaia/store-middleware` 的 `MutationPolicy`），把"只能在 action 内写"这类策略下沉到集合层。
- **显式生命周期**：`dispose()` 级联释放集合自己创建的全部 Signal；用完必须调用，否则常驻内存。

## 4. 安装

```bash
pnpm add @migaia/store-indexed
```

依赖 `@migaia/reactive`（响应式运行时）与 `@migaia/store-light`（`IMutationGuard` 类型），二者通常已经在同一个 monorepo 里作为对等依赖存在。

## 5. 最小示例

```ts
import { ObservableArray } from '@migaia/store-indexed';

const rows = new ObservableArray([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

// 只读了索引 1，只订阅索引 1
rows.at(1);

rows.set(1, { id: 'b2' }); // 触发依赖索引 1 的订阅者
rows.push({ id: 'd' }); // 改变 length，触发依赖 length/结构 的订阅者

console.log(rows.snapshot()); // 只读快照，追踪整体变化
rows.dispose(); // 用完必须释放
```

也可以用工厂函数替代 `new`（注意参数顺序与类构造函数不同，见下方"踩坑清单"）：

```ts
import { observableArray } from '@migaia/store-indexed';

const rows = observableArray([{ id: 'a' }]);
```

## 6. 核心概念一览

| 概念 | 是什么 |
| --- | --- |
| **Cell** | 某个 key/索引对应的响应式 Signal，惰性创建，无人订阅时自动回收 |
| **结构信号（structure）** | 追踪"有哪些 key/索引存在"——增删 key、数组变长变短才会触发，改值不触发 |
| **修订信号（revision）** | 追踪"整体是否有任意值变化"，供 `snapshot()` 一类整体读取使用 |
| **迭代信号（iteration，仅 Map）** | 追踪"任意内容变化"（含同 key 换值），供 `valuesArray()`/`entries()`/`snapshot()` 使用；`keys()`/`size` 只依赖结构信号 |
| **`peek()`** | 非追踪读，绕过 cell 创建，直接读内部存储 |
| **`mutationGuard`** | 构造选项，写操作前调用其 `assertMutationAllowed(operation)`，不通过就抛错 |
| **`prune()`** | 手动批量回收"已从集合移除、但 cell 还挂在内存里"的僵尸 cell |
| **`debugName`** | 构造选项，作为集合内部各 Signal 的名字前缀，用于调试/诊断 |

## 7. 模块一览

| 导出 | 是什么 |
| --- | --- |
| `ObservableObject<T>` / `observableObject(initial, options?, runtime?)` | 键值对容器，`get`/`peek`/`has`/`set`/`update`/`delete`/`keys`/`snapshot`/`replace`/`prune` |
| `ObservableArray<T>` / `observableArray(initial?, options?, runtime?)` | 索引数组，`at`/`length`/`peek`/`snapshot`/`set`/`push`/`pop`/`splice`/`replace`/`clear`/`prune` |
| `ObservableMap<K, V>` / `observableMap(initial?, options?, runtime?)` | K/V 表，`get`/`peek`/`has`/`set`/`delete`/`clear`/`keys`/`valuesArray`/`entries`/`snapshot`/`prune` |
| `ObservableSet<T>` / `observableSet(initial?, options?, runtime?)` | 成员集合，`has`/`add`/`delete`/`clear`/`valuesArray`/`snapshot`/`prune` |
| `IObservableCollectionOptions` | 构造选项类型：`{ mutationGuard?, debugName? }` |

四个类共享同一套生命周期基类，但**互不依赖对方**——用哪个就只为哪个的形状付费。

## 8. 踩坑清单（最容易踩的坑）

1. **工厂函数与类构造函数的参数顺序不一样**。`new ObservableArray(initial, runtime, options)`，但 `observableArray(initial, options, runtime)`——混用会把 `options` 传成 `runtime` 或反过来，且没有运行时报错提醒（类型层面 `IRuntime` 和 `IObservableCollectionOptions` 结构不同，通常会被 TS 拦住，但传 `undefined`/字面量时要格外小心）。
2. **不用之后必须调用 `dispose()`**。集合创建的每个 Signal 都要显式释放，忘记 dispose 会让它们常驻在 Runtime 的依赖图和内存里。
3. **`peek()`/`snapshot()` 语义不同**：`peek()` 是非追踪读，不建响应式依赖；`snapshot()`（或 `get`/`at`/`has` 等常规方法）是追踪读，且惰性创建 cell。批量遍历要用 `peek()`/`snapshot()`，不要在循环里对每个 key 调用会建 cell 的方法。
4. **一个集合实例绑定一个 Runtime**，跨 Runtime 读取会直接抛错，不会静默产生错误的跨图依赖。
5. **`ObservableArray` 是纯索引语义**，`splice`/`pop`/`replace` 会移动后续索引对应的值；需要"删除/插入不影响其余成员定位"的场景，这不是本包的设计目标。
6. **`mutationGuard` 只在写方法里触发**，`assertMutationAllowed` 抛出的错误会原样从 `set`/`push`/`delete` 等调用里抛出，需要自行 catch 或保证调用时机合法。

## 9. 深入参考

每个类的完整方法签名、参数/返回值/副作用表、cell 惰性创建与回收的精确时序、错误信息全表、`mutationGuard` 集成示例、多 Runtime 场景，见 **[USEGUIDE.md](./USEGUIDE.md)**。
