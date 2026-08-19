# `@migaia/store-middleware`

给 `@migaia/store-light` 的 Store 装上"观察和约束"能力的中间件层：`action`/`state`/`error` 三类领域事件、`actions-only` 写入策略、Redux DevTools 适配器，以及三种显式的"复制状态"策略（`ClonePolicy`）。它不重新发明插件系统，而是继承 `@migaia/plugin-host` 的 `PluginHost`——中间件就是安装在这个 Host 上的插件。

## 适用与不适用场景

**适用**：需要知道"哪个 action 改了状态、耗时多久、有没有报错"；需要禁止组件绕过 action 直接改字段（MobX 风格 strict mode）；需要接 Redux DevTools 或自定义调试面板；需要日志/审计/指标等可以动态装卸的横切能力。

**不适用**：不要把它当作 Store 本体——存字段、通知订阅者是 `@migaia/store-light` 的职责；不提供状态持久化或时间旅行历史面板本体，见 `@migaia/store-persist`/`@migaia/store-devtools`；只是想给单个 Store 加一个简单的 `console.log`，直接 `store.$subscribe()` 打日志更简单，不需要理解插件系统。

## 安装

```bash
pnpm add @migaia/store-middleware
```

## 目录

- [根导出 `@migaia/store-middleware`](#根导出)
- [`/tolerant-clone` 子路径](#tolerant-clone-模块)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="根导出"></a>

## 根导出 `@migaia/store-middleware`

```ts
import {
  createMutationPolicy,
  MutationPolicy,
  MiddlewareEventType,
  MiddlewareEventPhase,
  MiddlewareCommandType,
  createReduxDevToolsAdapter,
  createStoreMiddlewareHost,
  StoreMiddlewareHost,
  middlewarePlugin,
  loggerMiddleware,
  bindStoreMiddleware,
  ClonePolicy,
  immutableSnapshotClone,
  opaqueReferenceClone,
  diagnosticClone,
  tolerantClone,
  StoreMiddlewareErrorCode,
  STORE_MIDDLEWARE_SOURCE,
  createStoreMiddlewareError,
  createStoreMiddlewareAggregateError
} from '@migaia/store-middleware';
```

**`createMutationPolicy`｜5 秒上手** —— 创建"这次写入允不允许发生"的判断器：

```ts
const mutationPolicy = createMutationPolicy('actions-only');
```

单参数 `mode?: 'off' | 'actions-only'`（默认 `'off'`）——`'off'` 时永远放行；`'actions-only'` 时只有处于 `runInAction()` 内部才放行，深度为 0 时 `assertMutationAllowed()` 抛出携带 `code: 'ACTION_SCOPE_REQUIRED'` 的 `Error`。**必须和传给 `createStore({ mutationPolicy })` 的是同一个实例**，各自 `createMutationPolicy()` 出两个实例互不知道对方，策略形同虚设。

**`MutationPolicy`｜10 秒上手** —— `createMutationPolicy()` 背后的类，也可以直接 `new`：

```ts
const policy = new MutationPolicy('actions-only'); // 构造参数同 createMutationPolicy
policy.runInAction(() => {
  policy.assertMutationAllowed('settings.theme'); // 处于 action 内，不抛错
});
```

构造参数：`mode?: IMutationPolicyMode`（默认 `'off'`）。实例方法：

- `get insideAction(): boolean` —— 只读，反映当前是否处于至少一层 `runInAction()` 内
- `assertMutationAllowed(operation?: string)` —— `operation` 默认 `'mutation'`，仅用于错误消息；`'actions-only'` 模式下写入越界时抛错，`'off'` 模式下永不抛错
- `runInAction<T>(fn: () => T): T` —— 支持嵌套（内部用计数器而非布尔值）

**`MiddlewareEventType` / `MiddlewareEventPhase` / `MiddlewareCommandType`｜3 秒上手** —— 事件常量表，无调用参数：

```ts
MiddlewareEventType.action; // 'action' | 'state' | 'error' 之一
MiddlewareEventPhase.start; // 'start' | 'end' | 'error'
MiddlewareCommandType.commit; // 'commit' | 'jump' | 'reset'
```

**`createReduxDevToolsAdapter`｜10 秒上手** —— 把 Redux DevTools 扩展连接对象转换成本包的 `IDevToolsAdapter`：

```ts
const adapter = createReduxDevToolsAdapter(connection); // connection: { init, send, subscribe }
```

单参数 `connection: IReduxDevToolsConnection<S>`（必填，提供 `init`/`send`/`subscribe` 三个方法），无其他选项；返回值直接喂给 `host.connectDevTools()`。

**`createStoreMiddlewareHost`｜10 秒上手** —— 直接构造一个 Host（不绑定任何 Store）：

```ts
const host = createStoreMiddlewareHost({
  runtime,
  getState: () => currentState
});
```

全部选项（`IStoreMiddlewareHostOptions<S>`，继承 `IPluginHostOptions`）：

- `runtime: IRuntime`（必填）—— 来自 `@migaia/reactive`，用于 `reportError`/`batch`
- `getState: () => S`（必填）
- `applyState?: (state: S) => void` —— 未提供时，DevTools 的 `jump`/`reset` 命令会抛出 `code: 'DEVTOOLS_CAPABILITY'`
- `mutationPolicy?: MutationPolicy` —— 缺省时内部新建一个 `mode: 'off'` 的实例
- `pipeline?: { mode?: IPipelineMode }` —— **会被构造函数强制覆盖成 `PluginHostPipelineMode.sync`**，传别的值不生效
- `diagnostic?` / `scheduler?` / `queueAdmissionTimeoutMs?` / `queueAdmissionDiagnosticMs?` / `disposeStepTimeoutMs?` —— 透传给 `@migaia/plugin-host` 的 `PluginHost`，语义见其 USEGUIDE

**`StoreMiddlewareHost`｜10 秒上手** —— `createStoreMiddlewareHost()` 背后的类，`extends PluginHost`：

```ts
const host = new StoreMiddlewareHost({ runtime, getState: () => state });
host.runAction('increment', () => {
  state = { ...state, count: state.count + 1 };
});
await host.dispose();
```

构造参数同 `createStoreMiddlewareHost`。实例成员：

- `readonly mutationPolicy: MutationPolicy`
- `emit(event: IMiddlewareEvent<S>): void` —— 同步跑一遍 pipeline；某个 stage 忘了调用 `next()` 不会抛错，而是以 `code: 'MIDDLEWARE_NOT_CHAINED'` 上报给 `runtime.reportError()`
- `runAction<T>(name: string, fn: () => T, metadata?: Readonly<Record<string, unknown>>): T` —— 派发 `action:start` → 用 `mutationPolicy.runInAction(() => runtime.batch(fn))` 执行 `fn` → 成功派发 `action:end`，失败派发 `action:error` 后**重新抛出原始异常**
- `recordState(name: string, previous: S, next: S, metadata?: Readonly<Record<string, unknown>>): void` —— 派发一个 `state` 事件；中间件抛错被隔离，不会传给调用方
- `recordError(phase: string, error: unknown, metadata?: Readonly<Record<string, unknown>>): void` —— 派发一个 `error` 事件；重入（处理上一个 `error` 事件期间又调用）时直接转发给 `runtime.reportError`，不再触发一轮 pipeline
- `connectDevTools(adapter: IDevToolsAdapter<S>, name?: string): Promise<void>` —— `name` 默认 `'store-devtools'`
- `attachBindingDisposer(disposer: IDisposer): void` —— 登记额外的清理函数，`dispose()` 时按后进先出顺序先于插件卸载执行
- `override dispose(): Promise<void>` —— 稳定 Promise（重复调用返回同一个）；多项清理失败抛 `code: 'CLEANUP_FAILED'` 的 `AggregateError`

**`middlewarePlugin`｜5 秒上手** —— 把旧式 `(event, context, next) => void` 中间件函数适配成插件：

```ts
const audit = middlewarePlugin('audit', (event, context, next) => {
  next();
  auditSink({ event, state: context.getState() });
});
await host.use(audit);
```

参数：`name: string`（必填，插件名）、`middleware: IStoreMiddleware<S>`（必填，`(event, context, next) => void`；`context` 只有 `{ runtime, getState }` 两个字段）。中间件体内不调用 `next()`，事件不会继续传给后面的插件（但不影响已经发生的 Store 写入）。

**`loggerMiddleware`｜3 秒上手** —— 内置的日志中间件：

```ts
await host.use(loggerMiddleware()); // 默认 console.log('[store]', event, state)
await host.use(loggerMiddleware((event, state) => myLogger(event, state)));
```

单参数 `sink?: (event: IMiddlewareEvent<unknown>, state: unknown) => void`（默认打印到 `console.log`）；插件名固定 `'store-logger'`；每个事件先放行给下游插件，再调用 `sink`，`state` 是调用 `sink` 那一刻的最新快照。

**`bindStoreMiddleware`｜10 秒上手** —— 一行接入已有 `@migaia/store-light` Store，自动桥接状态变化与 action trace：

```ts
import { createStore } from '@migaia/store-light';
import { bindStoreMiddleware, createMutationPolicy } from '@migaia/store-middleware';

const mutationPolicy = createMutationPolicy('actions-only');
const store = createStore(
  {
    count: 0,
    increment() {
      this.count++;
    }
  },
  { mutationPolicy }
);
const host = bindStoreMiddleware(store, { mutationPolicy });

store.increment(); // 允许：action 内
await host.dispose(); // 只释放这次绑定，Store 本身不受影响
```

第二参数 `IStoreMiddlewareBindingOptions`（全部可选）：

- `mutationPolicy?: MutationPolicy` —— 要和传给 `createStore()` 的是同一个实例，`actions-only` 才真正生效
- `actionPrefix?: string` —— 只转发 `event.name` 以该前缀开头的 Runtime action trace
- `clone?: (state: Record<string, unknown>) => Record<string, unknown>` —— 默认 `state => ClonePolicy.diagnostic(state)`（尽力而为，不抛错）；`getState()`/状态订阅每次都会调用它产出一份新的独立快照

返回值是 `StoreMiddlewareHost` 实例，额外挂了只读的 `store` 属性指回传入的 Store。

**`ClonePolicy`｜5 秒上手** —— 三种"给调用方一份拷贝"的显式策略常量表：

```ts
ClonePolicy.immutable(value); // 真独立深拷贝，做不到就抛错
ClonePolicy.opaque(value); // 完全不拷贝，原样返回引用
ClonePolicy.diagnostic(value); // 尽力而为，永不抛错
```

无调用参数，是一个把三个函数聚合在一起的常量对象。

**`immutableSnapshotClone`｜5 秒上手**（即 `ClonePolicy.immutable`，单参数 `value: T`，无选项）：

```ts
immutableSnapshotClone({ a: 1, date: new Date() });
```

优先用 `structuredClone`；当前环境没有 `structuredClone` 时抛 `code: 'ENV_UNSUPPORTED'`；值里含函数/DOM 句柄/类实例等不可克隆内容时抛 `code: 'CLONE_UNSUPPORTED'`——两者都是 `Error`，不会悄悄返回一份共享引用。

**`opaqueReferenceClone`｜3 秒上手**（即 `ClonePolicy.opaque`，单参数 `value: T`，无选项）：

```ts
opaqueReferenceClone(value) === value; // true，零拷贝
```

**`diagnosticClone`｜5 秒上手**（即 `ClonePolicy.diagnostic`，单参数 `value: T`，无选项）：

```ts
diagnosticClone({ a: 1, fn: () => 1 }); // { a: 1, fn: <同一个函数引用> }，永不抛错
```

优先 `structuredClone`；失败时退回递归拷贝：可以拷贝的部分（plain object/array）逐层深拷贝，只有真正不可克隆的那个子树按引用保留。

**`tolerantClone`｜3 秒上手** —— `@deprecated`，等价于 `diagnosticClone`（同一个函数引用），仅为兼容旧代码保留：

```ts
tolerantClone === diagnosticClone; // true
```

**`StoreMiddlewareErrorCode`｜3 秒上手** —— 稳定错误码表，用于 `switch`/比较：

```ts
if (error.code === StoreMiddlewareErrorCode.actionScopeRequired) {
  /* ... */
}
```

全部取值：`invalidOption`(`INVALID_OPTION`)、`middlewareNotChained`(`MIDDLEWARE_NOT_CHAINED`)、`actionScopeRequired`(`ACTION_SCOPE_REQUIRED`)、`cloneUnsupported`(`CLONE_UNSUPPORTED`)、`devtoolsCapability`(`DEVTOOLS_CAPABILITY`)、`envUnsupported`(`ENV_UNSUPPORTED`)、`cleanupFailed`(`CLEANUP_FAILED`)。

**`STORE_MIDDLEWARE_SOURCE`｜3 秒上手** —— 本包抛出的每个错误上都会带的 `source` 常量：

```ts
STORE_MIDDLEWARE_SOURCE; // '@migaia/store-middleware'
```

**`createStoreMiddlewareError`｜5 秒上手** —— 构造一个带 `(source, code)` 身份标记的 `Error`：

```ts
throw createStoreMiddlewareError(
  StoreMiddlewareErrorCode.invalidOption,
  '[store] middleware host options must be an object'
);
```

参数：`code: IStoreMiddlewareErrorCode`（必填）、`message: string`（必填）、第三参数选项 `{ cause?: unknown }`（可选，透传给 `Error` 构造器）。

**`createStoreMiddlewareAggregateError`｜5 秒上手** —— 构造一个带身份标记的 `AggregateError`，用于多项清理失败：

```ts
throw createStoreMiddlewareAggregateError(
  StoreMiddlewareErrorCode.cleanupFailed,
  [err1, err2],
  '[store] middleware host cleanup failed'
);
```

参数：`code: IStoreMiddlewareErrorCode`（必填）、`errors: readonly unknown[]`（必填，保留每一个原始错误）、`message: string`（必填）。

---

<a id="tolerant-clone-模块"></a>

## `/tolerant-clone` 子路径

```ts
import {
  ClonePolicy,
  immutableSnapshotClone,
  opaqueReferenceClone,
  diagnosticClone,
  tolerantClone
} from '@migaia/store-middleware/tolerant-clone';
```

与根导出中同名的 `ClonePolicy`/`immutableSnapshotClone`/`opaqueReferenceClone`/`diagnosticClone`/`tolerantClone` 是**同一份实现**（根导出 `export * from './tolerant-clone.js'`）；这个子路径只是给只需要克隆策略、不想连带引入 `StoreMiddlewareHost`/`bindStoreMiddleware` 等其余符号的调用方一个更窄的导入面。用法与全部选项见上方[根导出](#根导出)对应条目。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 接入已有 Store：`actions-only` 策略 + 日志中间件 + DevTools

```ts
import { createStore } from '@migaia/store-light';
import {
  bindStoreMiddleware,
  createMutationPolicy,
  loggerMiddleware,
  createReduxDevToolsAdapter
} from '@migaia/store-middleware';

const mutationPolicy = createMutationPolicy('actions-only');
const store = createStore(
  {
    count: 0,
    increment() {
      this.count++;
    }
  },
  { mutationPolicy }
);

const host = bindStoreMiddleware(store, { mutationPolicy });
await host.use(loggerMiddleware());
await host.connectDevTools(createReduxDevToolsAdapter(connection));

store.increment(); // 允许：action 内
// store.count = 1;  // 抛 ACTION_SCOPE_REQUIRED：actions-only 下不允许 action 外直接写

// 应用退出、组件卸载或请求结束时
await host.dispose();
```

### 2. 自定义领域插件：只在 action 结束时上报审计事件

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

### 3. 独立使用 `MutationPolicy`（不接 Store）+ 错误身份识别

```ts
import { createMutationPolicy, StoreMiddlewareErrorCode } from '@migaia/store-middleware';

const policy = createMutationPolicy('actions-only');

try {
  policy.assertMutationAllowed('settings.theme'); // 不在 action 内，抛错
} catch (error) {
  if ((error as { code?: string }).code === StoreMiddlewareErrorCode.actionScopeRequired) {
    console.warn('write attempted outside an action');
  }
}

policy.runInAction(() => {
  policy.assertMutationAllowed('settings.theme'); // 处于 action 内，放行
});
```

### 4. 大状态树下换用零拷贝 `ClonePolicy.opaque` 降低 `getState()` 开销

```ts
import { bindStoreMiddleware, ClonePolicy } from '@migaia/store-middleware';

// 默认 clone 是 ClonePolicy.diagnostic（尽力而为、逐层深拷贝）；
// 状态树很大或事件很密集时，改成零拷贝的 opaque 换取性能，
// 代价是中间件之间、以及和 Store 本身共享同一份引用。
const host = bindStoreMiddleware(store, { clone: ClonePolicy.opaque });
```

### 5. 手动构造 Host（不经 `bindStoreMiddleware`），支持 DevTools 时间旅行

```ts
import { createStoreMiddlewareHost, createReduxDevToolsAdapter } from '@migaia/store-middleware';

let state = { count: 0 };
const host = createStoreMiddlewareHost({
  runtime,
  getState: () => state,
  applyState: (next) => {
    state = next;
  } // 缺省时 connectDevTools 的 jump/reset 会抛 DEVTOOLS_CAPABILITY
});

await host.connectDevTools(createReduxDevToolsAdapter(connection));
host.runAction('increment', () => {
  state = { count: state.count + 1 };
});
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

</content>
