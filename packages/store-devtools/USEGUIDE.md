# `@migaia/store-devtools` 使用指南

本指南逐个主题列出全部导出 API 的签名、语义与用法示例。包的定位与安装方式见 [README](./README.md)。

## 目录

- [诊断会话模块](#诊断会话模块)
- [依赖树模块](#依赖树模块)
- [命令常量模块](#命令常量模块)
- [错误模块](#错误模块)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

---

<a id="诊断会话模块"></a>

## 诊断会话模块

```ts
import {
  createStoreDevTools,
  type IStoreDevTools,
  type IStoreDevToolsOptions,
  type IStoreHistoryEntry,
  type IActionTrace
} from '@migaia/store-devtools';
```

本包不负责创建 Store：`store` 参数必须是 `@migaia/store-light` 的 `createStore()` 返回的 `IReactiveStore<S>` 实例。内部只使用该实例已有的公开面：`store.$subscribe()`、`store.$runtime.subscribeTrace()`、`store.$runtime.reportError()`、`store.$plain()`、`store.$hydrate()`——不改写、不代理 Store 的任何写入路径。

```ts
type IStoreDevToolsOptions = {
  readonly maxHistory?: number;
  readonly maxTrace?: number;
  readonly captureRuntimeTrace?: boolean;
  readonly now?: () => number;
  readonly clone?: (state: Record<string, unknown>) => Record<string, unknown>;
};

type IStoreHistoryEntry = {
  readonly id: number;
  readonly timestamp: number;
  readonly label: string;
  readonly state: Record<string, unknown>;
};

type IActionTrace = {
  readonly timestamp: number;
  readonly name: string;
  readonly payload?: unknown;
  readonly durationMs?: number;
  readonly error?: unknown;
};

type IStoreDevTools = {
  readonly history: readonly IStoreHistoryEntry[];
  readonly actions: readonly IActionTrace[];
  readonly trace: readonly IRuntimeTraceEvent[]; // 来自 @migaia/reactive/runtime
  record(label?: string): IStoreHistoryEntry;
  recordAction(trace: Omit<IActionTrace, 'timestamp'>): void;
  jumpTo(id: number): void;
  clear(): void;
  dispose(): void;
};

function createStoreDevTools<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options?: IStoreDevToolsOptions
): IStoreDevTools;
```

### 构造期校验（同步抛出）

调用 `createStoreDevTools` 时按以下顺序做同步校验，全部失败都会在函数返回前抛出：

1. `options` 不是 `null` 且必须是 `object`——否则抛 `Error('[store] DevTools options must be an object')`，`code: 'INVALID_OPTION'`。
2. 读取 `options` 的属性描述符（`Object.getOwnPropertyDescriptors`）失败（例如某个 getter 抛错）时，抛 `Error`，`code: 'INVALID_OPTION'`，`cause` 是原始错误。
3. `maxHistory`/`maxTrace` 经 `??` 落到各自默认值（`100`/`1000`）后，必须是 `>= 1` 的安全整数（`Number.isSafeInteger`），否则抛 `Error('[store] DevTools ${name} must be a positive safe integer')`，`code: 'INVALID_OPTION'`。**非正数或非整数不会被静默夹到 1，而是直接抛错构造失败。**
4. `now`（若提供）必须是函数，否则抛 `Error('[store] DevTools now must be a function')`，`code: 'INVALID_OPTION'`。
5. `clone`（若提供）必须是函数，否则同上（`code: 'INVALID_OPTION'`，消息里的字段名换成 `clone`）。

全部通过后：

- `now` 默认 `Date.now`；`clone` 默认 `ClonePolicy.diagnostic`（来自 `@migaia/store-middleware/tolerant-clone`，见[克隆策略](#克隆策略)）。
- 立即调用一次内部的 `record()`，产生 `label: 'initial'` 的第一条历史条目——因此 `tools.history` 从创建那一刻起就不是空数组。
- 建立 `store.$subscribe()` 订阅（状态历史）与（除非 `captureRuntimeTrace === false`）`store.$runtime.subscribeTrace()` 订阅（runtime 事件）。
- 若订阅建立过程本身抛错：已经建立成功的订阅会被逐个 `cleanup()`；清理过程中若又有新的失败，连同原始错误一起打包成 `AggregateError`（`code: 'CLEANUP_FAILED'`）抛出；清理全部成功则原样重新抛出最初的错误。

### `history`：状态历史与时间旅行

`store.$subscribe()` 是 Store 自身的粗粒度订阅——任意一个可变字段变化就触发一次通知，`createStoreDevTools` 在监听器里调用内部 `record()`（默认 `label: 'state change'`）。除创建时那条 `'initial'` 外，之后每条历史的 `label` 默认都是 `'state change'`；想要更有辨识度的标签，调用方需要主动 `tools.record('before-submit')`。

`state` 字段来自 `clone(store.$plain())`：`$plain()` **只包含 signal 支撑的标量字段**，computed（派生值）、方法、WASM 字段都不在其中——这是 `$plain()` 自身的行为，本包只是转发并克隆其结果。

`history.length` 超过 `maxHistory` 时，`record()` 会从数组头部裁掉最旧的条目，只保留最近 `maxHistory` 条；长时间运行后早期历史（包括最初的 `'initial'`）可能已被裁掉，此后 `jumpTo()` 传入一个已裁掉的 `id` 会抛错。

```ts
record(label: string = 'state change'): IStoreHistoryEntry
```

手动拍一份当前快照并追加进 `history`，返回新创建的条目本身。内部实现先算好 `timestamp`（`now()`）与克隆后的 `state`，全部就绪后才分配 `id` 并推入队列——一次失败的克隆/时钟调用不会留下半成品条目或消耗掉 `id` 序号。

```ts
jumpTo(id: number): void
```

在 `history` 中查找 `id` 匹配的条目：

1. 找不到时抛出 `RangeError('[store] unknown history entry: ${id}')`，`code: 'UNKNOWN_HISTORY_ENTRY'`。
2. 找到后，把内部"回放深度"计数器加一，调用 `store.$hydrate(clone(entry.state))` 把状态写回该快照（这里的 `clone` 就是构造时传入或默认的克隆函数，防止历史条目的引用在 `$hydrate` 过程中被业务代码污染），`finally` 里把计数器减一。
3. `$hydrate()` 是"宽松写回"：只写已知的 signal 字段，未知/派生/WASM 键静默跳过（`@migaia/store-light` 的默认行为），因此 `jumpTo()` 不会恢复 computed 值本身（它们会随依赖的 signal 变化自动重新计算），也不会恢复 WASM 字段或外部资源的状态。
4. `$hydrate()` 触发的 Store 通知会重新走一遍 `$subscribe` 监听器，但由于回放深度计数器 `> 0`，这次通知**不会**被当成新的用户操作再记一条历史，避免每次 `jumpTo()` 都在历史末尾追加一条"跳转产生的历史"。用计数器而不是布尔值是为了处理嵌套回放：某个 `$subscribe` 监听器若在回放期间又触发了另一次 `jumpTo()`，内层结束时不能提前解除外层的回放屏蔽，否则外层剩余的通知会被误记。

会话释放后（`disposed === true`）调用 `jumpTo` 会先在存活检查处失败（见 [`dispose`](#dispose-与生命周期)），不会走到上述查找逻辑。

```ts
clear(): void
```

清空 `history`、`actions`、`trace` 三个队列（长度归零），随后立即调用一次内部 `record('initial')`——清空后 `history` 不是空数组，而是重新只有一条 `'initial'`；`id` 计数器不归零，继续从上一次的 `nextId` 累加。

### `actions`：action 追踪

`@migaia/store-light` 的 Store 会把定义时写的每个方法自动包装成一次具名 action（名字是 `<debugName>.<方法名>`），内部经 `store.$runtime.runTracedAction()` 执行，广播 `type: 'action'`、`phase: 'start' | 'end' | 'error'` 的 runtime trace 事件。`createStoreDevTools` 订阅这条 trace 流，收到 `phase !== 'start'`（即 `'end'` 或 `'error'`）的 action 事件时自动调用内部 `recordAction()`，生成一条 `IActionTrace`（`error` 字段仅在 `phase === 'error'` 时有值）。

**只有 Store 自己方法产生的 action 会被自动记录**：`store.$batch()`、`store.$set()`、`store.$hydrate()` 内部走的是底层写入路径，不经过 `runTracedAction()`，因此不会自动出现在 `actions` 里；关心这类调用需要自行调用下面的 `recordAction()`。

```ts
recordAction(trace: Omit<IActionTrace, 'timestamp'>): void
```

手动追加一条 action 记录，`timestamp` 由内部 `now()` 补上。`actions.length` 超过 `maxHistory`（**不是 `maxTrace`**——`actions` 与 `trace` 共用同一份 runtime trace 输入，但队列上限各自独立，`actions` 复用的是 `maxHistory` 这个数字，没有独立的 `maxActions` 选项）时从头部裁掉最旧条目。

把 `options.captureRuntimeTrace` 设为 `false` 会连带关闭 action 的自动记录（两者共享同一条 trace 订阅），此时 `actions` 只能靠手动 `recordAction()` 填充。

存活检查：`record`/`recordAction`/`jumpTo`/`clear` 四个方法调用时都先检查 `disposed`，已释放会话立即抛 `Error('[store] DevTools session is disposed')`，`code: 'SESSION_DISPOSED'`。

### `trace`：runtime 原始事件流

`trace` 原样保存 `@migaia/reactive` runtime 广播的 `IRuntimeTraceEvent`：

```ts
type IRuntimeTraceEvent =
  | {
      type: 'observable-change';
      timestamp: number;
      observable: IRuntimeNodeDescriptor;
      reason: 'set' | 'notify';
    }
  | {
      type: 'dependency';
      timestamp: number;
      phase: 'connect' | 'disconnect';
      observable: IRuntimeNodeDescriptor;
      observer: IRuntimeNodeDescriptor;
      reason?: 'retrack' | 'invalidate' | 'dispose';
    }
  | {
      type: 'observer-run';
      timestamp: number;
      phase: 'start' | 'end' | 'error';
      observer: IRuntimeNodeDescriptor;
      durationMs?: number;
      error?: unknown;
    }
  | {
      type: 'action';
      timestamp: number;
      phase: 'start' | 'end' | 'error';
      name: string;
      durationMs?: number;
      error?: unknown;
    };

type IRuntimeNodeDescriptor = Readonly<{
  id: string;
  kind: 'observable' | 'observer' | 'computed';
  debugName?: string;
}>;
```

四种事件都携带只读的节点**描述符**（`id`/`kind`/`debugName?`），不是可变的图节点本身——在事件里长期持有引用不会阻止对应 Signal/Computed/Effect 被回收。`trace.length` 超过 `maxTrace` 时从头部裁掉最旧条目。`captureRuntimeTrace: false` 完全跳过这条订阅，`trace` 永远是空数组。

### 快照/克隆失败与诊断上报

`record()`/`recordAction()` 内部若抛错（例如自定义 `clone` 函数本身抛错，或 `now()` 抛错），会在 `$subscribe`/`subscribeTrace` 的监听器里被捕获：先尝试 `store.$runtime.reportError(error, { phase: 'trace-listener' })` 上报；如果这一步本身又抛错，退化为 `globalThis.reportError`（若存在）或 `console.error`，且这一步再失败也会被吞掉。**诊断工具的故障不会反过来打断正常的业务写入**——触发这次状态变化的业务代码不会因为快照失败而跟着抛错。

<a id="克隆策略"></a>

### 克隆策略

`options.clone` 默认是 `ClonePolicy.diagnostic`（`@migaia/store-middleware/tolerant-clone`）：优先用 `structuredClone`；遇到不可克隆的值（函数、DOM 句柄、Class 实例等）不抛错，而是递归遍历普通对象/数组，只在真正不可克隆的那个值上退化为引用共享，其余可克隆部分仍是独立拷贝。如果状态里包含敏感字段（token、密码等），默认克隆策略**不会做任何脱敏**——要么不让这些字段进入 `store.$plain()`（不用 signal 承载），要么传一个自行脱敏的 `clone` 函数替换默认值（见 README 的[高阶组合示例 5](./README.md#高阶组合示例)）。

<a id="dispose-与生命周期"></a>

### `dispose()` 与生命周期

```ts
dispose(): void
```

取消 `store.$subscribe()` 的订阅、取消 runtime trace 的监听（如果启用了的话），并把内部标记为已释放。清理时若有失败：只有一个失败直接重新抛出该错误；多个失败打包成 `AggregateError`（`code: 'CLEANUP_FAILED'`，`errors` 保留每一个原始失败）。`dispose()` 本身幂等——第二次及以后的调用直接返回，不会重复清理也不会抛错。

释放之后：

- `record`/`recordAction`/`jumpTo`/`clear` 均抛 `Error('[store] DevTools session is disposed')`，`code: 'SESSION_DISPOSED'`。
- 只读属性 `history`/`actions`/`trace` 仍可正常读取，只是不会再增长。

**必须在不再需要诊断时调用 `dispose()`**：不调用的话，`$subscribe()` 建立的订阅和 trace 监听器会一直挂在 Store 和 Runtime 上，既造成内存泄漏，也会让每次状态变化都多付出一次快照克隆的开销。典型用法是只在开发构建下创建、组件卸载或调试会话结束时释放。

---

<a id="依赖树模块"></a>

## 依赖树模块

```ts
import {
  getDependencyTree,
  getObserverTree,
  type IDependencyTreeNode
} from '@migaia/store-devtools';
```

`getDependencyTree`/`getObserverTree` 不依赖 `createStoreDevTools`，可独立使用，参数类型 `IObservable`/`IObserver` 来自 `@migaia/reactive/runtime`（内核内部图协议子路径，刻意不从 `@migaia/reactive` 主入口导出——第三方通常应该组合公开的 `Signal`/`Computed`/`Effect`，而不是直接操作图节点；本包需要读取节点内部的 `deps`/`subs`/`version` 才能画依赖图，所以走这条子路径导入）。

```ts
type IDependencyTreeNode = {
  kind: 'observable' | 'observer';
  label: string; // node.debugName ?? node.constructor?.name ?? 'AnonymousReactiveNode'
  version?: number; // 仅 kind === 'observable' 的节点携带；对应该节点当前的版本号
  children: IDependencyTreeNode[];
  circular?: boolean; // 该节点在当前递归路径上被重复访问
};

function getDependencyTree(observer: IObserver, maxDepth?: number): IDependencyTreeNode;
function getObserverTree(observable: IObservable, maxDepth?: number): IDependencyTreeNode;
```

### `maxDepth` 校验

两个函数的第二参数 `maxDepth` 默认 `20`，必须是 `>= 0` 的安全整数，否则同步抛出 `RangeError('[store] DevTools ${name} maxDepth must be a non-negative safe integer')`（`name` 分别是 `'dependency tree'`/`'observer tree'`），`code: 'INVALID_OPTION'`。

### `getDependencyTree(observer, maxDepth = 20)`

从一个 observer（典型是 Effect 或 Computed）出发，向上展开它依赖的每个 observable，再递归展开这些 observable 自己的依赖（如果一个 observable 同时也是 observer，例如 Computed）。根节点 `kind: 'observer'`，本身没有 `version` 字段。`maxDepth = 0` 时连根节点的直接边都不展开（`children` 为空数组）。

### `getObserverTree(observable, maxDepth = 20)`

方向相反：从一个 observable（典型是 Signal）出发，向下展开订阅它的每个 observer，再递归展开这些 observer 自己的订阅者。根节点 `kind: 'observable'`，携带 `version`。

### 循环判定

依赖图里"菱形共享"（同一个节点被两条不同路径各引用一次）很常见，那**不算**循环。判定用的是**当前这一条递归路径**，不是全局访问集合：进入一个节点前把它加入 `path` 集合（`Set<object>`），展开完子节点后（`finally` 里）再移出；只有在展开过程中重新踩到"仍然在当前路径栈上"的节点，才会把该节点标记 `circular: true` 并停止继续展开它的子节点。真正的自环/环形依赖会被正确截断，不会无限递归；菱形共享的两条分支各自都能正常展开到底。

```ts
getDependencyTree(someEffect, 5);
// {
//   kind: 'observer', label: 'someEffect',
//   children: [
//     { kind: 'observable', label: 'count', version: 3, children: [] }
//   ]
// }
```

---

<a id="命令常量模块"></a>

## 命令常量模块

```ts
import { StoreDevtoolsCommand, type IStoreDevtoolsCommand } from '@migaia/store-devtools';
```

```ts
const StoreDevtoolsCommand: {
  readonly dispatch: 'DISPATCH';
  readonly commit: 'COMMIT';
  readonly jumpToState: 'JUMP_TO_STATE';
  readonly jumpToAction: 'JUMP_TO_ACTION';
  readonly rollback: 'ROLLBACK';
  readonly reset: 'RESET';
};
type IStoreDevtoolsCommand = (typeof StoreDevtoolsCommand)[keyof typeof StoreDevtoolsCommand];
```

一张与 Redux DevTools 浏览器扩展协议同名的命令字符串常量表。**本包内部没有任何函数消费这张表**——`createStoreDevTools`/`getDependencyTree`/`getObserverTree` 都不引用它。它的存在是为了给调用方自己搭建"把 `history`/`jumpTo` 桥接到浏览器扩展协议"的适配层时，复用一套与协议同名的稳定字符串，避免各自拼写字面量。如果需要开箱即用地接入该协议，应使用 `@migaia/store-middleware` 的 `connectDevTools()`，本包不实现该协议本身。

---

<a id="错误模块"></a>

## 错误模块

```ts
import {
  StoreDevtoolsErrorCode,
  type IStoreDevtoolsErrorCode,
  STORE_DEVTOOLS_SOURCE,
  createStoreDevtoolsError,
  createStoreDevtoolsRangeError,
  createStoreDevtoolsAggregateError
} from '@migaia/store-devtools';
```

本包边界抛出的一切错误都保留原生 `Error`/`RangeError`/`AggregateError` 类型（不引入自定义错误类），并通过 `attachErrorIdentity`（`@migaia/utils/error`）就地打上 `source: '@migaia/store-devtools'` 与稳定 `code`——`instanceof` 判断和 `code` 判断可以同时使用。

```ts
const STORE_DEVTOOLS_SOURCE: '@migaia/store-devtools';
```

### `StoreDevtoolsErrorCode`

```ts
const StoreDevtoolsErrorCode: {
  readonly sessionDisposed: 'SESSION_DISPOSED';
  readonly unknownHistoryEntry: 'UNKNOWN_HISTORY_ENTRY';
  readonly invalidOption: 'INVALID_OPTION';
  readonly cleanupFailed: 'CLEANUP_FAILED';
};
type IStoreDevtoolsErrorCode = (typeof StoreDevtoolsErrorCode)[keyof typeof StoreDevtoolsErrorCode];
```

| 码值                    | 触发场景                                                                                                                                                               | 抛出的错误类型                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `SESSION_DISPOSED`      | 会话 `dispose()` 后继续调用 `record`/`recordAction`/`jumpTo`/`clear`                                                                                                   | `Error`                                                   |
| `UNKNOWN_HISTORY_ENTRY` | `jumpTo(id)` 传了一个不在 `history` 里的 `id`（含已被 `maxHistory` 裁掉的）                                                                                            | `RangeError`                                              |
| `INVALID_OPTION`        | `createStoreDevTools` 的 `options` 不是对象、`maxHistory`/`maxTrace` 非正整数、`now`/`clone` 非函数；或 `getDependencyTree`/`getObserverTree` 的 `maxDepth` 非非负整数 | `Error`（options 校验）或 `RangeError`（`maxDepth` 校验） |
| `CLEANUP_FAILED`        | `dispose()` 或构造期回滚清理时，多个订阅清理同时失败                                                                                                                   | `AggregateError`，`errors` 保留每个原始失败               |

`SESSION_DISPOSED`/`UNKNOWN_HISTORY_ENTRY` 是永久性错误：调用方应新建会话或检查 `id` 是否仍存活于 `history`，不要重试同一次调用。

### 错误工厂函数

```ts
function createStoreDevtoolsError(
  code: IStoreDevtoolsErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error;

function createStoreDevtoolsRangeError(code: IStoreDevtoolsErrorCode, message: string): RangeError;

function createStoreDevtoolsAggregateError(
  code: IStoreDevtoolsErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError;
```

三者都是本包用于构造带 `(source, code)` 标记错误的内部工厂，一并从公开入口导出，供需要抛出同风格错误的调用方复用（例如自定义 `clone` 内部转发校验失败）：

- `createStoreDevtoolsError`：构造普通 `Error`；`options.cause` 提供时会传入 `Error` 构造函数的 `{ cause }` 选项。
- `createStoreDevtoolsRangeError`：构造 `RangeError`，用于调用方需要 `instanceof RangeError` 分支处理的场景（本包自身用它构造 `maxDepth`/`unknownHistoryEntry` 相关错误）。
- `createStoreDevtoolsAggregateError`：构造 `AggregateError(errors, message)`，`errors` 原样保留、不做去重或规整。

```ts
const error = createStoreDevtoolsError(StoreDevtoolsErrorCode.invalidOption, 'bad option', {
  cause: originalError
});
error.message; // 'bad option'
(error as { code?: string }).code; // 'INVALID_OPTION'
(error as { source?: string }).source; // '@migaia/store-devtools'
```

---

<a id="高阶组合示例"></a>

## 高阶组合示例

见 [README.md 的高阶组合示例](./README.md#高阶组合示例)：开发期挂载/卸载释放、手动锚点 + 时间旅行、关闭 runtime trace 降低开销、双向依赖树排查、自定义 `clone` 脱敏。这里补充两个更细节的排查场景。

### 6. 用 `trace` 精确定位一次意外的多余重算

```ts
import { createStoreDevTools } from '@migaia/store-devtools';

const tools = createStoreDevTools(store);
store.recompute();

const observerRuns = tools.trace.filter((event) => event.type === 'observer-run');
console.log(observerRuns.map((event) => [event.observer.debugName, event.phase, event.durationMs]));
```

### 7. `jumpTo` 抛 `UNKNOWN_HISTORY_ENTRY` 时按错误码分支处理

```ts
import { StoreDevtoolsErrorCode, type IStoreDevtoolsErrorCode } from '@migaia/store-devtools';

try {
  tools.jumpTo(staleId);
} catch (error) {
  if (
    (error as { code?: IStoreDevtoolsErrorCode }).code ===
    StoreDevtoolsErrorCode.unknownHistoryEntry
  ) {
    console.warn('该历史条目已被裁剪，改用当前 history 里最早的一条');
    tools.jumpTo(tools.history[0].id);
  } else {
    throw error;
  }
}
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
