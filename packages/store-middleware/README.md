# `@migaia/store-middleware`

给 `@migaia/store-light` 的 Store 装上"观察和约束"能力的中间件层：`action`/`state`/`error` 三类领域事件、`actions-only` 写入策略、Redux DevTools 适配器，以及三种显式的"复制状态"策略（`ClonePolicy`）。它不重新发明插件系统，而是通过 `@migaia/plugin-host` 的 `defineHost` 组合原 canonical 句柄——中间件就是安装在这个 Host 上的插件。

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
import { createMutationPolicy, MutationPolicy, MiddlewareEventType, MiddlewareEventPhase, MiddlewareCommandType, createReduxDevToolsAdapter, createStoreMiddlewareHost, loggerMiddleware, bindStoreMiddleware, StoreMiddlewareErrorCode, STORE_MIDDLEWARE_SOURCE, createStoreMiddlewareError, createStoreMiddlewareAggregateError } from '@migaia/store-middleware';
import { ClonePolicy, immutableSnapshotClone, opaqueReferenceClone, diagnosticClone } from '@migaia/store-middleware/tolerant-clone';
```

**`createMutationPolicy`｜5 秒上手** —— 创建"这次写入允不允许发生"的判断器：

```ts
const mutationPolicy = createMutationPolicy('actions-only');
```

单参数 `mode?: 'off' | 'actions-only'`（默认 `'off'`）——`'off'` 时永远放行；`'actions-only'` 时只有处于 `runInAction()` 内部才放行，深度为 0 时 `assertMutationAllowed()` 抛出携带 `code: 'ACTION_SCOPE_REQUIRED'` 的 `Error`。若希望 host.runAction 同时授权 Store 的策略，必须与 `createStore({ mutationPolicy })` 共享实例，两个独立策略仍各自执行守卫；Store 的直接写保护仍有效，但宿主 action 无法授权另一个 Store 策略实例。

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

参数 `connection: IReduxDevToolsConnection<S>` 与可选 `runtime?: IRuntime`（默认共享 Runtime，用于解析失败报告）（必填，提供 `init`/`send`/`subscribe` 三个方法），无其他选项；返回值直接喂给 `host.connectDevTools()`。

**`createStoreMiddlewareHost`｜10 秒上手** —— 直接构造一个 Host（不绑定任何 Store）：

```ts
const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtime,
  getState: () => currentState
});
```

全部选项（`IStoreMiddlewareHostOptions<S>`，继承 `IPluginHostOptions`）：

- `execution: { mutationTimeoutMs: number | false; pipelineDrainTimeoutMs: number | false }`（必填）—— 显式操作与 drain 预算。
- `identity?: { name?: string }` —— 可选可读标签，唯一身份由 canonical Host 签发。
- `onDiagnosticFailure?: (error: unknown) => void` —— diagnostic 自身失败的终端接收器，语义沿用 plugin-host。
- `runtime: IRuntime`（必填）—— 来自 `@migaia/reactive`，用于 `reportError`/`batch`
- `getState: () => S`（必填）
- `applyState?: (state: S) => void` —— 未提供时，DevTools 的 `jump`/`reset` 命令会抛出 `code: 'DEVTOOLS_CAPABILITY'`
- `mutationPolicy?: MutationPolicy` —— 缺省时内部新建一个 `mode: 'off'` 的实例
- `pipeline?: { mode?: IMiddlewarePipelineMode }` —— **会被构造函数强制覆盖成 `MiddlewarePipelineMode.sync`**，传别的值不生效
- `diagnostic?` / `scheduler?` / `queueAdmissionTimeoutMs?` / `queueAdmissionDiagnosticMs?` / `disposeStepTimeoutMs?` —— 透传给 `@migaia/plugin-host` 的 `PluginHost`，语义见其 USEGUIDE

**`IStoreMiddlewareHost<S>`｜10 秒上手** —— `createStoreMiddlewareHost()` 返回的冻结句柄（不是类，没有 `new`）。它通过 `@migaia/plugin-host` 的 `defineHost` 组合而成，同时带有宿主公共成员（`use`/`unUse`/`dispose` 等）和下面的 Store 领域成员：

```ts
import { createRuntime } from '@migaia/reactive';
import { createStoreMiddlewareHost } from '@migaia/store-middleware';

