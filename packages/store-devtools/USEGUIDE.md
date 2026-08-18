# 使用手册

本文是 `@migaia/store-devtools` 的完整参考手册。先看 [README.md](./README.md#5-最小示例) 的最小示例，跑起来之后再回来查这里的细节——README 讲"是什么、适合什么场景、5 分钟怎么跑起来"，本文讲"每一个配置项、每一个返回值字段、每一种边界行为"。

## 目录

1. [导入与依赖](#1-导入与依赖)
2. [createStoreDevTools 完整参考](#2-createstoredevtools-完整参考)
3. [History：状态历史与时间旅行](#3-history状态历史与时间旅行)
4. [Actions：action 追踪](#4-actionsaction-追踪)
5. [Trace：runtime 原始事件流](#5-tracerruntime-原始事件流)
6. [依赖树：getDependencyTree 与 getObserverTree](#6-依赖树getdependencytree-与-getobservertree)
7. [克隆策略与快照失败处理](#7-克隆策略与快照失败处理)
8. [dispose 与生命周期](#8-dispose-与生命周期)
9. [使用限制](#9-使用限制)
10. [常见问题排查](#10-常见问题排查)

---

## 1. 导入与依赖

```ts
import {
  createStoreDevTools,
  getDependencyTree,
  getObserverTree,
  type IStoreDevTools,
  type IStoreDevToolsOptions,
  type IStoreHistoryEntry,
  type IActionTrace,
  type IDependencyTreeNode
} from '@migaia/store-devtools';
```

本包依赖 `@migaia/reactive`（`IObservable`/`IObserver`/`IRuntimeTraceEvent` 类型）、`@migaia/store-light`（`IReactiveStore`）、`@migaia/store-middleware`（默认克隆策略 `ClonePolicy`）。这三个都是 `dependencies`，安装本包会一并拉取，不需要单独声明。

`createStoreDevTools` 需要一个已经创建好的 `IReactiveStore` 实例（`@migaia/store-light` 的 `createStore()` 返回值），本身不负责创建 Store。

---

## 2. createStoreDevTools 完整参考

```ts
function createStoreDevTools<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options?: IStoreDevToolsOptions
): IStoreDevTools;
```

### 参数

| 参数 | 类型 | 必填性 | 默认值 | 作用 |
| --- | --- | --- | --- | --- |
| `store` | `IReactiveStore<S>` | 必填 | 无 | 要接诊断记录的 Store 实例 |
| `options.maxHistory` | `number` | 可选 | `100` | `history` 与 `actions` 两个队列都用它做上限（见 [§3](#3-history状态历史与时间旅行)、[§4](#4-actionsaction-追踪)）；传入非正数会被强制提升到 `1` |
| `options.maxTrace` | `number` | 可选 | `1000` | `trace` 队列的上限；传入非正数会被强制提升到 `1` |
| `options.captureRuntimeTrace` | `boolean` | 可选 | `true` | 传 `false` 时完全不订阅 runtime trace，`trace` 永远为空数组，`actions` 也不会被自动填充（只能靠手动 `recordAction()`） |
| `options.now` | `() => number` | 可选 | `Date.now` | 时间戳来源；测试环境常替换成可控的假时钟 |
| `options.clone` | `(state) => state` | 可选 | `ClonePolicy.diagnostic`（来自 `@migaia/store-middleware/tolerant-clone`） | 快照克隆函数，见 [§7](#7-克隆策略与快照失败处理) |

### 返回值 `IStoreDevTools`

| 字段/方法 | 类型 | 同步/异步 | 说明 |
| --- | --- | --- | --- |
| `history` | `readonly IStoreHistoryEntry[]` | 同步 | 只读历史队列，见 [§3](#3-history状态历史与时间旅行) |
| `actions` | `readonly IActionTrace[]` | 同步 | 只读 action 记录，见 [§4](#4-actionsaction-追踪) |
| `trace` | `readonly IRuntimeTraceEvent[]` | 同步 | 只读 runtime 原始事件，见 [§5](#5-tracerruntime-原始事件流) |
| `record(label?)` | `(label?: string) => IStoreHistoryEntry` | 同步 | 手动拍一份当前快照并追加进 `history`，`label` 默认 `'state change'` |
| `recordAction(trace)` | `(trace: Omit<IActionTrace, 'timestamp'>) => void` | 同步 | 手动追加一条 action 记录，`timestamp` 由内部的 `now()` 补上 |
| `jumpTo(id)` | `(id: number) => void` | 同步 | 用某条历史快照调用 `store.$hydrate()`，见 [§3](#3-history状态历史与时间旅行) |
| `clear()` | `() => void` | 同步 | 清空 `history`/`actions`/`trace`，随后立刻记一条新的 `'initial'` 历史 |
| `dispose()` | `() => void` | 同步 | 取消对 Store 的订阅与 trace 监听，见 [§8](#8-dispose-与生命周期) |

调用时机：`createStoreDevTools()` 内部会立即记一条 `label: 'initial'` 的历史（对应当前调用瞬间的 `store.$plain()`），因此 `tools.history` 从创建那一刻起就不是空数组。

---

## 3. History：状态历史与时间旅行

`store.$subscribe()` 是 Store 自身的粗粒度订阅——只要任意一个可变字段发生变化，收到一次通知就触发一次 `record()`。因此 `history` 里除了创建时那条 `'initial'`，之后每条的默认 `label` 都是 `'state change'`；想要更有辨识度的标签，可以在业务代码的关键节点主动调用 `tools.record('before-submit')`。

每条 `IStoreHistoryEntry` 的结构：

```ts
type IStoreHistoryEntry = {
  id: number; // 从 1 开始自增，dispose 后不重置
  timestamp: number; // options.now() 的返回值
  label: string;
  state: Record<string, unknown>; // store.$plain() 的克隆结果
};
```

`state` 来自 `store.$plain()`——**只包含 signal 支撑的标量字段**，computed（派生值）、方法、WASM 字段都不在其中（这是 `$plain()` 自身的行为，devtools 只是转发）。

`history` 长度超过 `maxHistory` 时，`record()` 会从数组头部裁掉多余的最旧条目，只保留最近 `maxHistory` 条——这意味着长时间运行后，早期的历史（包括最初那条 `'initial'`）可能已经被裁掉，`jumpTo()` 传入一个已经被裁掉的 `id` 会抛错。

### `jumpTo(id)`

```ts
jumpTo(id: number): void
```

在 `history` 中查找 `id` 匹配的条目，找到后：

1. 把内部的"回放深度"计数器加一（用于下一步屏蔽自触发的重复记录）；
2. 调用 `store.$hydrate(clone(entry.state))` 把状态写回该快照（`clone` 就是构造时传入或默认的克隆函数，防止历史条目本身被 `$hydrate` 过程中的引用共享污染）；
3. `finally` 里把计数器减一。

找不到对应 `id` 时抛出 `RangeError('[store] unknown history entry: <id>')`。

`$hydrate()` 是"宽松写回"：只写已知的 signal 字段，未知/派生/WASM 键会被静默跳过（`@migaia/store-light` 的默认行为）,所以 `jumpTo()` **不会**恢复 computed 值本身（它们会随依赖的 signal 变化自动重新计算）,也不会恢复 WASM 字段或外部资源的状态。

`$hydrate()` 触发的 Store 通知会重新走一遍 `$subscribe` 的监听器，但因为回放深度计数器 > 0，这次通知**不会**被当成一次新的用户操作再记一条历史——否则每次 `jumpTo()` 都会在历史末尾追加一条"跳转产生的历史"，污染时间线。用计数器而不是布尔值是因为：如果某个 `$subscribe` 监听器在回放期间又触发了另一次 `jumpTo()`（嵌套回放），内层结束时不能提前解除外层的回放屏蔽，否则外层剩余的通知会被误记。

### `record(label?)`

手动补一条快照，常用于"在某个人工节点（提交前、路由切换前）留一个可回退的锚点"，不依赖 Store 通知触发。返回新创建的条目本身。

### `clear()`

清空 `history`、`actions`、`trace` 三个队列（长度归零），随后立即调用一次 `record('initial')`，所以清空后 `history` 不是空数组，而是重新只有一条 `'initial'`（`id` 不会归零，继续从上一次的 `nextId` 累加）。

---

## 4. Actions：action 追踪

`@migaia/store-light` 的 Store 会把定义时写的每个方法自动包装成一次具名 action（名字是 `<debugName>.<方法名>`),内部通过 `store.$runtime.runTracedAction(actionName, fn)` 执行,这会广播 `type: 'action'` 的 `phase: 'start' | 'end' | 'error'` runtime trace 事件。`createStoreDevTools` 订阅这条 trace 流，收到 `phase !== 'start'`（即 `'end'` 或 `'error'`）的 action 事件时，自动调用 `recordAction()` 生成一条 `IActionTrace`：

```ts
type IActionTrace = {
  timestamp: number;
  name: string; // 例如 'myStore.increment'
  payload?: unknown; // 自动生成的记录不带 payload，需手动 recordAction() 才有
  durationMs?: number;
  error?: unknown; // 仅 phase === 'error' 时有值
};
```

**只有 Store 自己方法产生的 action 会被自动记录**：`store.$batch()`、`store.$set()`、`store.$hydrate()` 内部走的是 `runMutation()`，不经过 `runTracedAction()`，因此不会自动出现在 `actions` 里；如果业务上关心这类调用，需要自行 `tools.recordAction({ name: 'manual-batch', ... })`。

`actions` 数组超过 `maxHistory` 时同样从头部裁掉最旧条目——**它复用的是 `maxHistory` 这个上限,不是 `maxTrace`**,没有独立的 `maxActions` 选项，这一点容易被误解，配置时需要注意。

把 `options.captureRuntimeTrace` 设为 `false` 会连带关闭 action 的自动记录（因为两者共享同一条 trace 订阅），此时 `actions` 只能靠手动调用 `recordAction()` 填充。

---

## 5. Trace：runtime 原始事件流

`trace` 原样保存 `@migaia/reactive` runtime 广播的 `IRuntimeTraceEvent`，四种类型：

| `type` | 触发时机 | 关键字段 |
| --- | --- | --- |
| `observable-change` | 一个 observable 的值被设置或被显式通知 | `observable`（节点描述符）、`reason: 'set' \| 'notify'` |
| `dependency` | 依赖边建立/断开 | `observable`、`observer`、`phase: 'connect' \| 'disconnect'`、`reason?: 'retrack' \| 'invalidate' \| 'dispose'` |
| `observer-run` | 一个 Computed/Effect 开始、结束或出错 | `observer`、`phase: 'start' \| 'end' \| 'error'`、`durationMs?`、`error?` |
| `action` | action 起止（详见 [§4](#4-actionsaction-追踪)） | `name`、`phase`、`durationMs?`、`error?` |

这四种事件都携带只读的节点描述符（`id`/`kind`/`debugName?`），不是可变的图节点本身,因此在事件中长期持有引用不会阻止相应的 Signal/Computed/Effect 被回收。

`trace` 超过 `maxTrace` 时从头部裁掉最旧条目。把 `captureRuntimeTrace` 设为 `false` 可以完全跳过这条订阅——排查一个高频写入的 Store 时，只关心历史快照、不关心底层依赖图变化，关掉它能显著降低开销。

---

## 6. 依赖树：getDependencyTree 与 getObserverTree

这两个函数**不依赖 `createStoreDevTools`**，可以独立使用，只需要拿到一个 `IObservable`（Signal/Computed）或 `IObserver`（Computed/Effect）实例：

```ts
function getDependencyTree(observer: IObserver, maxDepth?: number): IDependencyTreeNode;
function getObserverTree(observable: IObservable, maxDepth?: number): IDependencyTreeNode;
```

`IObserver`/`IObservable` 来自 `@migaia/reactive/runtime/types`——这是内核内部的图协议子路径，刻意不从 `@migaia/reactive` 主入口导出，因为第三方通常应该组合公开的 `Signal`/`Computed`/`Effect`，而不是直接操作图节点；本包需要读取节点内部的 `deps`/`subs`/`version` 才能画依赖图，所以走这条子路径导入。

### 返回结构

```ts
type IDependencyTreeNode = {
  kind: 'observable' | 'observer';
  label: string; // node.debugName ?? node.constructor?.name ?? 'AnonymousReactiveNode'
  version?: number; // 仅 observable 节点有；对应该节点当前的版本号
  children: IDependencyTreeNode[];
  circular?: boolean; // 该节点在当前路径上被重复访问，见下方"循环判定"
};
```

- `getDependencyTree(observer, maxDepth = 20)`：从一个 observer（典型是 Effect 或 Computed）出发，向上展开它依赖的每个 observable，再递归展开这些 observable 自己的依赖（如果一个 observable 同时也是 observer，比如 Computed）。根节点 `kind: 'observer'` 本身没有 `version` 字段。
- `getObserverTree(observable, maxDepth = 20)`：方向相反，从一个 observable（典型是 Signal）出发，向下展开订阅它的每个 observer，再递归展开这些 observer 自己的订阅者。根节点 `kind: 'observable'`。

### `maxDepth`

限制展开层数，默认 `20`。`maxDepth = 0` 时连根节点的直接边都不展开（`children` 是空数组），避免大图拖垮调试面板渲染。

### 循环判定

依赖图里"菱形共享"（同一个节点被两条不同路径各引用一次）很常见，那不算循环。判定用的是**当前这一条递归路径**，不是全局访问集合：进入一个节点前把它加入 `path` 集合，展开完子节点后（`finally` 里）再移出；只有在展开过程中重新踩到"仍然在当前路径栈上"的节点，才会把该节点标记 `circular: true` 并停止继续展开它的子节点——真正的自环/环形依赖会被正确截断,不会无限递归,菱形共享的两条分支各自都能正常展开到底。

---

## 7. 克隆策略与快照失败处理

`options.clone` 默认是 `@migaia/store-middleware` 的 `ClonePolicy.diagnostic`：优先用 `structuredClone`，遇到不可克隆的值（函数、DOM 句柄、Class 实例等）时不会抛错，而是递归遍历普通对象/数组，只在真正不可克隆的那个值上退化为引用共享，其余可克隆的部分仍然是独立拷贝。这是三种 `ClonePolicy` 里专为诊断/中间件场景设计的一种——诊断工具在遇到不常见的值时"能用但不完全隔离"比"直接崩溃"更符合它的定位。

如果状态里包含敏感字段（token、密码等），默认克隆策略不会做任何脱敏——要么不要让这些字段出现在 `store.$plain()` 里（即不要用 signal 承载它们），要么自己传一个会脱敏的 `clone` 函数替换默认值。

`record()`/`recordAction()` 本身如果抛错（比如自定义 `clone` 函数本身抛错），会在 `$subscribe` 的监听器里被捕获，通过 `store.$runtime.reportError(error, { phase: 'trace-listener' })` 上报，而不会让触发这次状态变化的业务代码跟着抛错——诊断工具的故障不应该反过来打断正常的业务写入。

---

## 8. dispose 与生命周期

包边界错误保留 `Error`/`RangeError` 类型，并带 `source: '@migaia/store-devtools'` 与稳定
`code`：已释放会话为 `SESSION_DISPOSED`、被裁剪或不存在的 history id 为
`UNKNOWN_HISTORY_ENTRY`、清理多项失败为 `CLEANUP_FAILED`（`AggregateError.errors` 保留原因）。

```ts
dispose(): void
```

取消 `store.$subscribe()` 的订阅、取消 runtime trace 的监听（如果启用了的话）,并把内部标记为已释放。`dispose()` 本身可以安全地重复调用（第二次调用直接返回，是幂等的）。

释放之后，`record`、`recordAction`、`jumpTo`、`clear` 都会先做一次存活检查，抛出 `Error('[store] DevTools session is disposed')`；但只读属性 `history`/`actions`/`trace` 在释放后仍然可以正常读取，只是不会再增长。

**必须在不再需要诊断时调用 `dispose()`**：不调用的话，`$subscribe()` 建立的 Effect 和 trace 监听器会一直挂在 Store 和 Runtime 上，既造成内存泄漏，也会让每次状态变化都多付出一次快照克隆的开销。典型用法是只在开发构建下创建、组件卸载或调试会话结束时释放。

---

## 9. 使用限制

- **不是生产状态权威**：`history` 只在内存里，进程重启即丢失；不提供持久化、不提供跨端同步。
- **不是事务回滚**：`jumpTo()` 只是把标量字段写回某个历史值，不会撤销已经发出的网络请求、写入的日志、修改过的 DOM，或者已经发送出去的消息——这些副作用一旦发生就不可逆。
- **只覆盖 `$plain()` 范围**：computed、方法、WASM 字段、通过 `$own()` 挂载的外部资源都不在 `history`/`jumpTo()` 的覆盖范围内。
- **不是浏览器 DevTools 扩展**：如果需要接入 Redux DevTools 浏览器扩展协议，那是 `@migaia/store-middleware` 的 `connectDevTools()`，与本包是两套独立机制，不要混淆。
- **`actions` 上限复用 `maxHistory`**：见 [§4](#4-actionsaction-追踪)，配置时不要假设存在独立的 `maxActions`。

---

## 10. 常见问题排查

**Q：`jumpTo()` 之后某个 computed 字段的值好像不对。**
`jumpTo()` 只写回 signal 支撑的标量字段，computed 值会在依赖的 signal 变化后自动重新求值——如果观察到的值不符合预期，先确认该 computed 依赖的所有 signal 是否都在 `$plain()` 范围内（跨 Store、依赖外部可变状态的 computed 不在保证范围内）。

**Q：`tools.actions` 里没有出现某次调用。**
检查这次调用是不是直接用了 `store.$batch()`/`store.$set()`/`store.$hydrate()`，而不是 Store 自己定义的方法——只有后者会被 runtime 自动包装成 action 并被追踪，前者需要手动 `recordAction()`。另外确认 `captureRuntimeTrace` 没有被设为 `false`。

**Q：`jumpTo(someId)` 抛 `RangeError: unknown history entry`。**
该 `id` 对应的历史条目可能已经因为超过 `maxHistory` 被裁掉；调大 `maxHistory`，或者在需要长期保留的节点主动调用 `record(label)` 并自行持有返回的 `id`。

**Q：想统计依赖图规模，但 `getDependencyTree` 返回的树被截断了。**
默认 `maxDepth` 是 `20`，超过这个深度的分支不会继续展开（不算作 `circular`，只是单纯停止）；需要更深的展开就显式传更大的 `maxDepth`，但要注意大图会拖慢调试面板渲染。

**Q：多次 `dispose()` 会不会报错。**
不会，`dispose()` 是幂等的，第二次及以后的调用直接返回。

## 构建、测试与排查

仓库根目录：`pnpm --filter @migaia/store-devtools fmt` → `lint` → `typecheck` → `typecheck:test` → `test` → `build`。排查快照/回放先检查 `maxHistory`、`captureRuntimeTrace` 与 `dispose()` 时机。
