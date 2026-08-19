# `@migaia/store-devtools`

**`@migaia/store-light` 的本地诊断工具**：给一个响应式 Store 接上状态历史、时间旅行、action 追踪，并提供两个独立的依赖关系树遍历函数。

## 适用与不适用场景

**适用**：排查"这个字段为什么变了"（`history` + `jumpTo`）、"哪次 action 报错了/耗时多久"（`actions`）、"这个 Effect/Signal 到底连着谁"（`getDependencyTree`/`getObserverTree`）。开发期本地诊断，不改动 Store 本身的任何写入行为，只是订阅它已有的通知机制。

**不适用**：不要把它当作浏览器 DevTools 扩展协议的实现——那是 `@migaia/store-middleware` 的 `connectDevTools()`，本包不接入该协议（`StoreDevtoolsCommand` 只是与该协议同名的命令字符串表，供调用方自己搭桥时复用，本包内部不消费它）。也不要把它当作生产环境状态审计或持久化层：`history` 只在内存里，进程重启即丢失；`jumpTo()` 不是事务回滚，无法撤销已经发出的网络请求或其他副作用。

## 安装

```bash
pnpm add @migaia/store-devtools
```

`@migaia/reactive`、`@migaia/store-light`、`@migaia/store-middleware`、`@migaia/utils` 都是本包的 `dependencies`，安装时会一并拉取；`createStoreDevTools` 需要一个已经用 `@migaia/store-light` 的 `createStore()` 建好的 `IReactiveStore` 实例，本身不负责创建 Store。

## 目录