const runtime = createRuntime();
let state = { count: 0 };
const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtime,
  getState: () => state
});
host.runAction('increment', () => {
  state = { ...state, count: state.count + 1 };
});
await host.dispose(); // returns the structured PluginHost disposal result
```

领域成员：

- `readonly mutationPolicy: MutationPolicy`
- `emit(event: IMiddlewareEvent<S>): void` —— 同步跑一遍 pipeline；某个 stage 忘了调用 `next()` 不会抛错，而是以 `code: 'MIDDLEWARE_NOT_CHAINED'` 上报给 `runtime.reportError()`
- `runAction<T>(name: string, fn: () => T, metadata?: Readonly<Record<string, unknown>>): T` —— 派发 `action:start` → 用 `mutationPolicy.runInAction(() => runtime.batch(fn))` 执行 `fn` → 成功派发 `action:end`，失败派发 `action:error` 后**重新抛出原始异常**
- `recordState(name: string, previous: S, next: S, metadata?: Readonly<Record<string, unknown>>): void` —— 派发一个 `state` 事件；中间件抛错被隔离，不会传给调用方
- `recordError(phase: string, error: unknown, metadata?: Readonly<Record<string, unknown>>): void` —— 派发一个 `error` 事件；重入（处理上一个 `error` 事件期间又调用）时直接转发给 `runtime.reportError`，不再触发一轮 pipeline
- `connectDevTools(adapter: IDevToolsAdapter<S>, name?: string): Promise<void>` —— `name` 默认 `'store-devtools'`
- `attachBindingDisposer(disposer: IDisposer): void` —— 登记额外的清理函数，`dispose()` 时按后进先出顺序先于插件卸载执行
- `dispose()` —— 先逆序执行绑定 disposer，再委托 plugin-host 卸载插件；返回结构化结果 `{ logicalTerminal, cleanupComplete, cleanupErrors }`，绑定 disposer 抛出的错误排在 `cleanupErrors` 前面，不会以异常形式抛出

插件直接采用 `IStoreMiddlewarePlugin<S>` 与 `install(core)` / `core.usePipeline((event, next) => next(event))`；旧三参数函数适配器及专用 context 类型已移除。Store 领域能力从 core 读取，生命周期继续归 canonical plugin-host。

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
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  mutationPolicy
});

store.increment(); // 允许：action 内
await host.dispose(); // 只释放这次绑定，Store 本身不受影响
```

第二参数 `IStoreMiddlewareBindingOptions`：`execution` 必填，其余字段可选。

- `execution: { mutationTimeoutMs, pipelineDrainTimeoutMs }` —— 两个字段均须为非负有限毫秒数或 `false`；`false` 表示不设截止时间。

- `mutationPolicy?: MutationPolicy` —— 要和传给 `createStore()` 的是同一个实例，`actions-only` 才真正生效
- `actionPrefix?: string` —— 只转发 `event.name` 以该前缀开头的 Runtime action trace
- `clone?: (state: Record<string, unknown>) => Record<string, unknown>` —— 默认 `state => ClonePolicy.diagnostic(state)`（尽力而为，不抛错）；`getState()`/状态订阅每次调用它尽力复制；不可复制子树可与 Store 或其它读取共享引用

返回值是同一个 canonical 冻结 managed Host 句柄：构造冻结前装入全部领域成员与只读 `store`，保留实时 getter、issued identity 和链式返回身份。若绑定过程中订阅失败且回滚清理也失败，`bindStoreMiddleware()` 抛 `code: 'CLEANUP_FAILED'` 的 `AggregateError`（原始错误位于 `errors[0]`）。

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

先接纳严格数据图，再委托 Utils 的 `structuredClone`；已接纳输入在环境没有 `structuredClone` 时抛 `code: 'ENV_UNSUPPORTED'`；值里含函数/DOM 句柄/类实例等不可克隆内容时抛 `code: 'CLONE_UNSUPPORTED'`——两者都是 `Error`，不会悄悄返回一份共享引用。

**`opaqueReferenceClone`｜3 秒上手**（即 `ClonePolicy.opaque`，单参数 `value: T`，无选项）：

```ts
opaqueReferenceClone(value) === value; // true，零拷贝
```

**`diagnosticClone`｜5 秒上手**（即 `ClonePolicy.diagnostic`，单参数 `value: T`，无选项）：

```ts
diagnosticClone({ a: 1, fn: () => 1 }); // { a: 1, fn: <同一个函数引用> }，永不抛错
```

优先 `structuredClone`；失败时退回递归拷贝：可以拷贝的部分（plain object/array）逐层深拷贝，只有真正不可克隆的那个子树按引用保留。

旧 `tolerantClone` 名已移除；使用窄入口的 `diagnosticClone` 或 `ClonePolicy.diagnostic`。

**`StoreMiddlewareErrorCode`｜3 秒上手** —— 稳定错误码表，用于 `switch`/比较：

```ts
if (error.code === StoreMiddlewareErrorCode.actionScopeRequired) {
  /* ... */
}
```

