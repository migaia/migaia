# `@migaia/store-middleware` 使用指南

本文是 `@migaia/store-middleware` 的完整参考。先看 [README.md](./README.md#高阶组合示例) 的高阶组合示例，跑起来之后再回来查这里的细节——README 讲"是什么、适合什么场景、每个导出怎么用"，本文讲每一个 API 的精确签名、每一种边界行为，以及和 `@migaia/store-light`、`@migaia/plugin-host` 之间容易踩坑的联动关系。

## 目录

1. [定位与依赖关系](#1-定位与依赖关系)
2. [事件模型](#2-事件模型)
3. [MutationPolicy 写入策略](#3-mutationpolicy-写入策略)
4. [IStoreMiddlewareHost API 参考](#4-istoremiddlewarehost-api-参考)
5. [bindStoreMiddleware 完整行为](#5-bindstoremiddleware-完整行为)
6. [编写中间件插件](#6-编写中间件插件)
7. [DevTools 集成](#7-devtools-集成)
8. [ClonePolicy 克隆策略](#8-clonepolicy-克隆策略)
9. [Pipeline 模式与错误边界](#9-pipeline-模式与错误边界)
10. [生命周期与资源释放](#10-生命周期与资源释放)
11. [与相关包的关系](#11-与相关包的关系)
12. [常见问题排查](#12-常见问题排查)

---

## 1. 定位与依赖关系

`@migaia/store-middleware` 依赖 `@migaia/store-light`（Store 本体）、`@migaia/reactive`（Runtime）和 `@migaia/plugin-host`（通用插件宿主机制）。它自己不实现插件安装/卸载/资源清理这些通用能力，全部通过 `@migaia/plugin-host` 的 `defineHost` 组合复用；这一层只负责"Store 领域该有哪些事件、哪些写入策略"。

```ts
import { createStoreMiddlewareHost, type IStoreMiddlewareHost } from '@migaia/store-middleware';
// IStoreMiddlewareHost<S> = IHostHandle<IStoreMiddlewareCore<S>, IMiddlewareEvent<S>, readonly []> & Store 领域成员
```

不熟悉 `PluginHost` 的插件安装、卸载、pipeline、错误码等通用机制，先读 `@migaia/plugin-host` 的 USEGUIDE——本文只讲 Store 领域特有的部分，通用机制不重复。

---

## 2. 事件模型

所有事件共享 `IMiddlewareEvent<S>` 这个联合类型，三种形状：

```ts
type IMiddlewareActionEvent =
  | {
      type: 'action';
      phase: 'start';
      name: string;
      timestamp: number;
      metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      type: 'action';
      phase: 'end';
      name: string;
      timestamp: number;
      durationMs: number;
      metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      type: 'action';
      phase: 'error';
      name: string;
      timestamp: number;
      durationMs: number;
      error: unknown;
      metadata?: Readonly<Record<string, unknown>>;
    };

type IMiddlewareStateEvent<S> = {
  type: 'state';
  name: string;
  timestamp: number;
  previous: S;
  next: S;
  metadata?: Readonly<Record<string, unknown>>;
};

type IMiddlewareErrorEvent = {
  type: 'error';
  phase: string;
  timestamp: number;
  error: unknown;
  metadata?: Readonly<Record<string, unknown>>;
};
```

| 事件               | 何时产生                                   | 关键字段                                   |
| ------------------ | ------------------------------------------ | ------------------------------------------ |
| `action` / `start` | 一个 action 开始执行                       | `name`                                     |
| `action` / `end`   | action 成功完成                            | `durationMs`                               |
| `action` / `error` | action 抛出异常                            | `durationMs`、`error`（原始异常）          |
| `state`            | 状态发生变化                               | `previous`/`next`（同类型 `S` 的两个快照） |
| `error`            | 诊断层面的错误上报（不是业务 action 失败） | `phase`（自由字符串，标识来源）            |

`timestamp` 统一是 `Date.now()`；`action` 的 `durationMs` 用 `performance.now()`（不可用时退回 `Date.now()`）计算，因此在没有高精度计时器的环境下精度会退化到毫秒级 wall clock。

---

## 3. MutationPolicy 写入策略

```ts
type IMutationPolicyMode = 'off' | 'actions-only';

class MutationPolicy implements IMutationGuard {
  constructor(mode?: IMutationPolicyMode); // 默认 'off'
  get insideAction(): boolean;
  assertMutationAllowed(operation?: string): void; // 默认 operation = 'mutation'
  runInAction<T>(fn: () => T): T;
}

function createMutationPolicy(mode?: IMutationPolicyMode): MutationPolicy;
```

- `mode: 'off'`（默认）：`assertMutationAllowed()` 永远不抛错，等同于没有策略。
- `mode: 'actions-only'`：只有当 `runInAction()` 的调用深度大于 0（即当前处于某个 action 内部，支持嵌套）时，`assertMutationAllowed()` 才不抛错；深度为 0 时抛 `Error('[store] ${operation} is not allowed outside an action')`。
- `insideAction`：只读 getter，反映当前是否处于至少一层 `runInAction()` 内。
- 策略只负责**判断能不能改**，不负责回滚——如果调用方绕过判断硬改了字段，`MutationPolicy` 不会撤销这次写入。

### 关键联动：必须和 `createStore` 共享同一个实例

`MutationPolicy` 由本包提供，但真正拦截"直接改字段"的地方在 `@migaia/store-light` 的 `createStore()`：

```ts
import { createStore } from '@migaia/store-light';
import { createMutationPolicy, bindStoreMiddleware } from '@migaia/store-middleware';

const mutationPolicy = createMutationPolicy('actions-only');

const store = createStore(shape, { mutationPolicy }); // ① Store 自己的字段写入走这个实例判断
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  mutationPolicy
}); // ② Host 拿到的是同一个实例
```

- ① 是真正生效的一半：Store 的 `$batch()`/`$set()`/action 方法调用会经过 `mutationPolicy.runInAction(() => runtime.batch(fn))`，直接字段赋值（比如 `store.count = 1`）会先过 `assertMutationAllowed('set(count)')`。
- ② 只是把同一个实例挂到 `host.mutationPolicy` 上，供你在别处读取 `host.mutationPolicy.insideAction`，或者用 `host.runAction()` 包裹**不是** Store 方法、但你也想纳入同一套 action 边界判断的代码。
- 两个独立策略不会取消 Store 自己的直接写守卫；Store action 仍能进入其自身作用域。只有同实例时，host.runAction 才能替 Store 策略授权。
- `bindStoreMiddleware()` 转发 Store 自己的 action trace 时，用的是 `host.emit()` 直接派发事件，**不会**再调用一次 `host.runAction()`（否则会重复触发 ①的 `runInAction`，虽然重入安全，但会产生重复的 action 事件）。真正让 `actionDepth` 递增的，只有 `createStore` 内部对 action/`$batch`/`$set` 的包裹，以及你显式调用的 `host.runAction()`/`mutationPolicy.runInAction()`。

### 独立使用（不接 Store）

```ts
const policy = createMutationPolicy('actions-only');

policy.runInAction(() => {
  policy.assertMutationAllowed('settings.theme');
});
```

不要把整段异步流程塞进一个 `runInAction()` 期待跨 `await` 保持"处于 action 内"——`await` 之后的微任务已经脱离了这次同步调用栈，`actionDepth` 早已经在 `finally` 里递减。异步流程应该在每一段真正同步写入的位置各自重新进入 `runInAction()`。

---

## 4. IStoreMiddlewareHost API 参考

```ts
function createStoreMiddlewareHost<S>(options: IStoreMiddlewareHostOptions<S>): IStoreMiddlewareHost<S>;

// 冻结句柄：IHostHandle 的公共成员（use/unUse/dispose 等）加下列 Store 领域成员
// IStoreMiddlewareSurface 用于展开领域成员，不是新增根导出。
type IStoreMiddlewareSurface<S> = Readonly<{
  readonly mutationPolicy: MutationPolicy
  emit(event: IMiddlewareEvent<S>): void
  runAction<T>(name: string, fn: () => T, metadata?: Readonly<Record<string, unknown>>): T
  recordState(
    name: string,
    previous: S,
    next: S,
    metadata?: Readonly<Record<string, unknown>>
  ): void
  recordError(phase: string, error: unknown, metadata?: Readonly<Record<string, unknown>>): void
  connectDevTools(adapter: IDevToolsAdapter<S>, name?: string): Promise<void>
  attachBindingDisposer(disposer: IDisposer): void
}>

type IStoreMiddlewareHost<S> = IHostHandle<
  IStoreMiddlewareCore<S>,
  IMiddlewareEvent<S>,
  readonly [],
  IStoreMiddlewareSurface<S>
>

type IStoreMiddlewareHostOptions<S> = IPluginHostOptions & {
  runtime: IRuntime;
  getState: () => S;
  applyState?: (state: S) => void;
  mutationPolicy?: MutationPolicy; // 缺省时内部新建一个 mode: 'off' 的实例
};
```

`createStoreMiddlewareHost()` 会**强制把 pipeline 模式覆盖成 `'sync'`**——即便 `options.pipeline.mode` 传了别的值也会被覆盖。原因：Store 领域事件要求同步、可预测的处理顺序，中间件不应该让一次状态变化的观察产生跨微任务的乱序。这意味着所有中间件插件只能用 `core.usePipeline`，调用 `core.useAsyncPipeline`/`core.useGeneratorPipeline` 会触发 `@migaia/plugin-host` 的 `PIPELINE_MODE_MISMATCH` 错误。

| 方法                                           | 参数类型                                                                                 | 同步/异步 | 行为                                                                                                                                                                                                               | 抛错语义                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `emit(event)`                                  | `event: IMiddlewareEvent<S>`                                                             | 同步      | 同步跑一遍 pipeline；若某个 stage 忘了调用 `next()`，会以 `phase: 'trace-listener'` 上报到 `runtime.reportError()`，公开 emit 的 pipeline 失败可同步传播                                                                         | 可同步抛出 pipeline 错误；遗漏 next 另行报告 |
| `runAction(name, fn, metadata?)`               | `name: string`；`fn: () => T`；`metadata?: Readonly<Record<string, unknown>>`            | 同步      | 派发 `action:start` → 用 `mutationPolicy.runInAction(() => runtime.batch(fn))` 执行 `fn` → 成功派发 `action:end`（带 `durationMs`），失败派发 `action:error` 后**重新抛出原始异常**                                | `fn` 抛出的异常会正常向调用方传播           |
| `recordState(name, previous, next, metadata?)` | `name: string`；`previous: S`；`next: S`；`metadata?: Readonly<Record<string, unknown>>` | 同步      | 派发一个 `state` 事件                                                                                                                                                                                              | 中间件抛错被隔离，不会传给调用方            |
| `recordError(phase, error, metadata?)`         | `phase: string`；`error: unknown`；`metadata?: Readonly<Record<string, unknown>>`        | 同步      | 派发一个 `error` 事件；如果在处理上一个 `error` 事件期间**又**调用了 `recordError`（重入），直接把新错误转发给 `runtime.reportError({ phase: 'trace-listener' })`，不会再触发一轮 pipeline，避免错误处理本身死循环 | 不抛错                                      |
| `connectDevTools(adapter, name?)`              | `adapter: IDevToolsAdapter<S>`；`name?: string`                                          | 异步      | 见 [§7](#7-devtools-集成)                                                                                                                                                                                          | 安装失败按 `host.use()` 的规则处理    |
| `attachBindingDisposer(disposer)`              | `disposer: IDisposer`                                                                    | 同步      | 登记一个额外的清理函数，`dispose()` 时按后进先出顺序执行，先于插件卸载；关闭开始后新登记立即执行，同步失败向调用方传播                                                                                                                                             | —                                           |

**所有派发方法（`runAction`/`recordState`/`recordError`）对中间件本身抛出的异常都是隔离的**——一个写日志的中间件报错，不会影响业务代码继续执行；唯一的例外是 `runAction()` 包裹的**业务函数 `fn`** 抛错，这个异常按原样向外传播，因为那是业务逻辑本身的失败，不是中间件诊断层的失败。

`IStoreMiddlewareCore<S>`（插件 `install(core)` 拿到的领域 core）额外提供：

```ts
type IStoreMiddlewareCore<S> = {
  runtime: IRuntime;
  getState(): S;
  applyState(state: S): void; // 未提供 options.applyState 时调用会抛错
  reportError(error: unknown, phase: string): void; // 透传到 runtime.reportError
};
```

---

## 5. bindStoreMiddleware 完整行为

```ts
type IStoreMiddlewareBindingOptions = {
  execution: {
    mutationTimeoutMs: number | false;
    pipelineDrainTimeoutMs: number | false;
  };
  mutationPolicy?: MutationPolicy;
  actionPrefix?: string;
  clone?: (state: Record<string, unknown>) => Record<string, unknown>; // 默认 ClonePolicy.diagnostic
};

type IStoreMiddlewareBinding<S extends Record<string, unknown>> = IHostHandle<
  IStoreMiddlewareCore<Record<string, unknown>>,
  IMiddlewareEvent<Record<string, unknown>>,
  readonly [],
  IStoreMiddlewareSurface<Record<string, unknown>> & { readonly store: IReactiveStore<S> }
>

function bindStoreMiddleware<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options: IStoreMiddlewareBindingOptions
): IStoreMiddlewareBinding<S>;
```

这是接入一个已有 `@migaia/store-light` Store 的推荐入口，内部做了三件事：

1. **创建 Host**：`getState` 每次调用都返回 `clone(store.$plain())`——默认用 `ClonePolicy.diagnostic`（尽力深拷贝，不抛错），因此每次读取尽力复制；不可复制子树可能与 Store、其它中间件或其它读取共享引用，不保证全树隔离。`applyState` 桥接到 `store.$hydrate(state)`。
2. **订阅状态变化**：`store.$subscribe(() => { ... })`——每次 Store 通知，取一份新的 `clone($plain())` 作为 `next`，连同上一次记录的 `previous` 一起 `host.recordState('store:update', previous, next)`，事件名固定是 `'store:update'`，然后把 `previous` 更新为这次的 `next`。
   - `previous` 的初值是**绑定那一刻**的 `clone(store.$plain())`——如果 Store 在 `bindStoreMiddleware()` 调用之前已经有过状态变化，这些历史变化不会被回溯出事件，第一条 `state` 事件的 `previous` 反映的是"绑定时刻"的状态，不是"Store 创建时刻"的状态。
3. **订阅 Runtime action trace**：`store.$runtime.subscribeTrace((event) => { ... })`——只转发 `event.type === 'action'` 的 trace，且如果传了 `actionPrefix`，只转发 `event.name` 以该前缀开头的 action；转发时直接调用 `host.emit(...)` 构造对应的 `action:start`/`action:end`/`action:error` 事件（**不经过** `host.runAction()`，不会重复触发 `mutationPolicy.runInAction`）。

`clone` 快照只包含 `$plain()` 暴露的字段——computed（派生）、方法、WASM 支撑字段和其他外部资源不在其中，这些字段的变化不会出现在 `state` 事件的 `previous`/`next` 里。

`host.dispose()` 时，`attachBindingDisposer` 登记的两个 disposer（状态订阅、trace 订阅）会先于插件卸载被清理；`bindStoreMiddleware()` 本身**不持有 Store 或 Runtime 的所有权**，`dispose()` 之后 Store 仍然正常工作，只是不再有中间件观察它。

返回值是一个新的冻结对象：带有 Host 句柄的全部成员，额外挂了一个只读的 `store` 属性指回传入的 Store，方便拿到 Host 后还能访问原始 Store。

---

## 6. 编写中间件插件

新代码推荐直接写 `IStoreMiddlewarePlugin<S>`（本质是 `@migaia/plugin-host` 的 `IPlugin`），可以用到 `core.config`、`core.getShared`、`core.onDispose` 等全部通用能力：

```ts
import type { IStoreMiddlewarePlugin } from '@migaia/store-middleware';

const audit: IStoreMiddlewarePlugin<AppState> = {
  name: 'audit',
  install: (core) => {
    core.usePipeline((event, next) => {
      next(event);
      if (event.type === 'action' && event.phase === 'end') {
        auditSink({ action: event.name, state: core.getState() });
      }
    });
    return {};
  }
};

await host.use(audit);
await host.unUse('audit');
```

旧 middlewarePlugin/IStoreMiddleware/IMiddlewareContext 适配路已删除；直接采用上面的 canonical plugin 与 sync stage。

内置的 `loggerMiddleware(sink?)`：

```ts
function loggerMiddleware<S = any>(
  sink?: (event: IMiddlewareEvent<unknown>, state: unknown) => void
): IStoreMiddlewarePlugin<S>;
```

日志插件只把状态当作 `unknown` 交给 `sink`，不依赖状态结构，所以 `S` 默认是 `any`：不写类型参数也能安装到任意状态类型的 Host；需要把插件固定到某个 Host 的状态类型时再显式传 `S`。

默认 `sink` 是 `console.log('[store]', event, state)`；插件名固定 `'store-logger'`；每个事件先用 `next(event)` 记录继续值，再在当前 stage 内调用 `sink(event, core.getState())`；下游在当前 stage 返回后才执行——`state` 是调用 `sink` 那一刻的最新快照，不是事件产生时的快照。

**一个插件 stage 最多调用一次 `next(event)`。** 不调用 `next()` 只会阻止事件继续传给后面的插件，不会撤销已经发生的 Store 写入——重复或延迟调用会被 `@migaia/plugin-host` 报告为 pipeline 违规（见其 USEGUIDE 的 `PIPELINE_NEXT_DUPLICATE`/`PIPELINE_NEXT_LATE`）。插件需要监听外部资源时，在 `install(core)` 内调用 `core.onDispose(disposer)`；卸载时 Host 自动清理。

---

## 7. DevTools 集成

```ts
type IDevToolsCommand<S> =
  { type: 'jump'; state: S } | { type: 'reset'; state: S } | { type: 'commit' };

type IDevToolsAdapter<S> = {
  init(state: S): void;
  send(event: IMiddlewareEvent<S>, state: S): void;
  subscribe?(listener: (command: IDevToolsCommand<S>) => void): IDisposer;
};

function createReduxDevToolsAdapter<S>(
  connection: IReduxDevToolsConnection<S>,
  runtime?: IRuntime
): IDevToolsAdapter<S>;
```

`createReduxDevToolsAdapter()` 把一个符合 Redux DevTools 扩展协议的 `connection`（`init`/`send`/`subscribe`）转换成本包的 `IDevToolsAdapter`：

- `send` 会把事件包装成 `{ type: '<name>:<phase>' 或 '<name>' 或 'error:<phase>', event }` 发给 `connection.send()`。
- `subscribe` 只识别 `message.type === 'DISPATCH'` 的消息；`payload.type` 为 `COMMIT` 时产生 `{ type: 'commit' }`；为 `JUMP_TO_STATE`/`JUMP_TO_ACTION`/`ROLLBACK`/`RESET` 且 `message.state` 存在时，尝试 `JSON.parse(message.state)`，解析失败不执行该命令，并向可选 runtime（默认共享 Runtime）报告原 SyntaxError/DEVTOOLS_MESSAGE_INVALID；`RESET` 映射成 `{ type: 'reset' }`，其余映射成 `{ type: 'jump' }`。

`host.connectDevTools(adapter, name = 'store-devtools')` 内部把 adapter 包成一个插件并 `await host.use(plugin)`：

- 安装时立刻调用 `adapter.init(core.getState())`。
- 注册一个 pipeline stage：先放行事件给下游（`next(event)`），再 `adapter.send(event, core.getState())`——如果同一个 Host 上还装了别的插件，多个 sync stage 之间"谁先看到事件"取决于安装顺序，精确的执行顺序规则见 `@migaia/plugin-host` USEGUIDE 的 Pipeline 一节。
- 通过 `core.onDispose()` 订阅 `adapter.subscribe`：收到 `commit` 时重新 `adapter.init(core.getState())`；收到 `jump`/`reset` 时用 `host.runAction('devtools:<type>', () => core.applyState(command.state))` 执行——**这一步会产生一次真正的 action 事件**（因为 DevTools 时间旅行本身也应该在事件流里可见），并且要求构造 Host 时提供了 `applyState`，否则抛错 `[store] DevTools state command requires applyState`。

配合 `bindStoreMiddleware()` 使用时，`applyState` 已经桥接到 `store.$hydrate()`，因此 DevTools 的状态回放只能恢复 `$plain()` 暴露的普通字段——不能撤销网络请求或其他外部副作用，也不会还原 computed/方法/WASM 字段（它们本来就不在快照里）。

```ts
await host.connectDevTools(createReduxDevToolsAdapter(connection));
// ...
await host.unUse('store-devtools');
```

---

## 8. ClonePolicy 克隆策略

`tolerant-clone.ts` 导出三种"给调用方一份拷贝"的显式策略，供自定义 `bindStoreMiddleware({ clone })` 或中间件内部使用：

```ts
type IClonePolicyMode = 'immutable' | 'opaque' | 'diagnostic';

function immutableSnapshotClone<T>(value: T): T; // 真独立深拷贝，做不到就抛错
function opaqueReferenceClone<T>(value: T): T; // 完全不拷贝，原样返回引用
function diagnosticClone<T>(value: T): T; // 尽力而为，永不抛错

const ClonePolicy: {
  immutable: typeof immutableSnapshotClone;
  opaque: typeof opaqueReferenceClone;
  diagnostic: typeof diagnosticClone;
};

```

| 方法/签名                                                  | 参数类型   | 同步/异步 | 行为                                                                                                                                                                               | 适合谁                                                                                             |
| ---------------------------------------------------------- | ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ClonePolicy.immutable`（`immutableSnapshotClone(value)`） | `value: T` | 同步      | 先接纳严格数据图再交给 Utils 克隆；缺少 `structuredClone`，或值里含有函数/DOM 句柄/类实例等不可克隆内容时，**抛错**而不是悄悄返回一份共享引用                                       | 需要"这一定是独立快照"这个保证的调用方——比如把 `previous` 当作历史记录长期持有，不能被后续写入污染 |
| `ClonePolicy.opaque`（`opaqueReferenceClone(value)`）      | `value: T` | 同步      | 不做任何拷贝，直接返回同一个引用                                                                                                                                                   | 已经明确知道部分状态不可克隆、接受引用共享，或只是想要最低开销的"快照"                             |
| `ClonePolicy.diagnostic`（`diagnosticClone(value)`）       | `value: T` | 同步      | 优先 `structuredClone`；失败时退回递归拷贝：可以拷贝的部分（plain object/array）逐层深拷贝，**只有真正不可克隆的那个子树**按引用保留，不会因为树里一处不可克隆就放弃整棵树的独立性 | 中间件、DevTools 这类诊断场景——可用性优先于严格性，一个不常见的字段值不应该让整条诊断链路崩溃      |

`bindStoreMiddleware()` 默认用的是 `state => ClonePolicy.diagnostic(state)`：尽力深拷贝，遇到不可结构化克隆的值（类实例、外部句柄等）时按引用保留那个子树，不抛错。需要严格独立快照时显式传 `options.clone: ClonePolicy.immutable`（做不到就抛错）；接受引用共享、换取零开销时传 `ClonePolicy.opaque`。

`diagnosticClone` 的 fallback 递归复制 plain object/array；可复制 Date/RegExp/Map/Set/ArrayBuffer/TypedArray 子树单独 structuredClone；函数、不支持类或宿主子树可保留原引用。枚举访问器按 canonical utils 行为读取并记录，__proto__ 用 defineProperty 写入，循环/共享结构由 canonical traversal 处理；不承诺全树隔离。

---

## 9. Pipeline 模式与错误边界

本包创建的错误带 `source: '@migaia/store-middleware'` 与稳定 `code`；Reactive、pipeline 及其它已编码错误保留实际 owner。独立动作与 binding disposer 的未编码失败附 CALLBACK_FAILED；不可附码的原值经 cause/errors 保留。`actions-only` 越界写入为
`ACTION_SCOPE_REQUIRED`；不可克隆值为 `CLONE_UNSUPPORTED`；遗漏 `next()` 只经 Runtime 报告
`MIDDLEWARE_NOT_CHAINED`，不反向中断业务写入；`bindStoreMiddleware()` 绑定失败且回滚清理也失败时为 `CLEANUP_FAILED`。

Host 的 pipeline 模式**固定是 `sync`**（见 [§4](#4-istoremiddlewarehost-api-参考)），这决定了：

- 中间件只能用 `core.usePipeline((event, next) => void)`，`next(event)` 必须在 stage 函数返回前调用。
- sync 是"扁平转换管道"：`next()` 只是记录下一个值，下游 stage 在当前 stage 返回**之后**才执行，当前 stage 调用 `next()` 之后无法同步观察到下游已经处理完的结果（想要"后置逻辑能看到下游效果"的洋葱模型语义，需要 async pipeline——但本包的 Host 不支持切换）。
- 公开 emit 直接执行同步 pipeline，可向调用方传播错误；recordState/recordError 与 runAction 的观察事件使用隔离派发并向 Runtime 报告。runAction 业务函数失败继续抛出，保留其实际错误 owner。
- 如果一个 pipeline stage 忘了调用 `next()`，`emit()` 会检测到 `completed` 标记未被置位，同样以 `phase: 'trace-listener'` 上报一条 `[store] middleware did not call next()` 错误。

更细的 pipeline 执行顺序、错误码、`onDispose` 清理协议等通用机制，见 `@migaia/plugin-host` 的 USEGUIDE。

---

## 10. 生命周期与资源释放

- `host.use(plugin)` / `host.unUse(name)` / `host.dispose()` 都是异步 API，语义完全继承自 `@migaia/plugin-host`——安装失败自动回滚，卸载资源自动逆序清理。
- Host 通过 `defineHost` 的 `dispose` 钩子：先按后进先出顺序执行 `attachBindingDisposer()` 登记的 disposer（`bindStoreMiddleware()` 用它登记状态订阅和 trace 订阅的取消函数），再委托 plugin-host 卸载所有已安装插件。结果是结构化的 `{ logicalTerminal, cleanupComplete, cleanupErrors }`，绑定 disposer 的错误排在 `cleanupErrors` 前面，不以异常抛出。
- `host.dispose()` **不会**销毁 Store 或 Runtime，只释放这个 middleware Host 自己拥有的资源（订阅、已安装插件）。
- 同一个 Host 内插件名称必须唯一；重复安装同名插件会按 `@migaia/plugin-host` 的规则报错。
- middleware 诊断层的失败不应该、也不会阻断业务写入；真正的业务异常仍按原始异常传播（见 [§9](#9-pipeline-模式与错误边界)）。

---

## 11. 与相关包的关系

| 包                                 | 负责什么                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@migaia/store-light`              | Store 状态、字段、快照（`$plain`）和 hydration（`$hydrate`）；`actions-only` 策略真正拦截写入的地方 |
| `@migaia/store-middleware`（本包） | Store action/state/error 事件、写入策略实例、领域中间件插件、DevTools adapter                       |
| `@migaia/plugin-host`              | 通用插件生命周期、pipeline、配置和资源释放机制，本包在此之上构建                                    |
| `@migaia/reactive`                 | Runtime——action trace 的来源（`$runtime.subscribeTrace`）、错误上报出口（`reportError`）            |
| `@migaia/store-devtools`           | 依赖图、历史快照和时间旅行诊断（更完整的 DevTools 能力，本包只提供事件转发的 adapter 协议）         |
| `@migaia/store-persist`            | 状态持久化和恢复                                                                                    |

---

## 12. 常见问题排查

**Q：设了 `mutationPolicy: createMutationPolicy('actions-only')`，但 action 外直接改字段没有报错。**
先确认 Store 构造时传入了 actions-only 策略；这决定直接写保护。绑定侧传另一实例不会取消它，但 host.runAction 不能替 Store 策略授权。共享实例用于统一宿主与 Store 的 action 边界。

**Q：装了一个用 `useAsyncPipeline` 注册 stage 的插件，报 `PIPELINE_MODE_MISMATCH`。**
Host 的 pipeline 模式固定是 `sync`，创建时传的 `pipeline.mode` 会被强制覆盖，见 [§4](#4-istoremiddlewarehost-api-参考)。中间件只能用 `core.usePipeline`。

**Q：`connectDevTools()` 报错 `[store] DevTools state command requires applyState`。**
创建 Host 时没有传 `applyState`；如果是自己调用 `createStoreMiddlewareHost(...)` 而不是用 `bindStoreMiddleware()`，需要手动提供 `applyState` 才能支持 DevTools 的 `jump`/`reset`。

**Q：`state` 事件里的 `previous`/`next` 拿到的是同一个对象，改了一个另一个也变了。**
检查是否自定义了 `options.clone` 且传的是 `ClonePolicy.opaque`（有意不拷贝，返回同一引用）——如果需要独立快照，用显式传 `ClonePolicy.immutable`；默认 diagnostic 仍可共享不支持子树。

**Q：`getState()` 在状态树很大、事件很密集时明显拖慢速度。**
默认 `clone` 是 `ClonePolicy.diagnostic`，每次调用都做一次尽力深拷贝。默认策略不提供绝对独立保证；若明确接受完全共享，可换成 `ClonePolicy.opaque`（零拷贝，接受引用共享）或只在真正需要独立快照的少数中间件里手动拷贝。

**Q：同一个 action 在中间件里被记录了两次。**
检查是否在 `bindStoreMiddleware()` 已经转发了 Store 自身 action trace 的情况下，又手动用 `host.runAction()` 包了一遍同一个 Store 方法——两条路径都会各自派发一次 `action` 事件，见 [§5](#5-bindstoremiddleware-完整行为)。

**Q：`host.dispose()` 的清理错误在哪里？**
`dispose()` 不抛清理错误，而是返回 `{ logicalTerminal, cleanupComplete, cleanupErrors }`；`cleanupErrors` 里先是绑定 disposer（状态订阅、trace 订阅）的原始错误，再是插件卸载的错误，见 [§10](#10-生命周期与资源释放)。`CLEANUP_FAILED` 的 `AggregateError` 只出现在 `bindStoreMiddleware()` 绑定失败且回滚清理也失败时。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

### 错误构造入口

```ts
function createStoreMiddlewareError(code: IStoreMiddlewareErrorCode, message: string, options?: { readonly cause?: unknown }): Error;
function createStoreMiddlewareAggregateError(code: IStoreMiddlewareErrorCode, errors: readonly unknown[], message: string): AggregateError;
```

它们只返回原生错误，不自动抛出；保留 stack。显式 cause（包括 undefined）由 Error 保存，AggregateError.errors 保留输入错误对象。STORE_MIDDLEWARE_SOURCE 只用于本包创建的错误，外包编码错误保持实际 owner。CALLBACK_FAILED 用于未编码的同步动作/disposer 失败；DEVTOOLS_MESSAGE_INVALID 用于报告支持 Redux 命令里的非法 JSON。immutable 失败的 cause 是完整 Utils 错误，原生复制失败在其下游 cause 上。

immutable 的严格数据契约：接纳普通/null 原型记录、普通数组、当前 realm 的原生 Map/Set/Date/RegExp/ArrayBuffer、非共享 ArrayBuffer 支持的标准 TypedArray/DataView。自定义 class（包括内建子类）、访问器与其它未接纳的原生对象以 CLONE_UNSUPPORTED 拒绝；访问器在求值前拒绝，不额外执行 getter。Map key/value、Set 成员及记录/数组数据递归接纳，循环与共享引用仍由唯一的 utils structuredClone 保持。此收窄修正旧版 class 静默丢方法的问题；旧版 getter、跨 realm 内建值及未列类型需迁移为支持的数据，或显式选择 diagnostic/opaque。Utils.immutableSnapshot 原生投影契约不变。本策略不另实现 clone 引擎。

API convergence：克隆五名只从既有 `/tolerant-clone` 导入；deprecated tolerantClone 两入口均删除。IMutationGuard/IMutationPolicy 从 `@migaia/store-light` 直接导入。旧 middlewarePlugin/IStoreMiddleware/IMiddlewareContext 删除，迁移为 IStoreMiddlewarePlugin 与 core.usePipeline；没有 shim/alias。外部旧导入需破坏版本迁移，仓库唯一生产 clone consumer 已使用窄入口。

`StoreMiddlewareErrorCode` 当前9个稳定成员：`invalidOption` (`INVALID_OPTION`)、`middlewareNotChained` (`MIDDLEWARE_NOT_CHAINED`)、`actionScopeRequired` (`ACTION_SCOPE_REQUIRED`)、`cloneUnsupported` (`CLONE_UNSUPPORTED`)、`callbackFailed` (`CALLBACK_FAILED`)、`devtoolsMessageInvalid` (`DEVTOOLS_MESSAGE_INVALID`)、`devtoolsCapability` (`DEVTOOLS_CAPABILITY`)、`envUnsupported` (`ENV_UNSUPPORTED`)、`cleanupFailed` (`CLEANUP_FAILED`)。对应值的联合为 `IStoreMiddlewareErrorCode`；两新增场景见上述边界说明。

### Redux 扩展命令词表

根入口导出 `ReduxDevToolsCommand` 与值联合 `IReduxDevToolsCommand`。`createReduxDevToolsAdapter` 使用 dispatch/commit/jumpToState/jumpToAction/rollback/reset 六个键，其值分别为 DISPATCH/COMMIT/JUMP_TO_STATE/JUMP_TO_ACTION/ROLLBACK/RESET。原 `@migaia/store-devtools` 的 `StoreDevtoolsCommand` / `IStoreDevtoolsCommand` 导入迁移到这里，协议字符串不变；middleware 领域命令继续使用 `MiddlewareCommandType`。
