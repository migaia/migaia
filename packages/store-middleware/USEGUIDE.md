# 使用手册

本文是 `@migaia/store-middleware` 的完整参考。先看 [README.md](./README.md#5-快速开始) 的快速开始示例，跑起来之后再回来查这里的细节——README 讲"是什么、适合什么场景、怎么五分钟跑起来"，本文讲每一个 API 的精确签名、每一种边界行为，以及和 `@migaia/store-light`、`@migaia/plugin-host` 之间容易踩坑的联动关系。

## 目录

1. [定位与依赖关系](#1-定位与依赖关系)
2. [事件模型](#2-事件模型)
3. [MutationPolicy 写入策略](#3-mutationpolicy-写入策略)
4. [StoreMiddlewareHost API 参考](#4-storemiddlewarehost-api-参考)
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

`@migaia/store-middleware` 依赖 `@migaia/store-light`（Store 本体）、`@migaia/reactive`（Runtime）和 `@migaia/plugin-host`（通用插件宿主机制）。它自己不实现插件安装/卸载/资源清理这些通用能力，全部通过继承 `PluginHost` 复用；这一层只负责"Store 领域该有哪些事件、哪些写入策略"。

```ts
import { StoreMiddlewareHost } from '@migaia/store-middleware';
// StoreMiddlewareHost<S> extends PluginHost<IStoreMiddlewareCore<S>, IMiddlewareEvent<S>>
```

不熟悉 `PluginHost` 的插件安装、卸载、pipeline、错误码等通用机制，先读 `@migaia/plugin-host` 的 USEGUIDE——本文只讲 Store 领域特有的部分，通用机制不重复。

---

## 2. 事件模型

所有事件共享 `IMiddlewareEvent<S>` 这个联合类型，三种形状：

```ts
type IMiddlewareActionEvent =
  | { type: 'action'; phase: 'start'; name: string; timestamp: number; metadata?: Readonly<Record<string, unknown>> }
  | { type: 'action'; phase: 'end'; name: string; timestamp: number; durationMs: number; metadata?: Readonly<Record<string, unknown>> }
  | { type: 'action'; phase: 'error'; name: string; timestamp: number; durationMs: number; error: unknown; metadata?: Readonly<Record<string, unknown>> };

type IMiddlewareStateEvent<S> = {
  type: 'state'; name: string; timestamp: number; previous: S; next: S;
  metadata?: Readonly<Record<string, unknown>>;
};

type IMiddlewareErrorEvent = {
  type: 'error'; phase: string; timestamp: number; error: unknown;
  metadata?: Readonly<Record<string, unknown>>;
};
```

| 事件 | 何时产生 | 关键字段 |
| --- | --- | --- |
| `action` / `start` | 一个 action 开始执行 | `name` |
| `action` / `end` | action 成功完成 | `durationMs` |
| `action` / `error` | action 抛出异常 | `durationMs`、`error`（原始异常） |
| `state` | 状态发生变化 | `previous`/`next`（同类型 `S` 的两个快照） |
| `error` | 诊断层面的错误上报（不是业务 action 失败） | `phase`（自由字符串，标识来源） |

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
const host = bindStoreMiddleware(store, { mutationPolicy }); // ② Host 拿到的是同一个实例
```

- ① 是真正生效的一半：Store 的 `$batch()`/`$set()`/action 方法调用会经过 `mutationPolicy.runInAction(() => runtime.batch(fn))`，直接字段赋值（比如 `store.count = 1`）会先过 `assertMutationAllowed('set(count)')`。
- ② 只是把同一个实例挂到 `host.mutationPolicy` 上，供你在别处读取 `host.mutationPolicy.insideAction`，或者用 `host.runAction()` 包裹**不是** Store 方法、但你也想纳入同一套 action 边界判断的代码。
- 如果 ①②两处各自调用 `createMutationPolicy()` 生成两个独立实例，`actions-only` 完全不会生效——Store 内部判断走的是它自己那个实例的 `actionDepth`，和 `bindStoreMiddleware` 传入的实例毫无关系。这是本包最容易踩的坑，**没有共享同一个实例，`actions-only` 就是摆设**。
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

## 4. StoreMiddlewareHost API 参考

```ts
class StoreMiddlewareHost<S> extends PluginHost<IStoreMiddlewareCore<S>, IMiddlewareEvent<S>> {
  readonly mutationPolicy: MutationPolicy;
  constructor(options: IStoreMiddlewareHostOptions<S>);
  emit(event: IMiddlewareEvent<S>): void;
  runAction<T>(name: string, fn: () => T, metadata?: Readonly<Record<string, unknown>>): T;
  recordState(name: string, previous: S, next: S, metadata?: Readonly<Record<string, unknown>>): void;
  recordError(phase: string, error: unknown, metadata?: Readonly<Record<string, unknown>>): void;
  connectDevTools(adapter: IDevToolsAdapter<S>, name?: string): Promise<void>; // name 默认 'store-devtools'
  attachBindingDisposer(disposer: IDisposer): void;
  override dispose(): Promise<void>;
}

type IStoreMiddlewareHostOptions<S> = IPluginHostOptions & {
  runtime: IRuntime;
  getState: () => S;
  applyState?: (state: S) => void;
  mutationPolicy?: MutationPolicy; // 缺省时内部新建一个 mode: 'off' 的实例
};
```

构造函数会**强制把 pipeline 模式覆盖成 `'sync'`**——即便 `options.pipeline.mode` 传了别的值也会被覆盖。原因：Store 领域事件要求同步、可预测的处理顺序，中间件不应该让一次状态变化的观察产生跨微任务的乱序。这意味着所有中间件插件只能用 `core.usePipeline`，调用 `core.useAsyncPipeline`/`core.useGeneratorPipeline` 会触发 `@migaia/plugin-host` 的 `PIPELINE_MODE_MISMATCH` 错误。

| 方法 | 参数类型 | 同步/异步 | 行为 | 抛错语义 |
| --- | --- | --- | --- | --- |
| `emit(event)` | `event: IMiddlewareEvent<S>` | 同步 | 同步跑一遍 pipeline；若某个 stage 忘了调用 `next()`，会以 `phase: 'trace-listener'` 上报到 `runtime.reportError()`，但 `emit()` 本身不抛错 | 不抛错，异常通过 `runtime.reportError` 上报 |
| `runAction(name, fn, metadata?)` | `name: string`；`fn: () => T`；`metadata?: Readonly<Record<string, unknown>>` | 同步 | 派发 `action:start` → 用 `mutationPolicy.runInAction(() => runtime.batch(fn))` 执行 `fn` → 成功派发 `action:end`（带 `durationMs`），失败派发 `action:error` 后**重新抛出原始异常** | `fn` 抛出的异常会正常向调用方传播 |
| `recordState(name, previous, next, metadata?)` | `name: string`；`previous: S`；`next: S`；`metadata?: Readonly<Record<string, unknown>>` | 同步 | 派发一个 `state` 事件 | 中间件抛错被隔离，不会传给调用方 |
| `recordError(phase, error, metadata?)` | `phase: string`；`error: unknown`；`metadata?: Readonly<Record<string, unknown>>` | 同步 | 派发一个 `error` 事件；如果在处理上一个 `error` 事件期间**又**调用了 `recordError`（重入），直接把新错误转发给 `runtime.reportError({ phase: 'trace-listener' })`，不会再触发一轮 pipeline，避免错误处理本身死循环 | 不抛错 |
| `connectDevTools(adapter, name?)` | `adapter: IDevToolsAdapter<S>`；`name?: string` | 异步 | 见 [§7](#7-devtools-集成) | 安装失败按 `PluginHost.use()` 的规则处理 |
| `attachBindingDisposer(disposer)` | `disposer: IDisposer` | 同步 | 登记一个额外的清理函数，`dispose()` 时按后进先出顺序执行，先于插件卸载 | — |

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
  mutationPolicy?: MutationPolicy;
  actionPrefix?: string;
  clone?: (state: Record<string, unknown>) => Record<string, unknown>; // 默认 structuredClone
};

type IStoreMiddlewareBinding<S extends Record<string, unknown>> =
  StoreMiddlewareHost<Record<string, unknown>> & { readonly store: IReactiveStore<S> };

function bindStoreMiddleware<S extends Record<string, unknown>>(
  store: IReactiveStore<S>,
  options?: IStoreMiddlewareBindingOptions
): IStoreMiddlewareBinding<S>;
```

这是接入一个已有 `@migaia/store-light` Store 的推荐入口，内部做了三件事：

1. **创建 Host**：`getState` 每次调用都返回 `clone(store.$plain())`——默认用 `structuredClone`，因此每次读取都是一份新的独立快照，中间件互相之间、以及和 Store 本身都不会共享引用。`applyState` 桥接到 `store.$hydrate(state)`。
2. **订阅状态变化**：`store.$subscribe(() => { ... })`——每次 Store 通知，取一份新的 `clone($plain())` 作为 `next`，连同上一次记录的 `previous` 一起 `host.recordState('store:update', previous, next)`，事件名固定是 `'store:update'`，然后把 `previous` 更新为这次的 `next`。
   - `previous` 的初值是**绑定那一刻**的 `clone(store.$plain())`——如果 Store 在 `bindStoreMiddleware()` 调用之前已经有过状态变化，这些历史变化不会被回溯出事件，第一条 `state` 事件的 `previous` 反映的是"绑定时刻"的状态，不是"Store 创建时刻"的状态。
3. **订阅 Runtime action trace**：`store.$runtime.subscribeTrace((event) => { ... })`——只转发 `event.type === 'action'` 的 trace，且如果传了 `actionPrefix`，只转发 `event.name` 以该前缀开头的 action；转发时直接调用 `host.emit(...)` 构造对应的 `action:start`/`action:end`/`action:error` 事件（**不经过** `host.runAction()`，不会重复触发 `mutationPolicy.runInAction`）。

`clone` 快照只包含 `$plain()` 暴露的字段——computed（派生）、方法、WASM 支撑字段和其他外部资源不在其中，这些字段的变化不会出现在 `state` 事件的 `previous`/`next` 里。

`host.dispose()` 时，`attachBindingDisposer` 登记的两个 disposer（状态订阅、trace 订阅）会先于插件卸载被清理；`bindStoreMiddleware()` 本身**不持有 Store 或 Runtime 的所有权**，`dispose()` 之后 Store 仍然正常工作，只是不再有中间件观察它。

返回值是 `StoreMiddlewareHost` 实例本身，额外挂了一个只读的 `store` 属性指回传入的 Store，方便拿到 Host 后还能访问原始 Store。

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

如果只是想写一个更简单的 `(event, context, next) => void` 函数（旧式 `IStoreMiddleware<S>` 形状），用 `middlewarePlugin()` 适配成插件：

```ts
import { middlewarePlugin } from '@migaia/store-middleware';

const audit = middlewarePlugin<AppState>('audit', (event, context, next) => {
  next();
  auditSink({ event, state: context.getState() });
});

await host.use(audit);
```

`context` 只有 `{ runtime, getState }` 两个字段，没有 `config`/`getShared`/`onDispose`——需要这些通用插件能力时应该直接写 `IStoreMiddlewarePlugin`，而不是这个简化的函数形状。`middleware()` 函数体里如果不调用 `next()`，这个事件不会继续往后面的插件传递（但不影响已经发生的 Store 写入）。

内置的 `loggerMiddleware(sink?)`：

```ts
function loggerMiddleware<S>(
  sink?: (event: IMiddlewareEvent<unknown>, state: unknown) => void
): IStoreMiddlewarePlugin<S>;
```

默认 `sink` 是 `console.log('[store]', event, state)`；插件名固定 `'store-logger'`；每个事件先放行给下游插件（`next(event)`），再调用 `sink(event, core.getState())`——`state` 是调用 `sink` 那一刻的最新快照，不是事件产生时的快照。

**一个插件 stage 最多调用一次 `next(event)`。** 不调用 `next()` 只会阻止事件继续传给后面的插件，不会撤销已经发生的 Store 写入——重复或延迟调用会被 `@migaia/plugin-host` 报告为 pipeline 违规（见其 USEGUIDE 的 `PIPELINE_NEXT_DUPLICATE`/`PIPELINE_NEXT_LATE`）。插件需要监听外部资源时，在 `install(core)` 内调用 `core.onDispose(disposer)`；卸载时 Host 自动清理。

---

## 7. DevTools 集成

```ts
type IDevToolsCommand<S> =
  | { type: 'jump'; state: S }
  | { type: 'reset'; state: S }
  | { type: 'commit' };

type IDevToolsAdapter<S> = {
  init(state: S): void;
  send(event: IMiddlewareEvent<S>, state: S): void;
  subscribe?(listener: (command: IDevToolsCommand<S>) => void): IDisposer;
};

function createReduxDevToolsAdapter<S>(connection: IReduxDevToolsConnection<S>): IDevToolsAdapter<S>;
```

`createReduxDevToolsAdapter()` 把一个符合 Redux DevTools 扩展协议的 `connection`（`init`/`send`/`subscribe`）转换成本包的 `IDevToolsAdapter`：

- `send` 会把事件包装成 `{ type: '<name>:<phase>' 或 '<name>' 或 'error:<phase>', event }` 发给 `connection.send()`。
- `subscribe` 只识别 `message.type === 'DISPATCH'` 的消息；`payload.type` 为 `COMMIT` 时产生 `{ type: 'commit' }`；为 `JUMP_TO_STATE`/`JUMP_TO_ACTION`/`ROLLBACK`/`RESET` 且 `message.state` 存在时，尝试 `JSON.parse(message.state)`，解析失败静默忽略这条消息；`RESET` 映射成 `{ type: 'reset' }`，其余映射成 `{ type: 'jump' }`。

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
function opaqueReferenceClone<T>(value: T): T;   // 完全不拷贝，原样返回引用
function diagnosticClone<T>(value: T): T;        // 尽力而为，永不抛错

const ClonePolicy: {
  immutable: typeof immutableSnapshotClone;
  opaque: typeof opaqueReferenceClone;
  diagnostic: typeof diagnosticClone;
};

/** @deprecated 用 ClonePolicy.diagnostic（或 diagnosticClone），行为相同，名字更明确 */
const tolerantClone: typeof diagnosticClone;
```

| 方法/签名 | 参数类型 | 同步/异步 | 行为 | 适合谁 |
| --- | --- | --- | --- | --- |
| `ClonePolicy.immutable`（`immutableSnapshotClone(value)`） | `value: T` | 同步 | 优先用 `structuredClone`；当前环境没有 `structuredClone`，或值里含有函数/DOM 句柄/类实例等不可克隆内容时，**抛错**而不是悄悄返回一份共享引用 | 需要"这一定是独立快照"这个保证的调用方——比如把 `previous` 当作历史记录长期持有，不能被后续写入污染 |
| `ClonePolicy.opaque`（`opaqueReferenceClone(value)`） | `value: T` | 同步 | 不做任何拷贝，直接返回同一个引用 | 已经明确知道部分状态不可克隆、接受引用共享，或只是想要最低开销的"快照" |
| `ClonePolicy.diagnostic`（`diagnosticClone(value)`） | `value: T` | 同步 | 优先 `structuredClone`；失败时退回递归拷贝：可以拷贝的部分（plain object/array）逐层深拷贝，**只有真正不可克隆的那个子树**按引用保留，不会因为树里一处不可克隆就放弃整棵树的独立性 | 中间件、DevTools 这类诊断场景——可用性优先于严格性，一个不常见的字段值不应该让整条诊断链路崩溃 |

`bindStoreMiddleware()` 默认用的是 `state => structuredClone(state)`，语义上等同于手写了一份不带错误兜底的 `immutable`。如果 Store 状态里可能出现不可结构化克隆的值（比如存了一个类实例、`Map`、外部句柄），默认 `clone` 会直接抛错；这种情况下应该显式传 `options.clone: ClonePolicy.diagnostic`（保留诊断可用性）或 `ClonePolicy.opaque`（接受引用共享、换取零开销）。

`diagnosticClone` 的递归兜底细节：数组逐项递归；非 `Object.prototype` 原型的值（`Map`/`Set`/`Date`/`RegExp`/类实例/Proxy/宿主对象）直接按引用返回，不会伪造一个丢失原型和方法的普通对象；plain object 只拷贝可枚举属性，accessor 属性会读取其当前值合入拷贝（和 `structuredClone` 的行为保持一致），并对 `__proto__` 键做了显式处理避免原型链污染；用 `WeakMap` 记录已访问对象处理循环引用。

---

## 9. Pipeline 模式与错误边界

包边界错误带 `source: '@migaia/store-middleware'` 与稳定 `code`。`actions-only` 越界写入为
`ACTION_SCOPE_REQUIRED`；不可克隆值为 `CLONE_UNSUPPORTED`；遗漏 `next()` 只经 Runtime 报告
`MIDDLEWARE_NOT_CHAINED`，不反向中断业务写入；多项清理失败为 `CLEANUP_FAILED`。

`StoreMiddlewareHost` 的 pipeline 模式**固定是 `sync`**（见 [§4](#4-storemiddlewarehost-api-参考)），这决定了：

- 中间件只能用 `core.usePipeline((event, next) => void)`，`next(event)` 必须在 stage 函数返回前调用。
- sync 是"扁平转换管道"：`next()` 只是记录下一个值，下游 stage 在当前 stage 返回**之后**才执行，当前 stage 调用 `next()` 之后无法同步观察到下游已经处理完的结果（想要"后置逻辑能看到下游效果"的洋葱模型语义，需要 async pipeline——但本包的 Host 不支持切换）。
- `emit()`/`runAction()`/`recordState()`/`recordError()` 内部统一走 `#emitIsolated()`：中间件 stage 抛出的异常会被捕获，通过 `runtime.reportError(error, { phase: 'trace-listener' })` 上报，**不会**从 `recordState()`/`recordError()` 等调用点抛出；唯一的例外是 `runAction()` 包裹的业务函数本身抛错——那是业务异常，会原样重新抛出给调用方。
- 如果一个 pipeline stage 忘了调用 `next()`，`emit()` 会检测到 `completed` 标记未被置位，同样以 `phase: 'trace-listener'` 上报一条 `[store] middleware did not call next()` 错误。

更细的 pipeline 执行顺序、错误码、`onDispose` 清理协议等通用机制，见 `@migaia/plugin-host` 的 USEGUIDE。

---

## 10. 生命周期与资源释放

- `host.use(plugin)` / `host.unUse(name)` / `host.dispose()` 都是异步 API，语义完全继承自 `@migaia/plugin-host`——安装失败自动回滚，卸载资源自动逆序清理。
- `StoreMiddlewareHost` 重写了 `dispose()`：先按后进先出顺序执行 `attachBindingDisposer()` 登记的 disposer（`bindStoreMiddleware()` 用它登记状态订阅和 trace 订阅的取消函数），再调用 `super.dispose()` 卸载所有已安装插件。
- `host.dispose()` **不会**销毁 Store 或 Runtime，只释放这个 middleware Host 自己拥有的资源（订阅、已安装插件）。
- 同一个 Host 内插件名称必须唯一；重复安装同名插件会按 `@migaia/plugin-host` 的规则报错。
- middleware 诊断层的失败不应该、也不会阻断业务写入；真正的业务异常仍按原始异常传播（见 [§9](#9-pipeline-模式与错误边界)）。

---

## 11. 与相关包的关系

| 包 | 负责什么 |
| --- | --- |
| `@migaia/store-light` | Store 状态、字段、快照（`$plain`）和 hydration（`$hydrate`）；`actions-only` 策略真正拦截写入的地方 |
| `@migaia/store-middleware`（本包） | Store action/state/error 事件、写入策略实例、领域中间件插件、DevTools adapter |
| `@migaia/plugin-host` | 通用插件生命周期、pipeline、配置和资源释放机制，本包在此之上构建 |
| `@migaia/reactive` | Runtime——action trace 的来源（`$runtime.subscribeTrace`）、错误上报出口（`reportError`） |
| `@migaia/store-devtools` | 依赖图、历史快照和时间旅行诊断（更完整的 DevTools 能力，本包只提供事件转发的 adapter 协议） |
| `@migaia/store-persist` | 状态持久化和恢复 |

---

## 12. 常见问题排查

**Q：设了 `mutationPolicy: createMutationPolicy('actions-only')`，但 action 外直接改字段没有报错。**
检查是否把**同一个** `MutationPolicy` 实例同时传给了 `createStore({ mutationPolicy })` 和 `bindStoreMiddleware(store, { mutationPolicy })`。只传给其中一个不会生效——真正拦截写入的是 `createStore` 那一侧，见 [§3](#3-mutationpolicy-写入策略)。

**Q：装了一个用 `useAsyncPipeline` 注册 stage 的插件，报 `PIPELINE_MODE_MISMATCH`。**
`StoreMiddlewareHost` 的 pipeline 模式固定是 `sync`，构造时传的 `pipeline.mode` 会被强制覆盖，见 [§4](#4-storemiddlewarehost-api-参考)。中间件只能用 `core.usePipeline`。

**Q：`connectDevTools()` 报错 `[store] DevTools state command requires applyState`。**
构造 `StoreMiddlewareHost` 时没有传 `applyState`；如果是自己 `new StoreMiddlewareHost(...)` 而不是用 `bindStoreMiddleware()`，需要手动提供 `applyState` 才能支持 DevTools 的 `jump`/`reset`。

**Q：`state` 事件里的 `previous`/`next` 拿到的是同一个对象，改了一个另一个也变了。**
检查是否自定义了 `options.clone` 且传的是 `ClonePolicy.opaque`（有意不拷贝，返回同一引用）——如果需要独立快照，用默认的 `structuredClone` 或显式传 `ClonePolicy.immutable`/`ClonePolicy.diagnostic`。

**Q：`getState()` 在状态树很大、事件很密集时明显拖慢速度。**
默认 `clone` 是 `structuredClone`，每次调用都做一次完整深拷贝。如果不需要"绝对独立"这个保证，换成 `ClonePolicy.opaque`（零拷贝，接受引用共享）或只在真正需要独立快照的少数中间件里手动拷贝。

**Q：同一个 action 在中间件里被记录了两次。**
检查是否在 `bindStoreMiddleware()` 已经转发了 Store 自身 action trace 的情况下，又手动用 `host.runAction()` 包了一遍同一个 Store 方法——两条路径都会各自派发一次 `action` 事件，见 [§5](#5-bindstoremiddleware-完整行为)。

## 构建、测试与排查

仓库根目录：`pnpm --filter @migaia/store-middleware fmt` → `lint` → `typecheck` → `typecheck:test` → `test` → `build`。`cleanup` 问题检查 `AggregateError.errors`；事件重复检查是否同时使用 trace binding 与 `runAction()`。
