# `@migaia/reactive` 使用指南

本指南逐个入口列出全部导出 API 的签名、边界行为与错误码。包的定位、适用场景与五分钟上手见 [README](./README.md)。

## 目录

- [主入口 `@migaia/reactive`](#主入口)：`Signal`、`Computed`、`Effect`、`createRuntime`、`defaultRuntime`
- [`/runtime` 入口](#runtime-入口)：`Runtime`、`createObserverBinding`（`capture`/`observe`/`commit`/`retrack`）、`VersionClock`、`DependencyTracker`、`Scheduler`
- [`/ownership` 入口](#ownership-入口)：`claimOwnership`、`ownerOf`、`assertOwnedBy`、`assertReactiveOwnedBy`
- [`/source` 入口](#source-入口)：`createFieldSource`
- [`/internals` 入口](#internals-入口)：`registerInternals`、`internalsOf`、`isRuntime`
- [`/node-factories` 入口](#node-factories-入口)：`internalRuntimeOf`、`isRuntimeTracking`、`isAnyRuntimeTracking`
- [`/node-internals` 入口](#node-internals-入口)：`registerSubs`/`registerDeps`/`registerDepVersions`/`registerVersion` 及其可变访问器
- [`/copy-check` 入口](#copy-check-入口)：`brandOwnedValue`、`assertNoForeignOwnershipBrand`、`noteRuntimeCopy`、`runtimeCopyCount`、`assertSingleRuntimeCopy`
- [`/reactive/*` 入口](#reactive-通配入口)：绕过桶文件的直接类导入
- [错误码](#错误码)：`ReactiveErrorCode`（16 个码）逐条语义
- [诊断消息](#诊断消息)：`ReactiveErrorText`
- [Trace 事件与常量](#trace-事件与常量)：`IRuntimeTraceEvent`、`ReactiveTraceType`、`ReactiveTracePhase`、`ReactiveErrorPhase`、`ReactiveTraceReason`
- [高阶组合示例](#高阶组合示例)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="主入口"></a>

## 主入口 `@migaia/reactive`

```ts
import {
  Signal,
  Computed,
  Effect,
  type IComputedConfig,
  createRuntime,
  defaultRuntime,
  type Runtime,
  ReactiveErrorCode,
  type IReactiveErrorCode,
  ReactiveErrorText,
  type IReactiveErrorText,
  REACTIVE_SOURCE,
  type IReactiveError,
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  type IDisposable,
  type IDisposer,
  type IComputedValue,
  type IObservable,
  type IObserver,
  type IRuntime,
  type IRuntimeOptions,
  type ISignal,
  type IRuntimeTraceEvent
} from '@migaia/reactive';
```

### `Signal<T>`

```ts
class Signal<T> implements IObservable, IDisposable {
  constructor(v: T, runtime: IRuntime, options?: { debugName?: string });
  readonly runtime: IRuntime;
  debugName?: string;
  readonly version: number;
  readonly disposed: boolean;
  readonly observed: boolean; // !disposed && 有下游订阅
  readonly subs: ReadonlySet<IObserver>;
  value: T; // 读建立依赖；写触发下游
  peek(): T; // 读，不建立依赖
  dispose(): void;
  addObservedHooks(hooks: { onObserved?: () => void; onUnobserved?: () => void }): () => void;
}
```

可写原子——响应式图里唯一的"真值来源"：

```ts
const runtime = createRuntime();
const count = new Signal(1, runtime);
count.value; // 1，在 Computed/Effect 内读取会建立依赖
count.value = 2; // Object.is 判定；写入相同值不触发任何通知，也不推进版本
count.peek(); // 2，不建立依赖
count.dispose();
count.value; // 抛 NODE_DISPOSED
```

边界行为：

- 构造参数顺序是"先业务参数、后 `runtime`"：`new Signal(value, runtime, options?)`。
- `value = next`：`Object.is(next, 之前值)` 为真时短路，不推进版本、不触发下游；否则先向 `VersionClock` 领取新版本号再落值（领取失败——时钟耗尽——保持原子失败，绝不出现"值已变、版本未变"的陈旧状态）。
- `dispose()` 幂等；释放时先标记 `disposed` 再断开全部下游订阅边（通知顺序：标记优先，确保被迫重跑的 Effect 读到明确的 `NODE_DISPOSED` 而不是重新订阅一个已释放节点）。
- `addObservedHooks({ onObserved?, onUnobserved? })`：登记节点级生命周期钩子（多个调用方可各自登记互不覆盖），返回移除函数；多个钩子中若有失败，单个失败原样抛出，多个失败聚合为携带 `OBSERVER_FAILED` 码的 `AggregateError`。
- 跨 `Runtime` 读取/订阅一个 `Signal` 会抛 `CROSS_RUNTIME`。

### `Computed<T>`

```ts
type IComputedOptions<T> = {
  equals?: (a: T, b: T) => boolean;
  keepAlive?: boolean;
  debugName?: string;
};
type IComputedConfig<T> = IComputedOptions<T> | ((a: T, b: T) => boolean);

class Computed<T> implements IObservable, IObserver, IDisposable {
  constructor(fn: () => T, runtime: IRuntime, config?: IComputedConfig<T>);
  readonly runtime: IRuntime;
  debugName?: string;
  readonly version: number;
  readonly disposed: boolean;
  readonly observed: boolean;
  readonly subs: ReadonlySet<IObserver>;
  readonly deps: ReadonlySet<IObservable>;
  readonly depVersions: ReadonlyMap<IObservable, number>;
  readonly value: T; // 读建立依赖 + 惰性重算
  peek(): T; // 读、重算，但不建立依赖
  preview(): T; // 推测性求值：不发布缓存、不建立依赖边（供 React getSnapshot 一类可能被丢弃的渲染使用）
  pull(): void; // 若脏则重算并落定版本；所有读取路径的统一入口
  isStale(): boolean;
  dispose(): void;
}
```

惰性求值、带缓存的派生值——写只标脏（push），值只在被读时重算（pull）：

```ts
const doubled = new Computed(() => count.value * 2, runtime);
doubled.value; // 首次读取才真正计算
doubled.value; // 依赖未变则直接返回缓存，不重算

const clamped = new Computed(() => Math.max(0, count.value), runtime, { keepAlive: true }); // 无订阅者也保持热态
const custom = new Computed(
  () => ({ n: count.value }),
  runtime,
  (a, b) => a.n === b.n
); // 第三参数可直接传比较函数
```

边界行为：

- 构造参数顺序：`new Computed(fn, runtime, config?)`；`config` 可以是 `IComputedOptions` 对象，也可以直接传一个 `equals` 比较函数。
- `equals`：默认 `Object.is`；比较函数本身抛错会阻止 dirty 落定（下次读取仍会重算，不会陷入"陈旧但标记为干净"的状态）。
- `keepAlive`：默认 `false`——没有订阅者时会在下一个 idle 时机自动挂起（断开全部依赖、状态回到 dirty），下次读取重新建立依赖并重算；设为 `true` 时禁用自动挂起。
- 循环自依赖（求值过程中直接或间接又读了自己）抛 `CIRCULAR_DEPENDENCY`，不会栈溢出。
- 已释放节点的 `value`/`peek`/`pull`/`preview` 一律抛 `NODE_DISPOSED`。
- `preview()`：用于渲染可能被丢弃的并发场景（如 React `getSnapshot`）；返回值与已提交值满足 `equals` 时共享同一个对象身份，避免消费方看到两个"相等但不同一"的对象。真正订阅仍应走 `value`/`peek`。

### `Effect`

```ts
class Effect implements IObserver, IDisposable {
  constructor(fn: () => void | IDisposer, runtime: IRuntime, options?: { debugName?: string });
  readonly runtime: IRuntime;
  debugName?: string;
  readonly disposed: boolean;
  readonly deps: ReadonlySet<IObservable>;
  readonly depVersions: ReadonlyMap<IObservable, number>;
  run(): void;
  dispose(): void;
}
```

副作用——唯一真正"被执行"的观察者（`Computed` 只标脏不重跑，只有 `Effect` 会被调度器实际 `tick`）：

```ts
const seen: number[] = [];
const effect = new Effect(() => {
  seen.push(doubled.value);
  return () => console.log('cleanup'); // 可选：返回值作为下次重跑/dispose 前的清理回调
}, runtime); // 构造时立即同步跑一次
effect.dispose(); // 释放：清理依赖边 + 跑最后一次 cleanup（untracked 执行，不建立依赖）
```

边界行为：

- **构造时立即同步执行一次**，不是等到依赖变化才第一次运行。
- `fn()` 可选返回一个清理函数（`IDisposer`），会在下次重跑前、以及 `dispose()` 时被调用（`runtime.untracked()` 包裹执行，不建立新依赖）；旧 cleanup 会先被摘掉（置空）再执行，避免新 `fn()` 抛错时下次重跑/dispose 重复执行旧 cleanup。
- 依赖变化后不会立即重跑，而是被 `Scheduler.enqueue()` 标脏排队，由 `flush()`（自动或手动）驱动 `tick()`；`tick()` 内部会先确认依赖确实变化（`hasStaleDependencies`）才真正 `run()`。
- 依赖节点被 `dispose()`/`disconnectObservable` 断开时，会强制下次 `tick()` 无条件重跑（不看是否真的脏）。

### `createRuntime` / `defaultRuntime`

```ts
function createRuntime(options?: IRuntimeOptions): Runtime;
const defaultRuntime: Runtime;
```

```ts
type IRuntimeOptions = {
  adapter?: Partial<IReactiveRuntimeAdapter>; // scheduleMicrotask/now/timestamp/reportError
  onError?: (error: unknown, context: IRuntimeErrorContext) => void;
  onTrace?: (event: IRuntimeTraceEvent) => void;
  maxFlushPasses?: number; // 默认 100，须为正整数
  scheduleIdle?: (task: () => void) => void; // 默认走 adapter.scheduleMicrotask
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
- `onError`/`onTrace`/`scheduleIdle` 若提供但不是函数，同样抛 `INVALID_OPTION`。
- `defaultRuntime` 是进程级单例（模块加载时立即 `createRuntime()`），SSR 每请求隔离、单测互不污染、Worker 独立场景都应显式 `createRuntime()`，不要依赖它。
- 若检测到本库存在多份运行时副本（重复安装/CDN 副本共存/微前端各自打包），构造期会通过 `reportError` 上报一条 `COPY_CONFLICT` 诊断（不阻断构造）。

`Runtime` 实例上的全部方法：

```ts
class Runtime implements IRuntime {
  signal<T>(value: T, options?: { debugName?: string }): Signal<T>;
  computed<T>(fn: () => T, config?: IComputedConfig<T>): Computed<T>;
  effect(fn: () => void | IDisposer, options?: { debugName?: string }): IDisposer; // 返回 dispose 函数，不是 Effect 实例
  batch<T>(fn: () => T): T;
  untracked<T>(fn: () => T): T;
  flush(): 'completed' | 'deferred';
  setSchedulerStrategy(strategy: (flush: () => void) => void): void;
  currentVersion(): number;
  runTracedAction<T>(name: string, fn: () => T): T;
  reportError(
    error: unknown,
    context: { phase: string; observer?: object; observable?: object }
  ): void;
  subscribeTrace(listener: (event: IRuntimeTraceEvent) => void): IDisposer;
}
```

逐个方法：

- `batch(fn)`：显式合并多次写入为一次副作用刷新；进入时计深度，只有最外层退出才真正 `flush()`。若 `fn` 抛错且随后的收尾 `flush()` 也抛错，优先抛出 `fn` 的原始错误（`Error` 实例时把 flush 错误挂到其 `cause`；非 `Error` 抛出值时两者聚合为携带 `ACTION_FLUSH_FAILED` 码的 `AggregateError`）。
- `untracked(fn)`：`fn` 执行期间关闭依赖收集，读取任何 `Signal`/`Computed` 都不会建立依赖边。
- `flush()`：同步冲刷当前队列。**重入语义**：observer `tick()` 内部再次调用 `flush()` 返回 `'deferred'`（外层 flush 仍在跑，本次调用不会真正冲刷）；最外层调用完成并排空队列后返回 `'completed'`。单次冲刷内的重算轮数超过 `maxFlushPasses` 抛 `FLUSH_LOOP`（见错误码表），并清空剩余队列，错误信息列出被丢弃的最多 8 个 `debugName`。
- `setSchedulerStrategy(strategy)`：受控地替换冲刷触发策略（默认微任务合并，可换成 `requestAnimationFrame`/`idle`/自定义）；只改变何时 `flush`，不交出 `Scheduler` 队列本身。`strategy` 必须是函数（否则抛 `INVALID_OPTION`），且调用后必须同步返回（不能返回 thenable）——策略返回 thenable 会被判定失败，自动回退到上一个安全策略并上报 `INVALID_OPTION` 诊断。
- `currentVersion()`：只读版本观测，不交出可递增的 `VersionClock`。
- `runTracedAction(name, fn)`：执行并追踪一段真实 action；`name` 必须是非空字符串，否则抛 `INVALID_OPTION`。未启用 trace（无监听器）时直接等价于 `fn()`，不产生额外开销。
- `reportError(error, context)`：诊断通道；`context.observer`/`context.observable` 是原始节点对象，内部会先脱敏为 `IRuntimeNodeDescriptor` 再转发给 `onError`。
- `subscribeTrace(listener)`：只读诊断事件流（节点创建、依赖连接/断开、副作用执行、显式 action），返回取消订阅函数。

---

<a id="runtime-入口"></a>

## `/runtime` 入口

```ts
import {
  createObserverBinding,
  type IObserverBinding,
  type IObserverCommitResult,
  type IObserverRetrackResult,
  Runtime,
  createRuntime,
  VersionClock,
  DependencyTracker,
  Scheduler,
  type ICapture,
  type IRuntime,
  type IRuntimeOptions,
  type IReactiveNodeOptions,
  type ISchedulerStrategy,
  type IFlushResult
} from '@migaia/reactive/runtime';
```

面向框架适配层的并发安全绑定原语。`defaultRuntime` **刻意不**从这里转发——import 这个入口不该顺手建一个 Runtime，需要它请从主入口显式取。

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

### `Runtime` / `createRuntime`

与[主入口](#主入口)是同一个类/函数，此处重复导出供框架适配层直接从 `/runtime` 引用而不必经过主桶文件。

### `VersionClock`

```ts
class VersionClock {
  constructor(maxVersion?: number); // 默认 Number.MAX_SAFE_INTEGER
  next(): number; // 领取下一个版本号
  current(): number; // 只读查看，不消耗
}
```

单调版本时钟。`next()` 达到 `maxVersion` 后抛 `VERSION_EXHAUSTED`（生产默认约 285 年才耗尽，耗尽后应释放整个 `Runtime` 并新建，而不是复用同一张图）；构造参数非正安全整数抛 `INVALID_OPTION`。

### `DependencyTracker`

```ts
class DependencyTracker {
  constructor(runtime: IRuntime);
  isTracking(): boolean;
  static isAnyTracking(): boolean;
  track(observable: IObservable): void;
  clearDependencies(observer: IObserver): void;
  disconnectObservable(observable: IObservable, reason: 'invalidate' | 'dispose'): void;
  runTracked<R>(observer: IObserver, fn: () => R): R;
  capture<R>(fn: () => R): ICapture<R>;
  commitCapture(observer: IObserver, capture: ICapture<unknown>): boolean;
  untracked<R>(fn: () => R): R;
  hasStaleDependencies(observer: IObserver): boolean;
}
```

每个 `Runtime` 一个的依赖追踪上下文，图内核内部使用；`runTracked` 是事务化重算（成功才提交依赖差异，失败丢弃临时集合，旧图不动）；`track()` 检测到跨 `Runtime` 读取（当前活跃 tracker 不是本 tracker，但确实在追踪）会抛 `CROSS_RUNTIME`。一般应用代码不需要直接使用，仅供实现自定义节点类型/框架适配层参考。

### `Scheduler`

```ts
class Scheduler {
  constructor(
    onAsyncError?: (error: unknown) => void,
    maxFlushPasses?: number,
    scheduleMicrotask?: (task: () => void) => void
  );
  batchDepth: number;
  setStrategy(strategy: ISchedulerStrategy): void;
  enqueue(item: IFlushable): void;
  dequeue(item: IFlushable): void;
  requestFlush(): void;
  flush(): IFlushResult;
  runBatched<T>(fn: () => T): T;
  runDeferred<T>(fn: () => T): T;
}
```

调度器：待冲刷队列、批处理深度、冲刷状态、可插拔触发策略全部收在这一个类里；`Runtime.flush()`/`batch()`/`setSchedulerStrategy()` 都是对它的委派。`maxFlushPasses` 非正整数抛 `INVALID_OPTION`；`requestFlush()` 重复调用安全（`scheduled`/`flushing` 两个标记天然去重）。一般应用代码同样不直接使用。

---

<a id="ownership-入口"></a>

## `/ownership` 入口

```ts
import {
  claimOwnership,
  ownerOf,
  assertOwnedBy,
  assertReactiveOwnedBy
} from '@migaia/reactive/ownership';
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

<a id="source-入口"></a>

## `/source` 入口

```ts
import { createFieldSource } from '@migaia/reactive/source';
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

<a id="node-factories-入口"></a>

## `/node-factories` 入口

```ts
import {
  internalRuntimeOf,
  isRuntimeTracking,
  isAnyRuntimeTracking,
  type IInternalRuntime
} from '@migaia/reactive/node-factories';
```

- `internalRuntimeOf(runtime: IRuntime): IInternalRuntime` —— 先校验是本库创建的 `Runtime`（内部调用 `internalsOf`，未登记会抛 `NOT_RUNTIME_OWNED`），再把 `signal()`/`computed()` 的返回类型从窄接口（`ISignal`/`IComputedValue`）收窄回具体类（`Signal`/`Computed`），供需要调用具体类方法（如 `dispose()`）的实现层（collections、对象门面）使用。节点仍走同一个 `Runtime` 造，仍受归属登记与通知管线约束——这里只是类型收窄，不额外授权。
- `isRuntimeTracking(runtime: IRuntime): boolean` —— 只读查询：该 `Runtime` 当前是否正在收集依赖帧。
- `isAnyRuntimeTracking(): boolean` —— 只读查询：进程内任意 `Runtime` 当前是否有依赖帧处于活跃状态。

---

<a id="node-internals-入口"></a>

## `/node-internals` 入口

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
} from '@migaia/reactive/node-internals';
```

可变依赖边的登记与访问，供实现新的响应式基础设施（自定义 `IObservable`/`IObserver`）时手工接入依赖图使用：

- `registerVersion(node, initial): void` / `setVersion(node, value): void` / `readVersion(node, fallback): number` —— 节点版本号的登记、写入、读取（版本状态存在私有 `WeakMap`，不是节点自身字段）。
- `registerSubs(node, subs): ReadonlySet<IObserver>` —— 登记一个内置节点的可变下游边集合，返回一份只读视图供节点对外暴露；`mutableSubs(node, fallback)` 取回可变的原始 `Set`（未登记过时回落到 `fallback`）。
- `registerDeps`/`mutableDeps`、`registerDepVersions`/`mutableDepVersions` —— 对应上游依赖集合/依赖版本映射的登记与可变访问，语义与 `subs` 对称。

一般应用代码不需要这个入口；只有需要自己实现 `IObservable`/`IObserver` 协议、并让其反向边受同一套只读视图保护的节点实现层才会用到。

---

<a id="copy-check-入口"></a>

## `/copy-check` 入口

```ts
import {
  brandOwnedValue,
  assertNoForeignOwnershipBrand,
  consumePendingCopyWarning,
  noteRuntimeCopy,
  runtimeCopyCount,
  assertSingleRuntimeCopy,
  resetRuntimeCopiesForTest
} from '@migaia/reactive/copy-check';
```

双实例自检：本库若干模块级状态（所有权表、内部面表、同步追踪上下文）的正确性前提是"进程内只有一份模块"。重复安装、CDN 副本共存、微前端各自打包会安静地打破这个前提。

- `brandOwnedValue(value: object): void` —— 为本副本创建的受管对象打上不可变品牌，供另一份模块 fail closed；对已打过本副本品牌的对象重复调用是空操作，对已打过**另一**副本品牌的对象调用抛 `COPY_CONFLICT`；品牌被篡改成非预期形状时抛 `BRAND_CORRUPTED`。
- `assertNoForeignOwnershipBrand(value: object): void` —— 本地所有权表 miss 时识别是否是另一副本创建的受管对象，避免误判为普通值放行；命中另一副本品牌抛 `COPY_CONFLICT`，品牌被篡改抛 `BRAND_CORRUPTED`。
- `consumePendingCopyWarning(): string | undefined` —— 取出并清空待上报的多副本诊断文案（`Runtime` 构造时消费一次）。
- `noteRuntimeCopy(copy?: symbol): void` —— 登记本副本；`createRuntime()`、所有权/内部面边界都会调用，幂等且有本地快路径。
- `runtimeCopyCount(): number` —— 当前进程里已进入正确性边界的副本数（纯 `import` 不计数）。
- `assertSingleRuntimeCopy(): void` —— 要求单副本，否则抛 `COPY_CONFLICT`；供"宁可启动失败也不要静默陈旧数据"的应用主动调用，库自身从不调用它。
- `resetRuntimeCopiesForTest(): void` —— 仅供测试：清掉模拟出来的副本登记。

---

<a id="reactive-通配入口"></a>

## `/reactive/*` 入口

```ts
import { Signal } from '@migaia/reactive/reactive/signal.class';
import { Computed, type IComputedConfig } from '@migaia/reactive/reactive/computed.class';
import { Effect } from '@migaia/reactive/reactive/effect.class';
```

与主入口导出的是**同一批类**，只是绕开桶文件（`index.ts`）直接从具体文件导入，供打包分析/摇树场景使用。行为与[主入口](#主入口)描述的 `Signal`/`Computed`/`Effect` 完全一致，不重复列出签名。

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
| `actionFlushFailed`    | `ACTION_FLUSH_FAILED`  | `runBatched()` 内业务动作与其收尾 flush 同时失败，作为聚合外壳附加在业务错误的 `cause` 上                        |
| `schedulerFailed`      | `SCHEDULER_FAILED`     | 预留：异步调度策略回调或 `reportError()` 捕获到未处理错误的诊断通道码（默认无内置抛出/上报点）                   |
| `captureInvalid`       | `CAPTURE_INVALID`      | `capture()` 产生的 token 在 `commitCapture()` 时已失效、已被消费、属于另一个 tracker，或对应 observer 已 dispose |
| `bindingDuplicate`     | `BINDING_DUPLICATE`    | 同一个 `IObserverBinding` 被重复调用 `observe()`（已处于 observed 状态）                                         |
| `internalsRegistered`  | `INTERNALS_REGISTERED` | 同一个 `Runtime` 对象被重复注册内部面（`registerInternals()`）                                                   |
| `invalidOption`        | `INVALID_OPTION`       | 构造 `Runtime`/`Scheduler`/`VersionClock` 时传入的选项不满足取值要求                                             |

调用方应始终以 `error.code === ReactiveErrorCode.xxx` 判别，不要硬编码码值字符串。逐条设计动机见源码 `src/error-code.ts` 的 JSDoc。

---

<a id="诊断消息"></a>

## 诊断消息

```ts
import { ReactiveErrorText } from '@migaia/reactive';
```

稳定诊断消息表；部分键是接受参数的函数（用于把动态信息嵌入固定文案模板），其余为固定字符串常量。全部键：`runtimeOptionGetterFailed(option)`、`runtimeAdapterGetterFailed(method)`、`runtimeAdapterMustBeFunction(method)`、`runtimeOptionMustBeFunction(option)`、`maxFlushPassesInvalid`、`maximumReactiveVersionInvalid`、`tracedActionNameInvalid`、`disposedSignal`、`disposedFieldSource`、`disposedComputed`、`circularComputedDependency`、`ownershipConflict`、`belongsToDifferentRuntime(what)`、`notRuntimeOwned(what)`、`belongsToAnotherRuntime(what)`、`internalsAlreadyRegistered`、`runtimeNotCreatedByFactory`、`observerBindingAlreadyObserved`、`crossRuntimeDependency`、`captureDifferentRuntime`、`captureDisposedObserver`、`captureInvalid`、`copyRegistryInvalid`、`foreignCopyValue`、`foreignCopyDependency`、`ownershipBrandCorrupted`、`multipleCopiesWarning`、`expectedSingleCopy(count)`、`versionClockExhausted`、`schedulerStrategyInvalid`、`schedulerStrategyReturnedThenable`、`observersBeforeFlushLoop`、`multipleObserversFailed`、`actionCauseAndFlushFailed`、`actionAndFlushFailed`、`multipleLifecycleHooksFailed`、`flushLoopDetected(maxPasses, droppedCount, names)`。逐条文案与语义见源码 `src/error-text.ts`。

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
| `ReactiveErrorPhase`  | `{ asyncFlush, dependencyDisconnect, lifecycleHook, ssrResource, subscriptionListener, traceListener }` | `reportError`/`onError` 收到的 `context.phase` 取值 |
| `ReactiveTraceReason` | `{ set, notify, retrack, invalidate, dispose }`                                                         | observableChange/dependency 事件的原因              |

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 隔离的 Runtime + 手动冲刷（SSR/单测场景）

```ts
import { Signal, Computed, Effect, createRuntime } from '@migaia/reactive';

function renderOnce() {
  const runtime = createRuntime(); // 每次请求/每个用例独立一份，互不污染
  const count = new Signal(1, runtime);
  const doubled = new Computed(() => count.value * 2, runtime);
  const seen: number[] = [];
  const dispose = runtime.effect(() => {
    seen.push(doubled.value);
  });
  count.value = 5;
  runtime.flush(); // 手动同步冲刷，SSR 场景不依赖微任务时机
  dispose();
  return seen; // [2, 10]
}
```

### 2. 三段式绑定：实现一个最小的并发安全订阅适配层

```ts
import { createObserverBinding } from '@migaia/reactive/runtime';
import { createRuntime, Computed, Signal } from '@migaia/reactive';

const runtime = createRuntime();
const count = new Signal(0, runtime);
const doubled = new Computed(() => count.value * 2, runtime);

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
runtime.setSchedulerStrategy((flush) => {
  requestAnimationFrame(() => flush());
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