全部取值：`invalidOption`(`INVALID_OPTION`)、`middlewareNotChained`(`MIDDLEWARE_NOT_CHAINED`)、`actionScopeRequired`(`ACTION_SCOPE_REQUIRED`)、`cloneUnsupported`(`CLONE_UNSUPPORTED`)、`callbackFailed`(`CALLBACK_FAILED`)、`devtoolsMessageInvalid`(`DEVTOOLS_MESSAGE_INVALID`)、`devtoolsCapability`(`DEVTOOLS_CAPABILITY`)、`envUnsupported`(`ENV_UNSUPPORTED`)、`cleanupFailed`(`CLEANUP_FAILED`)。`IStoreMiddlewareErrorCode` 为这些码值的联合。

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
} from '@migaia/store-middleware/tolerant-clone';
```

这些克隆策略仅从 `@migaia/store-middleware/tolerant-clone` 发布；直接复用原 owner，根不再提供别名，旧 tolerantClone 名不保留。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 接入已有 Store：`actions-only` 策略 + 日志中间件 + DevTools

```ts
import { createStore } from '@migaia/store-light';
import { bindStoreMiddleware, createMutationPolicy, loggerMiddleware, createReduxDevToolsAdapter } from '@migaia/store-middleware';

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

const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  mutationPolicy
});
await host.use(loggerMiddleware<Record<string, unknown>>());
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
import { bindStoreMiddleware } from '@migaia/store-middleware';
import { ClonePolicy } from '@migaia/store-middleware/tolerant-clone';

// 默认 clone 是 ClonePolicy.diagnostic（尽力而为、逐层深拷贝）；
// 状态树很大或事件很密集时，改成零拷贝的 opaque 换取性能，
// 代价是中间件之间、以及和 Store 本身共享同一份引用。
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  clone: ClonePolicy.opaque
});
```

### 5. 手动构造 Host（不经 `bindStoreMiddleware`），支持 DevTools 时间旅行

```ts
import { createStoreMiddlewareHost, createReduxDevToolsAdapter } from '@migaia/store-middleware';

let state = { count: 0 };
const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
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

`createReduxDevToolsAdapter(connection, runtime?)` 的第二参数默认共享 Runtime，用于报告支持命令里的非法 JSON；不执行坏命令，后续合法命令仍工作。Utils 克隆失败包装完整保留捕获的 Utils 错误在 cause 上，包括 ENV_UNSUPPORTED；不越过该层直接指向 native leaf。

immutable 的严格数据契约：接纳普通/null 原型记录、普通数组、当前 realm 的原生 Map/Set/Date/RegExp/ArrayBuffer、非共享 ArrayBuffer 支持的标准 TypedArray/DataView。自定义 class（包括内建子类）、访问器与其它未接纳的原生对象以 CLONE_UNSUPPORTED 拒绝；访问器在求值前拒绝，不额外执行 getter。Map key/value、Set 成员及记录/数组数据递归接纳，循环与共享引用仍由唯一的 utils structuredClone 保持。此收窄修正旧版 class 静默丢方法的问题；旧版 getter、跨 realm 内建值及未列类型需迁移为支持的数据，或显式选择 diagnostic/opaque。Utils.immutableSnapshot 原生投影契约不变。本策略不另实现 clone 引擎。

API convergence：克隆五名只从既有 `/tolerant-clone` 导入；deprecated tolerantClone 两入口均删除。IMutationGuard/IMutationPolicy 从 `@migaia/store-light` 直接导入。旧 middlewarePlugin/IStoreMiddleware/IMiddlewareContext 删除，迁移为 IStoreMiddlewarePlugin 与 core.usePipeline；没有 shim/alias。外部旧导入需破坏版本迁移，仓库唯一生产 clone consumer 已使用窄入口。

错误码新增成员：`callbackFailed` (`CALLBACK_FAILED`) 与 `devtoolsMessageInvalid` (`DEVTOOLS_MESSAGE_INVALID`)；完整触发场景以 canonical error-code.ts 与 registry 为准。

### Redux 扩展命令词表

根入口导出 `ReduxDevToolsCommand` 与值联合 `IReduxDevToolsCommand`。`createReduxDevToolsAdapter` 使用 dispatch/commit/jumpToState/jumpToAction/rollback/reset 六个键，其值分别为 DISPATCH/COMMIT/JUMP_TO_STATE/JUMP_TO_ACTION/ROLLBACK/RESET。原 `@migaia/store-devtools` 的 `StoreDevtoolsCommand` / `IStoreDevtoolsCommand` 导入迁移到这里，协议字符串不变；middleware 领域命令继续使用 `MiddlewareCommandType`。