- [诊断会话：`createStoreDevTools`](#诊断会话)
- [依赖树：`getDependencyTree` / `getObserverTree`](#依赖树)
- [命令常量：`StoreDevtoolsCommand`](#命令常量)
- [错误：`StoreDevtoolsErrorCode` 与错误工厂](#错误模块)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="诊断会话"></a>

## 诊断会话：`createStoreDevTools`

```ts
import {
  createStoreDevTools,
  type IStoreDevTools,
  type IStoreDevToolsOptions,
  type IStoreHistoryEntry,
  type IActionTrace
} from '@migaia/store-devtools';
```

**`createStoreDevTools`｜10 秒上手** —— 给一个 Store 接上历史记录、action 追踪与时间旅行：

```ts
const tools = createStoreDevTools(store, { maxHistory: 200 });

store.increment(); // Store 自己定义的方法，被 runtime 自动追踪为一次 action

tools.history; // [{ id: 1, label: 'initial', ... }, { id: 2, label: 'state change', ... }]
tools.actions; // [{ name: 'myStore.increment', durationMs, ... }]

tools.jumpTo(tools.history[0].id); // 用该快照调用 store.$hydrate()，状态退回初始值
tools.dispose(); // 用完必须调用，取消对 Store 的订阅
```

全部选项（第二参数 `IStoreDevToolsOptions`）：

- `maxHistory?: number` —— 默认 `100`；`history` **和** `actions` 两个队列共用它做上限（`actions` 没有独立的 `maxActions`）；必须是 `>= 1` 的安全整数，否则构造时抛错（不会被静默夹到 `1`）
- `maxTrace?: number` —— 默认 `1000`；仅约束 `trace` 队列；同样必须是 `>= 1` 的安全整数，否则抛错
- `captureRuntimeTrace?: boolean` —— 默认 `true`；传 `false` 时完全不订阅 runtime trace，`trace` 永远为空数组，`actions` 也不再被自动填充（只能靠手动 `recordAction()`）
- `now?: () => number` —— 默认 `Date.now`；时间戳来源，传非函数值抛错
- `clone?: (state: Record<string, unknown>) => Record<string, unknown>` —— 默认 `ClonePolicy.diagnostic`（来自 `@migaia/store-middleware/tolerant-clone`，尽力克隆、遇到不可克隆值不抛错）；传非函数值抛错

返回对象 `IStoreDevTools` 的全部成员：

- `history: readonly IStoreHistoryEntry[]` —— 只读历史队列，`{ id, timestamp, label, state }`
- `actions: readonly IActionTrace[]` —— 只读 action 记录，`{ timestamp, name, payload?, durationMs?, error? }`
- `trace: readonly IRuntimeTraceEvent[]` —— 只读 runtime 原始事件流（来自 `@migaia/reactive`）
- `record(label?: string): IStoreHistoryEntry` —— 手动拍一份当前快照追加进 `history`，`label` 默认 `'state change'`
- `recordAction(trace: Omit<IActionTrace, 'timestamp'>): void` —— 手动追加一条 action 记录
- `jumpTo(id: number): void` —— 用某条历史快照调用 `store.$hydrate()`；`id` 不存在（含已被裁剪）时抛 `RangeError`
- `clear(): void` —— 清空 `history`/`actions`/`trace`，随后立刻记一条新的 `'initial'` 历史
- `dispose(): void` —— 取消订阅与 trace 监听，幂等；释放后 `record`/`recordAction`/`jumpTo`/`clear` 均抛 `SESSION_DISPOSED`，只读队列仍可读

---

<a id="依赖树"></a>

## 依赖树：`getDependencyTree` / `getObserverTree`

```ts
import {
  getDependencyTree,
  getObserverTree,
  type IDependencyTreeNode
} from '@migaia/store-devtools';
```

这两个函数**不依赖 `createStoreDevTools`**，可独立使用，只需要一个 `@migaia/reactive/runtime` 的 `IObservable`/`IObserver` 实例（Signal/Computed/Effect 的内部图节点）。

**`getDependencyTree`｜5 秒上手** —— 从一个 observer（Effect/Computed）出发，向上展开它依赖的每个 observable：

```ts
getDependencyTree(someEffect);
// { kind: 'observer', label: 'someEffect', children: [{ kind: 'observable', label: 'count', version: 3, children: [] }] }
```

**`getObserverTree`｜5 秒上手** —— 方向相反，从一个 observable（Signal）出发，向下展开订阅它的每个 observer：

```ts
getObserverTree(someSignal);
// { kind: 'observable', label: 'count', version: 3, children: [{ kind: 'observer', label: 'someEffect', children: [] }] }
```

全部选项（均为第二参数 `maxDepth?: number`，默认 `20`）：

- `maxDepth` —— 必须是 `>= 0` 的安全整数，否则抛 `RangeError`；`0` 时连根节点的直接边都不展开
- 两个函数都会正确标出循环引用（`circular: true`）而不是无限递归；"菱形共享"（同一节点被两条路径各引用一次）不算循环，判定按**当前递归路径**而非全局访问集

---

<a id="命令常量"></a>

## 命令常量：`StoreDevtoolsCommand`

```ts
import { StoreDevtoolsCommand, type IStoreDevtoolsCommand } from '@migaia/store-devtools';
```

**`StoreDevtoolsCommand`｜3 秒上手** —— 一张与 Redux DevTools 扩展协议同名的命令字符串表，本包内部任何函数都不消费它；只有自己搭桥接入该扩展协议时才用得上：

```ts
StoreDevtoolsCommand.jumpToState; // 'JUMP_TO_STATE'
```

无调用参数，是常量对象；全部取值：`dispatch`(`'DISPATCH'`)、`commit`(`'COMMIT'`)、`jumpToState`(`'JUMP_TO_STATE'`)、`jumpToAction`(`'JUMP_TO_ACTION'`)、`rollback`(`'ROLLBACK'`)、`reset`(`'RESET'`)。

---

<a id="错误模块"></a>

## 错误：`StoreDevtoolsErrorCode` 与错误工厂

```ts
import {
  StoreDevtoolsErrorCode,
  STORE_DEVTOOLS_SOURCE,
  createStoreDevtoolsError,
  createStoreDevtoolsRangeError,
  createStoreDevtoolsAggregateError,
  type IStoreDevtoolsErrorCode
} from '@migaia/store-devtools';
```

**`StoreDevtoolsErrorCode`｜3 秒上手** —— 稳定错误码表，用于 `switch`/比较：

```ts
if (error.code === StoreDevtoolsErrorCode.sessionDisposed) {
  /* ... */
}
```

无调用参数；全部取值：`sessionDisposed`(`'SESSION_DISPOSED'`)、`unknownHistoryEntry`(`'UNKNOWN_HISTORY_ENTRY'`)、`invalidOption`(`'INVALID_OPTION'`)、`cleanupFailed`(`'CLEANUP_FAILED'`)。

**`STORE_DEVTOOLS_SOURCE`｜3 秒上手** —— 本包每个错误都会被打上的 `source` 常量：

```ts
STORE_DEVTOOLS_SOURCE; // '@migaia/store-devtools'
```

无调用参数，是字符串常量。

**`createStoreDevtoolsError` / `createStoreDevtoolsRangeError` / `createStoreDevtoolsAggregateError`｜5 秒上手** —— 本包内部用来构造带 `source`/`code` 标记错误的工厂，一般不需要调用方直接使用，仅在需要抛出与本包同风格的错误（例如自定义 `clone` 内部转发）时才用得上：

```ts
throw createStoreDevtoolsError(StoreDevtoolsErrorCode.invalidOption, 'bad option');
throw createStoreDevtoolsRangeError(StoreDevtoolsErrorCode.invalidOption, 'bad option');
throw createStoreDevtoolsAggregateError(
  StoreDevtoolsErrorCode.cleanupFailed,
  [err1, err2],
  'cleanup failed'
);
```

参数：

- `createStoreDevtoolsError(code, message, options?)` —— `code: IStoreDevtoolsErrorCode`（必填）、`message: string`（必填）、`options.cause?: unknown`（可选，透传进 `Error` 的 `cause`）；返回原生 `Error`
- `createStoreDevtoolsRangeError(code, message)` —— `code`/`message` 均必填；返回原生 `RangeError`（用于需要 `instanceof RangeError` 分支的场景，例如 `maxDepth`/`maxHistory` 校验）
- `createStoreDevtoolsAggregateError(code, errors, message)` —— `code`（必填）、`errors: readonly unknown[]`（必填，保留全部原始失败）、`message: string`（必填）；返回原生 `AggregateError`

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 开发期挂载诊断会话，卸载时释放

```ts
import { createStoreDevTools } from '@migaia/store-devtools';
import { createStore } from '@migaia/store-light';

const store = createStore({ count: 0 }, { debugName: 'counter' });
const tools = import.meta.env.DEV ? createStoreDevTools(store, { maxHistory: 200 }) : undefined;

store.$batch((draft) => {
  draft.count++;
});

// 组件卸载 / 调试会话结束时
tools?.dispose();
```

### 2. 手动打标签的可回退锚点 + 时间旅行

```ts
import { createStoreDevTools } from '@migaia/store-devtools';

const tools = createStoreDevTools(store);
const beforeSubmit = tools.record('before-submit');

await submitForm(store.$plain());

if (submitFailed) {
  tools.jumpTo(beforeSubmit.id); // 退回提交前的状态
}
```

### 3. 关闭 runtime trace，只保留状态历史，降低高频写入场景的开销

```ts
import { createStoreDevTools } from '@migaia/store-devtools';

const tools = createStoreDevTools(highFrequencyStore, {
  captureRuntimeTrace: false, // trace 恒为空，actions 也不再自动填充
  maxHistory: 50
});

// 仍然可以手动记录关心的 action
tools.recordAction({ name: 'manual-batch', durationMs: 12 });
```

### 4. 排查一个 Effect 到底依赖了哪些节点，再反向确认谁订阅了某个 Signal

```ts
import { getDependencyTree, getObserverTree } from '@migaia/store-devtools';

console.log(JSON.stringify(getDependencyTree(someEffect, 5), null, 2));
console.log(JSON.stringify(getObserverTree(someSignal, 5), null, 2));
```

### 5. 用自定义 `clone` 对敏感字段脱敏后再进入历史

```ts
import { createStoreDevTools } from '@migaia/store-devtools';
import { ClonePolicy } from '@migaia/store-middleware/tolerant-clone';

const tools = createStoreDevTools(authStore, {
  clone: (state) => {
    const snapshot = ClonePolicy.diagnostic(state) as Record<string, unknown>;
    if ('token' in snapshot) snapshot.token = '[redacted]';
    return snapshot;
  }
});
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
