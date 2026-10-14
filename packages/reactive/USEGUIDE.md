# `@migaia/reactive` 使用指南

本指南列出三个已发布入口的 API、边界行为与错误码。节点统一经 Runtime 工厂创建；`Signal`、`Computed`、`Effect` 类保留为内部实现。包的定位与五分钟上手见 [README](./README.md)。

## 目录

- [主入口 `@migaia/reactive`](#主入口)：Runtime 工厂、窄节点类型、诊断常量与错误码
- [`/extension` 入口](#extension-入口)：所有权、受控 source、observer binding、图类型与只读版本查询
- [`/internals` 入口](#internals-入口)：内部服务、节点版本与可变边集
- [错误码](#错误码)
- [Trace 事件与常量](#trace-事件与常量)
- [高阶组合示例](#高阶组合示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="主入口"></a>

## 主入口 `@migaia/reactive`

```ts
import {
  createRuntime, defaultRuntime, assertSingleRuntimeCopy,
  ReactiveErrorCode, REACTIVE_SOURCE, ReactiveErrorPhase, ReactiveTracePhase,
  ReactiveTraceType, ReactiveTraceReason, ReactiveDependencyKind,
  type IReactiveSignal, type IReactiveComputed, type IReactiveEffect,
  type IComputedConfig, type IReactiveNodeOptions, type IDisposable, type IDisposer,
  type IRuntime, type IRuntimeOptions, type ISchedulerStrategy, type IFlushResult,
  type IRuntimeTraceEvent, type IRuntimeErrorContext, type IReactiveErrorCode,
  type IReactiveError
} from '@migaia/reactive';
```

### `IReactiveSignal<T>`

```ts
type IReactiveSignal<T> = IDisposable & {
  readonly runtime: IRuntime;
  readonly debugName?: string;
  readonly version: number;
  readonly disposed: boolean;
  readonly observed: boolean; // !disposed && 有下游订阅
  value: T; // 读建立依赖；写触发下游
  peek(): T; // 读，不建立依赖
  dispose(): void;
  addObservedHooks(hooks: { onObserved?: () => void; onUnobserved?: () => void }): () => void;
}
```

可写原子——响应式图里唯一的"真值来源"：

```ts
const runtime = createRuntime();
const count = runtime.signal(1);
count.value; // 1，在 Computed/Effect 内读取会建立依赖
count.value = 2; // Object.is 判定；写入相同值不触发任何通知，也不推进版本
count.peek(); // 2，不建立依赖
count.dispose();
count.value; // 抛 NODE_DISPOSED
```

边界行为：

- 经 `runtime.signal(value, options?)` 创建；返回窄节点视图，不暴露图边或内部方法。
- `value = next`：`Object.is(next, 之前值)` 为真时短路，不推进版本、不触发下游；否则先向 `VersionClock` 领取新版本号再落值（领取失败——时钟耗尽——保持原子失败，绝不出现"值已变、版本未变"的陈旧状态）。
- `dispose()` 幂等；释放时先标记 `disposed` 再断开全部下游订阅边（通知顺序：标记优先，确保被迫重跑的 Effect 读到明确的 `NODE_DISPOSED` 而不是重新订阅一个已释放节点）。
- `addObservedHooks({ onObserved?, onUnobserved? })`：登记节点级生命周期钩子（多个调用方可各自登记互不覆盖），返回移除函数；多个钩子中若有失败，单个失败原样抛出，多个失败聚合为携带 `OBSERVER_FAILED` 码的 `AggregateError`。
- 跨 `Runtime` 读取/订阅一个 `Signal` 会抛 `CROSS_RUNTIME`。

### `IReactiveComputed<T>`

```ts
type IComputedOptions<T> = {
  equals?: (a: T, b: T) => boolean;
  keepAlive?: boolean;
  debugName?: string;
};
type IComputedConfig<T> = IComputedOptions<T> | ((a: T, b: T) => boolean);

type IReactiveComputed<T> = IDisposable & {
  readonly runtime: IRuntime;
  readonly debugName?: string;
  readonly version: number;
  readonly disposed: boolean;
  readonly observed: boolean;
  readonly value: T; // 读建立依赖 + 惰性重算
  peek(): T; // 读、重算，但不建立依赖
  dispose(): void;
}
```

惰性求值、带缓存的派生值——写只标脏（push），值只在被读时重算（pull）：

```ts
const doubled = runtime.computed(() => count.value * 2);
doubled.value; // 首次读取才真正计算
doubled.value; // 依赖未变则直接返回缓存，不重算

const clamped = runtime.computed(() => Math.max(0, count.value), { keepAlive: true }); // 无订阅者也保持热态
const custom = runtime.computed(() => ({ n: count.value }), (a, b) => a.n === b.n); // 配置参数可直接传比较函数
```

边界行为：

- 经 `runtime.computed(fn, config?)` 创建；配置可以是对象，也可以直接传一个 `equals` 比较函数。
- `equals`：默认 `Object.is`；比较函数本身抛错会阻止 dirty 落定（下次读取仍会重算，不会陷入"陈旧但标记为干净"的状态）。
- `keepAlive`：默认 `false`——没有订阅者时会在下一个 idle 时机自动挂起（断开全部依赖、状态回到 dirty），下次读取重新建立依赖并重算；设为 `true` 时禁用自动挂起。
- 循环自依赖（求值过程中直接或间接又读了自己）抛 `CIRCULAR_DEPENDENCY`，不会栈溢出。
- 已释放节点的 `value`/`peek` 一律抛 `NODE_DISPOSED`。

### `IReactiveEffect`

```ts
type IReactiveEffect = IDisposable & {
  readonly runtime: IRuntime;
  readonly debugName?: string;
  readonly disposed: boolean;
  dispose(): void;
}
```

副作用——唯一真正"被执行"的观察者（`Computed` 只标脏不重跑，只有 `Effect` 会被调度器实际 `tick`）：

```ts
const seen: number[] = [];
const effect = runtime.effect(() => {
  seen.push(doubled.value);
  return () => console.log('cleanup'); // 可选：返回值作为下次重跑/dispose 前的清理回调
}); // 构造时立即同步跑一次
effect.dispose(); // 释放：清理依赖边 + 跑最后一次 cleanup（untracked 执行，不建立依赖）
```

边界行为：

- **构造时立即同步执行一次**，不是等到依赖变化才第一次运行。
- `fn()` 可选返回一个清理函数（`IDisposer`），会在下次重跑前、以及 `dispose()` 时被调用（`runtime.untracked()` 包裹执行，不建立新依赖）；旧 cleanup 会先被摘掉（置空）再执行，避免新 `fn()` 抛错时下次重跑/dispose 重复执行旧 cleanup。
- 依赖变化后不会立即重跑，而是被 `Scheduler.enqueue()` 标脏排队，由 `flush()`（自动或手动）驱动 `tick()`；`tick()` 内部会先确认依赖确实变化（`hasStaleDependencies`）才真正 `run()`。
- 依赖节点被 `dispose()`/`disconnectObservable` 断开时，会强制下次 `tick()` 无条件重跑（不看是否真的脏）。

### `createRuntime` / `defaultRuntime`

```ts
function createRuntime(options?: IRuntimeOptions): IRuntime;
const defaultRuntime: IRuntime;
```

```ts
type IRuntimeOptions = {
  adapter?: Partial<IReactiveRuntimeAdapter>; // scheduleMicrotask/now/timestamp/reportError
  onError?: (error: unknown, context: IRuntimeErrorContext) => void;
  onTrace?: (event: IRuntimeTraceEvent) => void;
  maxFlushPasses?: number; // 默认 100，须为正整数
  scheduleIdle?: (task: () => void) => void; // 默认走 adapter.scheduleMicrotask
  schedulerStrategy?: ISchedulerStrategy; // 创建期选择，默认微任务合并
};
```

新建一个隔离运行时：

```ts
const runtime = createRuntime({
  maxFlushPasses: 50,
  onError: (e, ctx) => console.error(ctx.phase, e)
});
```

边界行为：

- `maxFlushPasses` 非正整数（非安全整数或 `< 1`）抛贴 `INVALID_OPTION` 码的 `RangeError`。
- `adapter` 的每个方法（`scheduleMicrotask`/`now`/`timestamp`/`reportError`）独立解析：未提供或显式 `undefined` 回落到默认实现（`queueMicrotask`/`performance.now()`/`Date.now()`/no-op）；提供了但不是函数抛贴 `INVALID_OPTION` 码的 `TypeError`。
- `onError`/`onTrace`/`scheduleIdle`/`schedulerStrategy` 若提供但不是函数，构造时抛携带顶层 `INVALID_OPTION` 的原生 `TypeError`。策略校验发生在创建 Scheduler 之前。
- `defaultRuntime` 是进程级单例（模块加载时立即 `createRuntime()`），SSR 每请求隔离、单测互不污染、Worker 独立场景都应显式 `createRuntime()`，不要依赖它。
- 若检测到本库存在多份运行时副本（重复安装/CDN 副本共存/微前端各自打包），构造期会通过 `reportError` 上报一条 `COPY_CONFLICT` 诊断（不阻断构造）。

`IRuntime` 的公开方法（品牌字段省略）：

```ts
type IRuntime = {
  signal<T>(value: T, options?: IReactiveNodeOptions): IReactiveSignal<T>;
  computed<T>(fn: () => T, config?: IComputedConfig<T>): IReactiveComputed<T>;
  effect(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IReactiveEffect; // 返回现有节点的生命周期句柄
  batch<T>(fn: () => T): T;
  untracked<T>(fn: () => T): T;
  flush(): 'completed' | 'deferred';
  runTracedAction<T>(name: string, fn: () => T): T;
  reportError(
    error: unknown,
    context: { phase: IRuntimeErrorContext['phase']; observer?: object; observable?: object }
  ): void;
  subscribeTrace(listener: (event: IRuntimeTraceEvent) => void): IDisposer;
}
```

逐个方法：

- `batch(fn)`：显式合并多次写入为一次副作用刷新；进入时计深度，只有最外层退出才真正 `flush()`。若 `fn` 抛错且随后的收尾 `flush()` 也抛错，可写的普通 `Error` 保持原对象并在 `cause` 附上 flush 错误；非 `Error` 或不可写 `Error` 用携带 `ACTION_FLUSH_FAILED` 码的 `AggregateError` 保留原值。若业务错误的 `cause` getter 抛错，聚合错误的 `errors` 依次保留业务错误、flush 错误、getter 抛出值；`onError` 另收到 getter 抛出值及 `cause-read` phase。
- `untracked(fn)`：`fn` 执行期间关闭依赖收集，读取任何 `Signal`/`Computed` 都不会建立依赖边。
- `flush()`：同步冲刷当前队列。**重入语义**：observer `tick()` 内部再次调用 `flush()` 返回 `'deferred'`（外层 flush 仍在跑，本次调用不会真正冲刷）；最外层调用完成并排空队列后返回 `'completed'`。单次冲刷内的重算轮数超过 `maxFlushPasses` 抛 `FLUSH_LOOP`（见错误码表），并清空剩余队列，错误信息列出被丢弃的最多 8 个 `debugName`。
- `schedulerStrategy` 创建期选项只改变何时 `flush`，不交出 Scheduler 队列。策略须同步返回；返回 thenable 会触发 `INVALID_OPTION` 诊断并回退到已验证的安全策略。Runtime 存活期间不公开替换入口。
- `runTracedAction(name, fn)`：执行并追踪一段真实 action；`name` 必须是非空字符串，否则抛 `INVALID_OPTION`。未启用 trace（无监听器）时直接等价于 `fn()`，不产生额外开销。
- `reportError(error, context)`：诊断通道；`context.observer`/`context.observable` 是原始节点对象，内部会先脱敏为 `IRuntimeNodeDescriptor` 再转发给 `onError`。
- `subscribeTrace(listener)`：只读诊断事件流（节点创建、依赖连接/断开、副作用执行、显式 action），返回取消订阅函数。

---

### `assertSingleRuntimeCopy()`

要求当前进程只有一份进入过正确性边界的模块副本，否则抛 `COPY_CONFLICT`。应用从根入口显式调用，库自身不主动调用它。重复安装、CDN 副本共存或微前端独立打包时，应去重依赖。

---

<a id="extension-入口"></a>

## `/extension` 入口

实现层通过本入口取得扩展能力。它允许图协议参与和所有权登记，能力多于公共 `IRuntime`；不会交出 tracker/scheduler/clock 对象或可变边集。

```ts
import { createObserverBinding, type IObserverBinding, type IObserverCommitResult, type IObserverRetrackResult, type ICapture } from '@migaia/reactive/extension';
```

### `createObserverBinding`

```ts
function createObserverBinding(runtime: IRuntime): IObserverBinding;

type IObserverBinding = {
  capture<R>(read: () => R): ICapture<R>;
  observe(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IDisposer;
  commit(capture: ICapture<unknown>): IObserverCommitResult;
  retrack(): IObserverRetrackResult;
};

type IObserverCommitResult = 'committed' | 'stale' | 'no-observer';
type IObserverRetrackResult = 'changed' | 'unchanged' | 'no-observer';
```

为一个订阅者建立三段式绑定：**render 期只读地捕获依赖，commit 期才把依赖装到订阅者上**，中间的渲染可能被并发渲染丢弃，捕获阶段绝不建边。绑定自持一个内部 `Effect`：适配层能完成 capture/observe/commit/retrack，却拿不到 `deps`、版本或强制调度入口：

```ts
const binding = createObserverBinding(runtime);
const dispose = binding.observe(() => {
  // 真正的订阅者体；依赖变化后被正常调度重跑
});

// 渲染期（可能被丢弃）：
const capture = binding.capture(() => doubled.value); // 只记录读了谁、当时版本，不建边

// 提交期：
const result = binding.commit(capture); // 'committed' | 'stale' | 'no-observer'
if (result === 'stale') {
  // 捕获后依赖已变化：调用方应重新求值，不要复用同一个 capture token
}

binding.retrack(); // 强制当前订阅者重跑一次，返回其依赖集合是否发生变化
dispose();
```

四个成员逐一说明：

- `capture<R>(read: () => R): ICapture<R>` —— 渲染期捕获：只记录本次读到了哪些依赖节点及其当时版本，**不建立依赖边**——被丢弃的渲染因此不会留下订阅残留。`ICapture<R>` 是带品牌的不透明 token，`result: R` 是 `read()` 的返回值；依赖集合存在 tracker 私有 `WeakMap` 里，拿到 token 既读不出依赖也改不了版本。
- `observe(fn, options?): IDisposer` —— 安装绑定持有的内部 `Effect`（具体类保持私有，适配层拿不到它去改 `deps`/版本或调用 `run`/`markDirty`）。同一个 binding **重复调用**（当前订阅者仍处于已观察状态时再次调用）抛 `BINDING_DUPLICATE`。返回的 disposer 幂等。
- `commit(capture): IObserverCommitResult` —— 提交期安装依赖，把 `capture` 装到**创建绑定时指定的那个 observer** 上。`'committed'`：依赖边已安装；`'stale'`：捕获后依赖已变化，token 已消费，必须重新捕获——调用方只应在此时作废快照并重新取值，**不应该**在 commit 阶段去 pull 脏节点（那会把用户的求值错误抛在 commit 里，绕过 Error Boundary）；`'no-observer'`：提交目标尚不存在（还未 `observe()` 或已 dispose），token 未消费，可在 observer 就绪后重试。
- `retrack(): IObserverRetrackResult` —— 强制当前已提交的 observer 重跑一次，并报告其依赖集合是否发生变化（`'changed'`/`'unchanged'`），无 observer 时返回 `'no-observer'`。

### 所有权登记与断言

```ts
import {
  claimOwnership,
  ownerOf,
  assertOwnedBy,
  assertReactiveOwnedBy
} from '@migaia/reactive/extension';
```

「某节点属于哪个 `Runtime`」的登记与断言，供在本包之上构建 Store/集合/资源类库的作者使用。

- `claimOwnership(value: object, runtime: IRuntime): void` —— 登记归属；同一对象重复登记到不同 `Runtime` 抛 `OWNERSHIP_CONFLICT`。
- `ownerOf(value: unknown): IRuntime | undefined` —— 查归属，未登记返回 `undefined`（区分"不归任何图"与"归错图"）。
- `assertOwnedBy(value: unknown, runtime: IRuntime, what: string): void` —— 宽松断言：未登记的值一律放行（第三方可以把普通值注册进 Registry，不涉及图）；只有**登记过且归属不符**才抛 `CROSS_RUNTIME`。
- `assertReactiveOwnedBy(value: object, runtime: IRuntime, what: string): void` —— 内核图边界使用的严格断言：未登记直接抛 `NOT_RUNTIME_OWNED`；登记了但不属于当前 `runtime` 抛 `CROSS_RUNTIME`。

```ts
const runtime = createRuntime();
const node = {};
claimOwnership(node, runtime);
assertOwnedBy(node, runtime, 'my-node'); // 通过
assertOwnedBy(node, otherRuntime, 'my-node'); // 抛 CROSS_RUNTIME
```

---

### `createFieldSource`

```ts
import { createFieldSource, type IRuntimeFieldSource } from '@migaia/reactive/extension';
```

```ts
function createFieldSource(
  runtime: IRuntime,
  debugName?: string
): {
  track(): void;
  notify(): void;
  commit<T>(write: () => T): T;
  readonly observed: boolean;
  readonly disposed: boolean;
  dispose(): void;
};
```

为扩展层创建一条受控 Source（如 Wasm 字段、SharedArrayBuffer 支持的值）。调用方只拿到 `track`/`notify`/`commit`/`dispose` 四个能力，拿不到底层节点、`subs`、版本或 `Tracker`，因而不能制造单边依赖、伪造版本、通知另一张 `Runtime` 图：

```ts
const field = createFieldSource(runtime, 'wasm-counter');
function read(): number {
  field.track(); // 建立依赖，不返回值——真实值由外部存储持有
  return wasmMemory.getValue();
}
function write(v: number): void {
  field.commit(() => wasmMemory.setValue(v)); // 领取版本、执行写入、再发布，三步原子
}
field.dispose();
```

边界行为：`track()`/`notify()`/`commit()` 在 `dispose()` 之后调用抛 `NODE_DISPOSED`；`commit(write)` 先领取版本号、执行 `write()`、再发布通知（与 `Signal.value = ` 的三段式一致）。

---

### 图视图与只读查询

```ts
import {
  internalRuntimeOf,
  isRuntimeTracking,
  isAnyRuntimeTracking,
  currentRuntimeVersion,
  type IObservable,
  type IObserver,
  type IInternalRuntime
} from '@migaia/reactive/extension';
```

- `internalRuntimeOf(runtime: IRuntime): IInternalRuntime` —— 校验本库 Runtime 登记，未登记抛 `NOT_RUNTIME_OWNED`。`signal()` 返回 `IReactiveSignal<T> & IObservable`，`computed()` 返回 `IReactiveComputed<T> & IObservable & IObserver`。关系只读；observer 操作与所有权登记属于扩展能力，内部服务对象和可变边集仍在危险面。公开节点本身已经具有 `dispose()`。
- `isRuntimeTracking(runtime: IRuntime): boolean` —— 只读查询：该 `Runtime` 当前是否正在收集依赖帧。
- `isAnyRuntimeTracking(): boolean` —— 只读查询：进程内任意 `Runtime` 当前是否有依赖帧处于活跃状态。

- `currentRuntimeVersion(runtime: IRuntime): number` —— 读取原有版本时钟，不暴露时钟对象；未登记对象抛顶层 `NOT_RUNTIME_OWNED`。

---

<a id="internals-入口"></a>

## `/internals` 入口

```ts
import {
  registerInternals,
  internalsOf,
  isRuntime,
  type IRuntimeInternals
} from '@migaia/reactive/internals';
```

内核内部面（`clock`/`tracker`/`scheduler`/`notify`/`commitSource`/`deferIdle` 等），只供内核自身与被明确授权的高级入口使用（`architecture.test.ts` 约束哪些模块允许 import 它）。

- `registerInternals(runtime, internals): void` —— `Runtime` 构造时自报内部面；重复登记（同一 `runtime` 对象二次调用）抛 `INTERNALS_REGISTERED`。
- `internalsOf(runtime): IRuntimeInternals` —— 取内部面；拿不到时不是返回 `undefined` 而是抛 `NOT_RUNTIME_OWNED`（一个没登记内部面的对象冒充 `Runtime`，静默放行会在后续每一步产生难以追溯的错误）。
- `isRuntime(candidate): candidate is IRuntime` —— 判断是否是本库创建的 `Runtime`，不泄漏内部面本身。

一般应用代码不需要这个入口；实现自定义节点类型或框架适配层时才会用到。

---

### 节点版本与可变边集

```ts
import {
  registerVersion,
  setVersion,
  readVersion,
  registerSubs,
  mutableSubs,
  registerDeps,
  mutableDeps,
  registerDepVersions,
  mutableDepVersions
} from '@migaia/reactive/internals';
```

可变依赖边的登记与访问，供实现新的响应式基础设施（自定义 `IObservable`/`IObserver`）时手工接入依赖图使用：

- `registerVersion(node, initial): void` / `setVersion(node, value): void` / `readVersion(node, fallback): number` —— 节点版本号的登记、写入、读取（版本状态存在私有 `WeakMap`，不是节点自身字段）。
- `registerSubs(node, subs): ReadonlySet<IObserver>` —— 登记一个内置节点的可变下游边集合，返回一份只读视图供节点对外暴露；`mutableSubs(node, fallback)` 取回可变的原始 `Set`（未登记过时回落到 `fallback`）。
- `registerDeps`/`mutableDeps`、`registerDepVersions`/`mutableDepVersions` —— 对应上游依赖集合/依赖版本映射的登记与可变访问，语义与 `subs` 对称。

一般应用代码不需要这个入口；只有需要自己实现 `IObservable`/`IObserver` 协议、并让其反向边受同一套只读视图保护的节点实现层才会用到。

---

<a id="错误码"></a>

## 错误码

```ts
import { ReactiveErrorCode, type IReactiveErrorCode } from '@migaia/reactive';
```

稳定错误码表，**16 个码**，唯一声明处 `src/error-code.ts`，`source` 恒为 `'@migaia/reactive'`。（迁移背景：原属于本包的 `SCOPE_CLOSED`/`SCOPE_REENTRANT_DISPOSE`/`SCOPE_SYNC_VIOLATION`/`GENERATION_DISPOSED`/`SCOPE_DISPOSAL_FAILED` 五个码已随生命周期原语迁出，归属 `@migaia/lifecycle`，不在本表。）

| `ReactiveErrorCode` 键 | 码值                   | 触发条件                                                                                                         |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `nodeDisposed`         | `NODE_DISPOSED`        | 在已 dispose 的 `Signal`/`Computed`/自定义 Source 上调用读取或写入方法                                           |
| `circularDependency`   | `CIRCULAR_DEPENDENCY`  | 求值 `Computed` 时检测到它（直接或间接）读取了自己正在求值的结果                                                 |
| `crossRuntime`         | `CROSS_RUNTIME`        | 一个属于某 `Runtime` 的节点在另一个 `Runtime` 的追踪/所有权边界上被读取、订阅或校验                              |
| `notRuntimeOwned`      | `NOT_RUNTIME_OWNED`    | 传入的对象不是由 `createRuntime()` 创建、或不携带内部所有权登记                                                  |
| `ownershipConflict`    | `OWNERSHIP_CONFLICT`   | 同一个节点对象被重复登记到不同的 `Runtime`                                                                       |
| `copyConflict`         | `COPY_CONFLICT`        | 检测到本库存在多份运行时副本，或 `assertSingleRuntimeCopy()` 校验到副本数大于一                                  |
| `brandCorrupted`       | `BRAND_CORRUPTED`      | 跨副本诊断品牌被发现处于非预期形状                                                                               |
| `versionExhausted`     | `VERSION_EXHAUSTED`    | 单调版本时钟达到配置上限（默认 `Number.MAX_SAFE_INTEGER`）后再次申请新版本号                                     |
| `flushLoop`            | `FLUSH_LOOP`           | 一次冲刷内的重算轮数超过 `maxFlushPasses`（默认 100）                                                            |
| `observerFailed`       | `OBSERVER_FAILED`      | 一次冲刷中多个 observer 的 `tick()` 失败、或多个 observable 生命周期钩子失败，作为 `AggregateError` 外壳         |
| `actionFlushFailed`    | `ACTION_FLUSH_FAILED`  | `runBatched()` 内业务动作与收尾 flush 同时失败；普通可写错误在 `cause` 附加聚合结果，不可读 `cause` 的三个原值直接置于 `AggregateError.errors` |
| `schedulerFailed`      | `SCHEDULER_FAILED`     | 预留：异步调度策略回调或 `reportError()` 捕获到未处理错误的诊断通道码（默认无内置抛出/上报点）                   |
| `captureInvalid`       | `CAPTURE_INVALID`      | `capture()` 产生的 token 在 `commitCapture()` 时已失效、已被消费、属于另一个 tracker，或对应 observer 已 dispose |
| `bindingDuplicate`     | `BINDING_DUPLICATE`    | 同一个 `IObserverBinding` 被重复调用 `observe()`（已处于 observed 状态）                                         |
| `internalsRegistered`  | `INTERNALS_REGISTERED` | 同一个 `Runtime` 对象被重复注册内部面（`registerInternals()`）                                                   |
| `invalidOption`        | `INVALID_OPTION`       | 构造 `Runtime`/`Scheduler`/`VersionClock` 时传入的选项不满足取值要求                                             |

调用方应始终以 `error.code === ReactiveErrorCode.xxx` 判别，不要硬编码码值字符串。逐条设计动机见源码 `src/error-code.ts` 的 JSDoc。

---

<a id="trace-事件与常量"></a>

## Trace 事件与常量

```ts
import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  type IRuntimeTraceEvent
} from '@migaia/reactive';
```

`subscribeTrace(listener)` 收到的事件是以下判别联合之一：

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
```

节点以脱敏后的 `IRuntimeNodeDescriptor`（`{ id, kind, debugName? }`）出现，不是原始节点对象。

| 常量                  | 取值                                                                                                    | 用途                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `ReactiveTraceType`   | `{ observableChange, dependency, observerRun, action }`                                                 | trace 事件的顶层判别                                |
| `ReactiveTracePhase`  | `{ start, end, error, connect, disconnect }`                                                            | dependency/observerRun/action 事件的阶段            |
| `ReactiveErrorPhase`  | `{ asyncFlush, causeRead, dependencyDisconnect, lifecycleHook, ssrResource, subscriptionListener, traceListener }` | `reportError`/`onError` 收到的 `context.phase` 取值；`causeRead` 表示批处理收尾时读取业务错误 `cause` 失败 |
| `ReactiveTraceReason` | `{ set, notify, retrack, invalidate, dispose }`                                                         | observableChange/dependency 事件的原因              |

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 隔离的 Runtime + 手动冲刷（SSR/单测场景）

```ts
import { createRuntime } from '@migaia/reactive';

function renderOnce() {
  const runtime = createRuntime(); // 每次请求/每个用例独立一份，互不污染
  const count = runtime.signal(1);
  const doubled = runtime.computed(() => count.value * 2);
  const seen: number[] = [];
  const dispose = runtime.effect(() => {
    seen.push(doubled.value);
  });
  count.value = 5;
  runtime.flush(); // 手动同步冲刷，SSR 场景不依赖微任务时机
  dispose.dispose();
  return seen; // [2, 10]
}
```

### 2. 三段式绑定：实现一个最小的并发安全订阅适配层

```ts
import { createObserverBinding } from '@migaia/reactive/extension';
import { createRuntime } from '@migaia/reactive';

const runtime = createRuntime();
const count = runtime.signal(0);
const doubled = runtime.computed(() => count.value * 2);

function useReactiveValue<T>(read: () => T): T {
  const binding = createObserverBinding(runtime);
  const capture = binding.capture(read); // 渲染期：只读捕获，可能被丢弃
  // ……渲染真正提交时：
  const result = binding.commit(capture);
  if (result === 'stale') {
    // 依赖已变，重新求值（真实框架适配层这里会触发一次重渲染）
  }
  binding.observe(() => {
    // 订阅变化后触发重渲染
  });
  return capture.result;
}
```

### 3. 批处理 + 错误优先级：一次动作里业务失败与收尾冲刷失败的顺序

```ts
const runtime = createRuntime();
try {
  runtime.batch(() => {
    signalA.value = 1;
    signalB.value = 2;
    throw new Error('business failure');
  });
} catch (error) {
  // error 就是 'business failure' 本身；若收尾 flush 也失败，flush 错误挂在 error.cause 上
}
```

### 4. 自定义调度策略：切到 `requestAnimationFrame`

```ts
const runtime = createRuntime({
  schedulerStrategy: (flush) => {
    requestAnimationFrame(() => flush());
  }
});
```

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **读取节点抛 `NODE_DISPOSED`**：节点已 `dispose()`，绝不会静默返回旧值；停止持有该引用，改用重新创建的实例。
- **抛 `CROSS_RUNTIME`/`NOT_RUNTIME_OWNED`**：跨 `Runtime` 混用了节点，或传入的对象不是由 `createRuntime()` 创建；确认节点与消费它的 `Runtime` 是同一个。
- **`Computed` 抛 `CIRCULAR_DEPENDENCY`**：依赖图里存在自读环（`a` 直接或间接又读了 `a` 自己）；检查依赖图，拆掉循环引用。
- **`flush()` 抛 `FLUSH_LOOP`**：依赖图里存在自触发环（典型是某个 `Effect` 的写操作又落回了它自己的依赖）；错误信息列出了被丢弃的待办 `debugName`，据此定位并拆环。
- **`createObserverBinding().observe()` 抛 `BINDING_DUPLICATE`**：同一个 binding 在已处于 observed 状态时又被 `observe()` 了一次；再次调用前先确认当前是否已在观察中，或为新一轮渲染创建新的 binding。
- **`commit()` 返回 `'stale'`**：这不是错误，是正常的竞态处理信号；作废当前快照，重新 `capture()`/`commit()`，不要在 commit 阶段直接 pull 脏节点。
- **`COPY_CONFLICT`/`BRAND_CORRUPTED`**：进程内存在本库的多份模块副本；去重依赖（多数打包器问题），或在应用启动时调用 `assertSingleRuntimeCopy()` 主动 fail-fast。
- **`VERSION_EXHAUSTED`**：单调版本时钟耗尽（生产默认约 285 年才会发生）；释放当前 `Runtime` 持有的全部节点，创建一份新的 `Runtime`，不要试图复用同一张依赖图。
- **需要集合类型、异步资源状态机、UI 框架绑定**：`@migaia/reactive` 只提供引擎层三个节点原语和 `Runtime`，这些上层能力分别由 monorepo 里的 `store-*` 系列包、`@migaia/resource`、各框架适配层在其之上构建。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```
